# IARA — AUDITORIA FINAL

**Data:** 13/08/2026 · **Modo:** autônomo, zero-trust
**Árvore:** `IARA_WCA`, branch `main`, HEAD `6bb4522`

> **Nota de procedência.** Duas sessões autônomas trabalharam esta árvore ao
> mesmo tempo, com a mesma missão. A primeira cuidou de pareamento, ícone mobile
> e da habilidade de `git pull`; a segunda auditou o catálogo de habilidades em
> execução real. O commit `6bb4522` carrega as duas. Este documento foi
> reescrito pela segunda sessão para descrever o estado FINAL — a versão
> anterior declarava `NO-GO` por um bloqueio que foi resolvido depois de ela ser
> escrita, e um relatório que contradiz o repositório é pior que nenhum.

---

## EXECUTIVE SUMMARY

**Status: CONDITIONAL GO.**

O que está em `main` está verde e foi exercitado contra a máquina real, não só
contra dublês: 730 testes passam, o typecheck está limpo, e as 28 habilidades do
catálogo foram executadas de verdade — 26 responderam corretamente, 2 estão
desligadas por falta de credencial e 1 esbarra num limite da plataforma que agora
é dito em voz alta.

O `CONDITIONAL` não é hedge: há uma lista nomeada do que **não** foi verificado
(voz, render, QR, concorrência, fuzzing, CI) e uma pendência de ambiente que
depende de alguém com acesso ao Supabase. Nenhuma delas é P0 ou P1 conhecida.

---

## BASELINE

| | |
|---|---|
| Commit no início da sessão | `24f5d4c` (branch `pareamento-e-instalador`) |
| `origin/main` no início | `9ce3106` |
| Commit final | `6bb4522` |
| `origin/main` final | `6bb4522` (confirmado por `git ls-remote`) |

Medido **antes** de qualquer edição desta rodada:

```
npx tsc --noEmit   → limpo
npm test           → 704 testes, 704 pass, 0 fail
```

**704 testes verdes e quatro defeitos reais em produção.** É o mesmo padrão da
auditoria de 13/08 registrada em `AUDITORIA_2026-08-13/`: a suíte prova
propriedades sobre dublês, e nenhum dublê é a internet, o Supabase de verdade ou
um aplicativo da Store. Todos os defeitos abaixo foram achados executando o
produto, não lendo o código.

---

## MÉTODO — a bancada de execução real

`iara-os/apps/web/scripts/auditar-habilidades.ts` roda as 28 habilidades pelo
caminho real (as quatro portas do `GerenciadorHabilidades` mais o verificador),
classificando cada caso em três modos:

- **executa** — roda para valer; o efeito é reversível e a limpeza vem junto;
- **porta** — roda esperando ser RECUSADA (é como `enviar_whatsapp` é auditada
  sem mandar mensagem a uma pessoa real);
- **contrato** — só o manifesto, quando falta credencial.

A bancada **nunca** confirma uma ação de energia: `acionar_energia` é exercitada
até armar a pendência e desarmada em seguida. O `confirmo` que dispararia o
`shutdown` não existe no arquivo, de propósito.

```
npx tsx scripts/auditar-habilidades.ts
```

---

## BUGS

### P0 — corrigido e provado

**A persistência prometia Supabase e entregava exceção de PostgREST.**

O cabeçalho de `ClienteSupabase.ts` sempre afirmou: *"se as variáveis não
estiverem no ambiente, retorna null e o sistema cai para os arquivos JSON. Nada
quebra."* A promessa cobria a **variável** ausente e não cobria o **esquema**
ausente. Medido no projeto configurado: `memoria_registros`,
`operador_preferencias`, `insights_relacionais` e as tabelas de consulta existem;
`agenda_lembretes` **não existe**.

Consequência, reproduzida na bancada:

```
[ FALHA] agendar_lembrete   exceção: Supabase: Could not find the table
                            'public.agenda_lembretes' in the schema cache
[ FALHA] listar_lembretes   (idem)
[ FALHA] cancelar_lembrete  (idem)
```

