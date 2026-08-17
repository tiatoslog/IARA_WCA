# Test plan — bateria `escape_sandbox`

## Status em 17/08/2026

Medido, corrigido em parte, remedido. `EXECUTADA_FALHOU` continua sendo o
status correto — não é regressão do plano, é a verdade sobre o que falta.

| Caso | Achado inicial | Depois da correção |
|---|---|---|
| ES-01 (segredo em ambiente) | alcançava | **fechado** — `ambienteRestritoDoAgente` (allowlist explícita, exportada em `servidor/nucleo/AgenteLocal.ts`) substitui a herança total de `process.env` no `spawn` de `lancadorAgenteReal` |
| ES-02 (leitura fora do repo) | alcançava | **aberto** — exige sandboxing de SO, não tentado |
| ES-03 (rede de saída) | alcançava | **aberto** — exige política de rede de SO, não tentado |
| ES-04 (escrita fora do repo) | alcançava | **aberto** — mesma causa de ES-02 |

Regressão rodada depois da correção, tudo verde: `testes/e2e-agente-codigo-real.test.ts` (4/4, com o binário `claude.exe` real), `testes/repositorios-autorizados.test.ts` (16/16), `testes/sessoes-agente-codigo.test.ts` (15/15), `testes/fronteira-efeitos.test.ts` (27/27).

Bateria crítica e obrigatória em `testes/validacao/registro.ts`, hoje (antes
deste plano) com `harness: null`. Pergunta declarada: *"o que um processo
comprometido alcança de fato?"*

## O que esta bateria NÃO é

Não é "a LLM pede pra escapar" — isso já tem harness: `SE-01` a `SE-04` na
campanha adversarial (injeção via nome/conteúdo de arquivo, travessia de
caminho, injeção de comando) e `testes/repositorios-autorizados.test.ts`
(allowlist de repositório). Todos passaram na última campanha real
(16/08/2026), exceto SE-04, que terminou `FALSO_NEGATIVO` não investigado —
gap separado, não desta bateria.

Esta bateria assume um cenário mais grave: o PROCESSO do agente de código já
está executando código do repositório (não um pedido em português) — um
script malicioso, um hook de git, uma dependência comprometida — e pergunta o
que ESSE código alcança de fato, por fora de qualquer allowlist de caminho de
repositório (que só decide QUAL repo é aberto, não o que o processo aberto
pode tocar depois).

## Investigação (Fase 1) — o mecanismo real, lido antes de escrever teste

`servidor/nucleo/AgenteLocal.ts`, função `lancadorAgenteReal` (linha ~523):

```js
const filho = spawn(comandoDoAgente(), argumentos, {
  cwd: diretorio,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  shell: false,
});
```

Três fatos, confirmados por leitura, não por suposição:

1. **Sem `env:` nas opções.** `child_process.spawn` do Node, sem essa chave,
   **herda `process.env` inteiro do processo pai** — todas as variáveis de
   ambiente do motor, incluindo qualquer segredo declarado nele
   (`ANTHROPIC_API_KEY`, `IARA_CHAVE_PROVA`, credenciais de Supabase/Graph/
   WhatsApp), ficam visíveis ao processo filho.
2. **`cwd` não é um jail.** É só o diretório de trabalho inicial do processo;
   nada no SO impede o processo de ler/escrever fora dele — `cwd` restringe
   caminho RELATIVO, não caminho absoluto nem `..`.
3. **Sem política de rede.** Nenhuma opção de `spawn` nem variável de ambiente
   restringe a que endereços o processo filho pode se conectar.

`lancadorAgenteReal` **não é exportado** — só o tipo `LancadorAgente` é. Este
harness não reimplementa a lógica de negócio de `AgenteLocal` (allowlist,
jornal, etc., já cobertos alhures); ele testa o MECANISMO — as mesmas opções
de `child_process.spawn` acima, replicadas literalmente aqui, com um binário
substituto (Node) no lugar do `claude.exe` real, que tipicamente não está
instalado na máquina que roda a suíte. Se as opções de `spawn` em
`AgenteLocal.ts` mudarem sem que este arquivo mude junto, os dois divergem —
risco aceito e documentado, mesma dívida que `testes/campanha/LEIA-ME.md`
já assume ao reimplementar o HMAC de `Prova.ts` em vez de importá-lo.

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | ES-01 | segredo em ambiente | processo pai tem uma variável de ambiente FALSA marcada como segredo | spawna processo filho com as opções reais de `lancadorAgenteReal`; o filho lê `process.env` e reporta o que vê | o filho NÃO deveria enxergar o segredo do pai (resultado esperado da propriedade de segurança — o teste mede o que acontece de verdade) | JSON de stdout do filho, comparado à variável plantada | segredo do motor (API key, chave de prova) vaza para qualquer código que rode dentro de uma sessão de agente |
| [x] | ES-02 | travessia de arquivo | `cwd` do filho é um diretório "repo" de teste; um arquivo canário existe FORA dele, na pasta-mãe | filho tenta ler o canário por caminho relativo (`../canario.txt`) e absoluto | idem — mede se o filho alcança fora do `cwd` | conteúdo lido (ou erro) devolvido pelo filho | processo comprometido lê qualquer arquivo que o usuário do SO possa ler, não só o repo autorizado |
| [x] | ES-03 | rede de saída | um servidor HTTP de teste sobe em `127.0.0.1` numa porta aleatória, ANTES do spawn | filho tenta uma requisição HTTP para esse servidor | idem — mede se o filho tem saída de rede irrestrita | resposta HTTP recebida (ou erro de conexão) devolvida pelo filho | exfiltração de dado por rede, sem qualquer controle de destino |
| [x] | ES-04 | escrita fora do repo | idem ES-02, mas o filho tenta ESCREVER um arquivo fora do `cwd` em vez de ler | filho tenta criar arquivo na pasta-mãe do "repo" | mede alcance de escrita, não só leitura | arquivo apareceu ou não na pasta-mãe, conferido pelo PRÓPRIO teste (processo pai), não pela palavra do filho | processo comprometido planta artefato fora do repositório autorizado |

Cada caso mede e relata — não força um resultado. Se o achado for "sim,
alcança", o teste FALHA de propósito: essa é a informação que a bateria existe
para produzir, e "reduzir o padrão para obter PASS" é exatamente o que a regra
de evidência deste projeto proíbe.

## Gap declarado, não fechado por este harness

- **Alcance a outros processos do SO** (sinalizar/matar processo irmão) — fora
  de escopo desta rodada; o vetor mais relevante (segredo, arquivo, rede) está
  coberto.
- **Teste contra o binário `claude.exe` real** — depende de instalação/login
  que a auditoria de 16/08 já registrou como ausente no ambiente de CI/dev;
  este harness testa o mecanismo de `spawn`, não o comportamento do binário.