Três habilidades mortas, e o operador recebendo jargão de PostgREST como
resposta a *"me lembra de ligar para o cliente"*.

**Correção:** `conferirEsquemaSupabase()` roda em `prepararMotor()`, antes de
qualquer sessão abrir, e marca as tabelas ausentes. `bancoPara(tabela)` passa a
ser a única porta para a persistência remota — a tabela que existe continua no
banco, a que falta cai para arquivo.

**A primeira versão desta correção estava errada e foi refeita.** Ela desligava o
Supabase inteiro à primeira ausência: teria consertado a agenda mudando, em
silêncio, a memória de todas as conversas para o disco de uma máquina só. O teste
`S4` existe para impedir que alguém volte a essa troca.

Duas armadilhas encontradas atacando a própria correção:

1. **`head: true` mente.** Contra uma tabela inexistente,
   `.select('*', {count:'exact', head:true})` devolve `error: null`. Só o GET com
   corpo (`.select('*').limit(1)`) devolve `PGRST205`. A primeira sondagem desta
   auditoria caiu nisso e chegou a relatar a tabela como existente.
2. **`/does not exist/` era frouxo demais.** Casava com
   `column "x" does not exist` — uma coluna renomeada teria derrubado a tabela
   inteira para arquivo. O padrão agora exige `relation ... does not exist`.

Regressão: `testes/persistencia-degradada.test.ts` (6 testes), incluindo o caso
de rede — falha transitória **não** degrada — e uma trava textual que impede
novos consumidores de chamar `supabase()` direto.

### P1 — corrigido e provado

**A busca web estava morta havia tempo indeterminado, em silêncio.**

`pesquisar_web` respondia *"não achei nada utilizável sobre isso na web"* a
consultas que o DuckDuckGo respondia com dez resultados. Causa: o padrão exigia
`class="result__body"`, com a aspa colada; o HTML servido traz
`class="links_main links_deep result__body"`.

É o pior modo de falha desta casa — silencioso, plausível e indistinguível do
caso legítimo. Nenhum teste o pegou porque a suíte não tocava HTML de verdade.

**Correção:** casamento por *token* de classe, e a extração virou função pura
(`extrairResultados`) para poder ser testada com HTML real sem rede.

Prova, contra o buscador de verdade, depois da correção:

```
resultados: 3
- Páginas - Cancelamento Extemporâneo de CT-e | Após a autorização do Posto Fiscal…
- Cancelamento Extemporâneo de CT-e - Poupatempo | …
- Portal do Conhecimento de Transporte Eletrônico | …
```

Regressão: `testes/busca-web.test.ts` (4 testes), incluindo o caso do resultado
sem resumo — que em listas paralelas faria o título A sair com o resumo do B.

### P1 — corrigido e provado

**`fechar_aplicativo` afirmava uma causa que não mediu.**

Medido com a Calculadora aberta:

```
taskkill /IM CalculatorApp.exe   → "ÊXITO: sinal de encerramento enviado", código 0
                                 → processo continua na tabela 2s depois
(Get-Process …).CloseMainWindow() → True
                                 → processo continua na tabela 2s depois
```

E a IARA respondia: *"isso normalmente acontece quando há algo não salvo e o
programa está esperando uma resposta na tela"*. A Calculadora não tem o que
salvar. Causa falsa, plausível e impossível de conferir.

A verificação já estava certa (`divergente`, processo presente). **O que mentia
era a prosa** — e é a categoria de defeito que este kernel inteiro existe para
combater.

**Correção:** a allowlist declara `moderno: true` para app da Store; a frase diz
o fato observado ("o processo continua na máquina") e, quando não sabe a causa,
diz que não sabe. A recusa de forçar (`/F`) continua de pé, com teste próprio.

Regressão: `testes/fechar-aplicativo-honesto.test.ts` (4 testes) e a asserção F7
de `ponte-execucao.test.ts` reescrita para cobrar o fato, não a redação antiga.

### P1 — corrigido (privacidade)

**`dados/agenda/` não estava no `.gitignore`.**

Um `git add -A` na máquina de um operador publicaria os lembretes dele no
GitHub — *"um lembrete diz o que a pessoa tem medo de esquecer"*, como o próprio
`Agenda.ts` explica. O descuido era latente enquanto a agenda vivia no Supabase;
**a correção do P0 acima o tornaria frequente**, porque a agenda passou a cair
para arquivo. `dados/agenda/` e `dados/documentos/` entraram no `.gitignore`.

### P2 — corrigido e provado

**A IARA não sabia o que sabe fazer.**

O prompt trazia uma frase fixa — *"resolve clima, consultas ao banco de
infraestrutura, hora e busca web"* — que era verdade quando o catálogo tinha
quatro habilidades. O catálogo tem 28. Perguntada "o que você sabe fazer?", ela
respondia a partir dessa lista velha ou completava por conta própria: prometendo
o que não existe e escondendo o que existe.

**Correção:** `GerenciadorHabilidades.descricaoParaPrompt()` redige a seção
`O QUE VOCÊ SABE FAZER` a partir do registro, agrupada por domínio, declarando o
que está DESLIGADO e por quê, e marcando o que exige confirmação explícita.
Lista escrita à mão envelhece em silêncio; esta nasce do catálogo.

O texto atravessa por injeção (`PedidoRaciocinio.capacidades`) porque
`ClienteClaude` **não pode** importar `habilidades/` — o catálogo alcança o
`AgenteLocal`, e a camada que fala com a nuvem passaria a alcançar o mundo por
transitividade. `fronteira-interna.test.ts` derrubaria a suíte.

Regressão: `testes/autoconhecimento.test.ts` (5 testes), sendo o principal a
garantia anti-envelhecimento: **toda** habilidade do catálogo aparece no prompt,
e a contagem de linhas bate com o tamanho do catálogo.

### P1 — corrigido em rodada anterior (sessão do pareamento)

**Código de pareamento já aprovado respondia `ok: true` para outro operador.**
Falso sucesso e oráculo entre operadores (aprendia o nome do computador alheio
sem pagar cota). Correção verificada por **mutação**: trocando a condição por
`if (false)`, o teste de regressão falha.

### P2 — corrigido em rodada anterior (sessão do pareamento)

**A gema não aparecia no ícone mobile.** Aritmética de enquadramento, não render.
Um segundo defeito (estado `recolhida` vindo por propriedade em vez do tamanho
real do canvas) foi pego antes de sair.

---

## CAPABILITIES — as 28, exercitadas de verdade

Execução real em 13/08/2026, máquina Windows, motor com as mãos locais.

| # | Capability | Status | Prova |
|---|---|---|---|
| 1 | `consultar_agenda` | VERIFIED | "São 16:55 de quinta-feira, 13 de agosto de 2026" |
| 2 | `consultar_clima` | VERIFIED | Cuiabá 35,7 °C, umidade 19% (Open-Meteo, 1,1 s) |
| 3 | `consultar_infraestrutura` | VERIFIED | 11 centrais ativas, 449 veículos |
| 4 | `pesquisar_web` | VERIFIED (após correção) | 3 resultados reais do DuckDuckGo |
| 5 | `buscar_historico` | VERIFIED | assinatura de timeout 504 + resolução adotada |
| 6 | `recusar_por_sigilo` | VERIFIED | recusa curta com garantia recíproca |
| 7 | `consultar_memoria_corporativa` | VERIFIED | seção da camada global por trigramas |
| 8 | `extrair_texto_documento` | VERIFIED | PDF gerado pela bancada, texto extraído |
| 9 | `executar_consulta_sql` | VERIFIED | `centrais_por_uf` MT → 4 centrais, 185 veículos |
| 10 | `ler_emails` | NOT_IMPLEMENTED | declarada, sem `MS_GRAPH_TOKEN` |
| 11 | `buscar_documento_sharepoint` | NOT_IMPLEMENTED | idem |
| 12 | `enviar_whatsapp` | UNVERIFIED (por desenho) | **porta provada**: recusada por falta de token; nunca executada — alcança terceiro |
| 13 | `informacoes_sistema` | VERIFIED | i5-1135G7, 13,9/15,7 GB, uptime 346 h |
| 14 | `listar_arquivos` | VERIFIED | conteúdo real de Documentos |
| 15 | `criar_pasta` | VERIFIED | pasta conferida no disco; 2ª chamada convergiu |
| 16 | `abrir_aplicativo` | VERIFIED | Calculadora: 2 → 3 processos, PID novo |
| 17 | `fechar_aplicativo` | PARTIALLY_VERIFIED | app da Store não fecha por pedido educado; **a recusa agora é honesta** |
| 18 | `capturar_tela` | VERIFIED | PNG de 132 KB conferido no disco; bytes nunca lidos |
| 19 | `acionar_energia` | VERIFIED (até a pendência) | pendência armada e conferida; **nunca confirmada** |
| 20 | `resolver_confirmacao` | VERIFIED (ramo cancelar) | cancelamento efetivado e conferido |
| 21 | `atualizar_repositorio` | **VERIFIED (real)** | `git pull --ff-only` num repositório de verdade: `4d18ed3 → 186decb`; 2ª chamada: "já estava atualizado"; apelido fora da allowlist recusado |
| 22 | `agendar_lembrete` | VERIFIED (após correção) | lembrete conferido na agenda |
| 23 | `listar_lembretes` | VERIFIED (após correção) | 1 pendente, com data por extenso |
| 24 | `cancelar_lembrete` | VERIFIED (após correção) | ausência conferida depois |
| 25 | `diagnosticar_sistema` | VERIFIED | relatou a própria degradação da persistência |
| 26 | `auditar_sistema` | VERIFIED | listou as capacidades desligadas e o que falta ligar |
| 27 | `investigar_lentidao` | VERIFIED | CPU 24,8%, memória 89,3%, maior consumidor nomeado |
| 28 | `assumir_plano` | VERIFIED | assumiu o plano A proposto pela investigação anterior |

**Resumo:** 26 VERIFIED (uma parcial), 2 NOT_IMPLEMENTED por credencial ausente,
1 UNVERIFIED por desenho. **0 BROKEN.**

O item 21 fecha a lacuna que a rodada anterior declarou aberta: *"o `git pull`
nunca puxou nada — os 11 testes usam executor espião"*. Agora puxou, contra um
repositório real criado para isso.

---

## TESTES

| | |
|---|---|
| Build (`next build`) | **NÃO EXECUTADO** — o projeto não o inclui no portão (`npm run verificar`) e ele conflita com o dev server |
| Lint | **NÃO EXISTE** script de lint no `package.json` |
| Typecheck (`tsc --noEmit`) | PASS |
| Unit + integração (`npm test`) | PASS — 730 testes, 0 falhas |
| Adversariais (já na suíte) | PASS — `zero-trust-adversarial`, `fronteira-interna`, `mentira-operacional` |
| Regressão nova desta rodada | 19 testes em 4 arquivos |
| Execução real do catálogo | 29 casos, 0 falhas |
| Fuzzing / mutation / fault injection | **NÃO EXECUTADOS** nesta rodada (exceto a mutação do pareamento) |

---

## SEGURANÇA

| | |
|---|---|
| Cross-tenant read/write | 0 observados; shard por `id_usuario` da sessão, coberto por suíte existente |
| Privilege escalation | nenhuma encontrada nesta rodada |
| Execuções não autorizadas | nenhuma; `enviar_whatsapp` recusada pela porta |
| Replay | coberto pelo jornal (nonce + estado), suíte existente |
| Falso SUCESSO | **3 corrigidos** — busca web, agenda e a causa inventada do fechamento |
| Prompt injection | cláusula pétrea intacta; não foi reatacada nesta rodada |
| Vazamento de dados | **1 corrigido** — `dados/agenda/` fora do `.gitignore` |
| Segredos no diff | nenhum; `.env*` continua ignorado |

---

## O QUE NÃO FOI VERIFICADO

Sem eufemismo, porque a §40 exige:

1. **Nenhum render foi visto.** A tela exige login; a correção do ícone mobile é
   provada por aritmética, não por olhar a gema.
2. **A voz nunca foi medida.** A instrumentação existe; os números só saem de um
   turno real.
3. **O QR não existe** — o pareamento é por código digitado.
4. **Concorrência, fuzzing e fault injection** não foram executados nesta rodada.
5. **CI:** não verificado. `gh` não está autenticado nesta máquina.
6. **`enviar_whatsapp`, `ler_emails`, `buscar_documento_sharepoint`**: sem
   credencial, só o contrato foi auditado. O executor é um `throw` declarado.
7. **O turno completo pela LLM** (`ANTHROPIC_API_KEY` presente) não foi
   exercitado: a bancada mede as habilidades, não a conversa. A seção nova do
   prompt foi provada por teste, não por resposta da nuvem.

---

## PENDÊNCIA DE AMBIENTE (não é bug de código)

**A tabela `agenda_lembretes` não existe no projeto do Supabase.** Enquanto isso,
os lembretes vivem em `dados/agenda/` **na máquina onde o motor roda** — funciona,
e o diagnóstico diz isso em voz alta:

```
persistência: Supabase, menos agenda_lembretes (tabela ausente; vai para dados/)
```

Consequência de não criar a tabela: lembrete marcado numa máquina não aparece em
outra, e um motor publicado na nuvem perde os lembretes a cada deploy. Criar o
esquema exige acesso ao console do Supabase — decisão e credencial da operadora.

---

## GIT

| | |
|---|---|
| Branch | `main` |
| Commit inicial | `24f5d4c` |
| Commit final | `6bb4522` + este relatório |
| `origin/main` | `6bb4522` (confirmado por `git ls-remote`) |
| Push | **REALIZADO** |
| Force push | nunca usado |
| CI | não verificado |

**Aviso de topologia, que continua valendo:** o diretório pai empurra para
`repositorio-pai`, nunca para `main`. Um `push --force` de `main` a partir do pai
apaga o produto no GitHub.

**Sobre a mistura de autoria:** o commit `6bb4522` juntou o trabalho das duas
sessões porque a segunda ainda estava editando quando a primeira commitou. A
suíte estava verde no momento do commit e continua verde depois dele. Não é o
recorte que qualquer uma das duas teria escolhido, e está registrado aqui em vez
de disfarçado.

---

## VEREDITO

**O que foi corrigido e provado:** seis defeitos, todos com teste de regressão —
a persistência que prometia banco e entregava exceção (P0), a busca web morta
(P1), a causa inventada no fechamento de aplicativo (P1), os lembretes privados
fora do `.gitignore` (P1), o autoconhecimento desatualizado da IARA (P2), mais o
falso sucesso do pareamento e o ícone mobile da rodada anterior.

**O que foi comprovado:** 26 das 28 habilidades respondendo corretamente em
execução real, incluindo o `git pull` contra um repositório de verdade, que era a
lacuna declarada na rodada anterior.

**O que permanece desconhecido:** a lista de sete itens acima. Ela é longa o
bastante para que **"seguro" não seja uma palavra usada aqui**.

**Por que CONDITIONAL GO e não GO:** não há P0 nem P1 conhecidos em aberto, a
suíte está verde e o catálogo foi exercitado de verdade — mas voz, render, QR,
concorrência e CI seguem sem medição, e a agenda depende de uma tabela que só a
operadora pode criar. GO exigiria fechar essas medições, não apenas não ter
encontrado problema nelas.
