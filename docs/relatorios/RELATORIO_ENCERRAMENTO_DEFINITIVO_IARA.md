# Relatório de encerramento definitivo — FRONTEIRA DE EXECUÇÃO

**Data:** 11/08/2026
**Base:** `f515e10` + auditoria de escrita (D1/D2) + esta auditoria (D3)
**Escopo:** eliminar a classe de falha "executor que alcança o mundo por fora do
Kernel", e não apenas o caso do WhatsApp.

---

## 1. VEREDITO

> ### ENCERRADO COM DÉBITOS

**Nenhum débito P0. Nenhum débito P1.** O que resta são duas exclusões
**argumentadas** (§13) e débitos P2/P3, todos declarados.

O bloqueador que impedia o encerramento anterior está fechado:

| Bloqueador | Antes | Agora |
|---|---|---|
| **D1 — idempotência** | ✅ fechado (auditoria anterior) | mantido, e estendido às integrações |
| **D2 — persistência de autorização** | ✅ fechado (auditoria anterior) | mantido |
| **D3 — WhatsApp fora do Kernel** | ❌ aberto | ✅ **fechado, e a classe inteira com ele** |

A correção não foi no WhatsApp. Foi na arquitetura: existe **um** objeto que sabe
executar efeito (`PortalEfeitos`), e um **teste de arquitetura** que falha se
qualquer arquivo alcançar um provedor por fora dele — inclusive um arquivo que
ainda não existe.

---

## 2. Baseline (Fase 0, congelamento)

| | Antes | Depois |
|---|---|---|
| Branch / commit | `main` @ `f515e10` | mesmo (trabalho não commitado no início) |
| Testes | **332 / 332**, 0 falhas | **359 / 359**, 0 falhas |
| Typecheck | limpo | limpo **no escopo auditado** (§14) |
| Build | limpo | **bloqueado por edição de outra sessão** (§14) |
| Lint | **não existe no projeto** | não existe — não declaro limpo o que não roda |
| Prova cognitiva | 11 cenários, roda íntegra | intacta |
| Prova de escrita | 0 reprovados | 0 reprovados |
| **Prova de encerramento** | não existia | **21 asserções, 0 reprovadas** |

Alterações de outra sessão presentes na árvore e **não tocadas**:
`components/projecao/*`, `app/globals.css`, `tsconfig.json`.

---

## 3. Arquitetura final

```
USUÁRIO
  ↓ Percepção            âncoras, modo irrealis, citação de terceiro
  ↓ Interpretação        rota, ambiguidade, esclarecimento
  ↓ Contexto / Memória   histórico + desempate de fatos por procedência
  ↓ Decisão              Planejador determinístico | MotorRaciocinio emergente
  ↓ Risco                PoliticaRisco — baixo / médio / alto
  ↓ Autorização          PorteiroAutorizacao (origem do plano)     ← 1ª barreira
  ↓ OPERAÇÃO             RegistroOperacoes.reservar → jornal em disco
  ↓ ═══════════ PortalEfeitos ═══════════════════════════════════  ← A FRONTEIRA
  │   abrir:   identidade → dedup → autorização tipada → jornal
  │   executar: habilidade local  |  Integracao (provedor externo)
  │   fechar:  aceite ≠ entrega → verificação → estado verdadeiro
  ↓ INTEGRAÇÃO           adaptador, sem autoridade
  ↓ PROVEDOR             Meta Graph, e futuros
  ↓ VERIFICAÇÃO          confere o MUNDO
  ↓ ESTADO DA OPERAÇÃO   persistido, reidratável
  ↓ VERDADE              Verdade.ts — o verbo que a resposta pode usar
  ↓ RESPOSTA
```

**Autorização tipada é a 2ª barreira, e é independente da 1ª.** O porteiro é uma
checagem num ponto do Kernel — reordenável, removível, esquecível. A segunda está
no **tipo**: `FonteEvidencia` não tem `llm`, um plano emergente carimba
`porteiro`, e `transicionar` recusa `porteiro` para risco alto. Apagar o porteiro
não reabre o buraco.

---

## 4. Integrações auditadas

| Integração | Estado | Risco | Semântica | Verificador | Idempotência do provedor |
|---|---|---|---|---|---|
| `whatsapp.responder` | **ligada, pelo portal** | médio | não idempotente | **ausente, declarado** | Cloud API **não oferece** chave |
| `enviar_whatsapp` (catálogo) | declarada, sem executor | alto | não idempotente | declarado | — |
| `ler_emails`, `buscar_documento_sharepoint` (Graph) | declaradas, sem executor | baixo | leitura | n/a | — |

**Nenhum provedor externo real foi exercitado.** WhatsApp e Graph seguem sem
credencial neste ambiente. Chamar a Meta numa prova seria produzir exatamente o
efeito que a auditoria existe para controlar.

---

## 5. Todas as rotas de efeito externo

Varredura estrutural sobre `fetch`, `spawn`, `execFile`, `child_process`,
`writeFile`, `appendFile`, `mkdir`, `insert`, `update`, `upsert`, `delete`, e a
superfície HTTP/WebSocket.

| Rota | Arquivo | Altera mundo? | Kernel | Portal | Autoriz. | Idemp. | Verific. | Estado |
|---|---|---|---|---|---|---|---|---|
| `POST /messages` (Meta) | `canais/WhatsApp.ts` | **sim** | ✅ | ✅ | ✅ operador | ✅ `wamid` | declarado ausente | **fechada** |
| `spawn` (shell) | `nucleo/AgenteLocal.ts` | **sim** | ✅ | ✅ | ✅ | ✅ | ✅/declarado | fechada |
| `mkdir` (pasta) | `nucleo/AgenteLocal.ts` | **sim** | ✅ | ✅ | ✅ porteiro | ✅ | ✅ disco | fechada |
| `fetch` busca web | `nucleo/BuscaWeb.ts` | não (leitura) | ✅ | n/a | n/a | n/a | n/a | declarada |
| `fetch` clima | `nucleo/OrquestradorAcoes.ts` | não (leitura) | ✅ | n/a | n/a | n/a | n/a | declarada |
| `fetch` TTS | `nucleo/Voz.ts` | não (texto→áudio) | — | n/a | n/a | n/a | n/a | declarada |
| `insert`/`upsert`/`writeFile` | `nucleo/MemoriaOperacional.ts` | **registro próprio** | ✅ | ❌ | — | — | — | **exclusão argumentada (§13)** |
| `appendFile` | `kernel/RegistroOperacoes.ts` | **o jornal** | — | ❌ | — | — | — | **é a própria auditoria** |
| `GET /saude`, `GET /voz/*.mp3` | `principal.ts` | não | — | n/a | n/a | n/a | n/a | leitura |
| WebSocket `preferencias` | `barramento/Porta.ts` | registro próprio | ✅ | ❌ | — | — | — | exclusão argumentada |

**Rotas encontradas:** 10 categorias. **Rotas de efeito externo eliminadas do
caminho livre:** 1 (D3 — WhatsApp). As demais já estavam contidas ou são leitura.

---

## 6. Idempotência

**Chave:** `sha256(id_usuario | ação | parâmetros canônicos | origem_pedido)`.
Não é hash de prompt — *"manda de novo"* e *"reenvia"* são o mesmo efeito com
textos diferentes.

**Três barreiras, em `reservar`, síncrono:**

1. **chave** — mesma origem de pedido é retry por definição;
2. **regra de ouro** — efeito não idempotente idêntico em `desconhecida` **ou**
   `aceita_pelo_provedor` é **bloqueado, sem prazo**;
3. **duplo clique** — mesma impressão de efeito em ≤20 s.

**`origem_confiavel` desliga 2 e 3.** Quando a origem do pedido já identifica a
intenção sozinha — o `wamid` da Meta —, as heurísticas de impressão digital saem
do caminho. Elas existem para distinguir intenções indistinguíveis; com um id
único por intenção, manter as heurísticas **causa dano** (§12, P0-C).

**Idempotência no provedor:** a Cloud API da Meta **não oferece** cabeçalho de
idempotência. A chave viaja como correlação e o ponto de propagação está
preparado em `entregarTexto`. Garantia declarada, sem invenção:

> **at-most-once local, por processo, com `UNKNOWN` explícito e sem retry automático.**

---

## 7. Persistência

Jornal **append-only** em `dados/operacoes/<id_usuario>.jsonl`, uma linha por
transição, caminho derivado do `id_usuario` (mesma regra dos shards), fora do git.

**A ordem é o contrato:** primeiro o disco, depois a memória. `executando` é
gravado **antes** de o executor ser chamado — é o que transforma um crash em
`desconhecida` em vez de em silêncio.

Estados persistidos: todos os 11, incluindo `aceita_pelo_provedor`, criado nesta
auditoria porque **aceite não é entrega** e colapsar os dois em "enviado" é a
mentira operacional na forma mais confortável — o provedor de fato respondeu que
sim.

---

## 8. Recovery

| Momento do crash | Volta como | Pode repetir? |
|---|---|---|
| antes de reservar | não existe | sim |
| entre reserva e jornal | não existe no disco | sim (nada executou) |
| `aguardando_autorizacao` | **`expirada`** | precisa de nova confirmação |
| `autorizada`, não consumida | **`expirada`** | precisa de nova confirmação |
| **durante a execução** | **`desconhecida`** | **não — exige consultar o mundo** |
| `aceita_pelo_provedor` | mantém-se | não — exige verificação |
| `verificada` / `falhou` | mantém-se | falhou: sim; verificada: não |

**Restart nunca fabrica autorização.** Uma autorização é fala humana dita a um
processo que não existe mais.

**Crash nunca fabrica falha.** `executando → falhou` autorizaria um retry que
duplica; `executando → desconhecida` obriga a perguntar.

Linha truncada no jornal (crash no meio da escrita) é descartada — o estado
anterior daquela operação já está no arquivo.

---

## 9. Verificação

| Efeito | Como se sabe que aconteceu |
|---|---|
| pasta | `existsSync` no caminho resolvido |
| aplicativo | **não se sabe** — processo `detached`/`unref`; `sem_meio_de_verificar` declarado |
| energia | pendência registrada; o desligamento em si não é observável de dentro |
| WhatsApp | **não se sabe hoje** — a Cloud API não permite ler a mensagem enviada; status chega por webhook assíncrono |

**Só `fonte: 'verificador'` promove a `verificada`.** Executor, porteiro, relógio,
operador, provedor e reidratação são todos recusados por `transicionar`. Sem
verificador, a operação **descansa em `aceita_pelo_provedor`** — que sabe mais
que `desconhecida` e menos que `verificada`, e é exatamente o que se sabe.

---

## 10. Concorrência

`reservar` é **síncrono**, e essa é a garantia inteira: Node não cede o laço de
eventos entre o teste e a reserva. O anti-padrão está escrito no código como
aviso:

```ts
if (!existe) { await gravar(); executar() }   // ← a duplicata nasce no await
```

Provado: 2 reservas simultâneas → 1 operação; 10 simultâneas → 1; dois canais do
mesmo operador em paralelo pelo Kernel real → 1 efeito; duas entregas simultâneas
do mesmo evento pelo portal → 1 mensagem. Um **teste de arquitetura** falha se
`reservar` ganhar `async`.

---

## 11. Crash — testado de verdade

`testes/fronteira-efeitos.test.ts` sobe um **processo filho isolado**, faz ele
gravar `executando` no jornal e o mata com **`SIGKILL`** — não interceptável, sem
`finally`, sem handler. Um processo **novo** então reidrata do disco.

Resultado: `desconhecida`, com evidência de fonte `reidratacao`, e o retry do
mesmo efeito **bloqueado**. Não é simulação.

---

## 12. Testes adversariais — segunda e terceira ordem

**11 mutações aplicadas, 11 detectadas** (após corrigir as duas que sobreviveram
na primeira rodada). Cada trava foi removida e um teste caiu.

### Falhas encontradas ATACANDO as próprias correções

**P0-A — dedup valia dentro de um canal, não entre canais** *(2ª ordem, auditoria anterior)*
O Kernel é um por sessão; o mesmo operador tem dois. Índices separados sobre o
mesmo jornal. → `registroOperacoes` singleton + testes 10d/10e/10f.

**P0-B — as duas travas se completavam com `||`** *(3ª ordem, auditoria anterior)*
`resolver_confirmacao` executava o `shutdown` com o dispositivo armado e o jornal
sem pendência. → discordância recusa; testes 34b/34c.

**P0-C — a IARA emudeceria depois da primeira frase repetida** *(3ª ordem, ESTA auditoria)*
Defeito **criado pela correção do D3**. A resposta do canal não tem verificador,
então toda resposta descansa em `aceita_pelo_provedor`. Pela regra de ouro,
qualquer resposta futura com o **mesmo texto** — *"Bom dia! Como posso ajudar?"* —
era bloqueada **para sempre**, em silêncio, sem erro visível ao operador.

Reproduzido fora dos testes, antes de existir teste. Corrigido com
`origem_confiavel`. Regressão nas duas direções: 12b (a IARA continua falando) e
12c (a reentrega continua deduplicada), mais 12d travando quem pode usar a flag.

**P1-A — nenhum teste cobria `aceita_pelo_provedor` na regra de ouro** *(3ª ordem)*
A mutação passava com 23/23 verdes: a janela de duplo clique escondia o buraco,
exatamente como escondera a dedup por chave na auditoria anterior. → teste 10b,
que asserta o **tipo** da reserva (`bloqueada` ≠ `duplicada`) para isolar o
mecanismo.

**P2-A — teste que passava com o mecanismo removido** *(2ª ordem, auditoria anterior)*
→ teste 4b isola a dedup por chave usando `escrita_idempotente`.

### Adversariais de conteúdo

Prompt injection por e-mail citado, documento e insistência (*"faça agora"*,
*"já autorizei antes"*, *"ignore a confirmação"*): **zero** operações de risco
alto autorizadas. Confirmação cruzada entre sessões: recusada. Cancelamento
seguido de *"confirmo"*: não executa.

---

## 13. Débitos e exclusões

### Exclusões argumentadas (não são débitos ocultos)

**E1 — `MemoriaOperacional` não passa pelo portal.**
São as escritas do **registro próprio** da IARA: histórico de conversa, shard do
operador, preferências. Não alcançam terceiro, não são irreversíveis, e são
last-write-wins ou append de log.

Roteá-las pelo portal criaria **regressão infinita**: o portal grava no jornal
para registrar que vai gravar na memória — e o jornal é memória. Qualquer desenho
que tente isso precisa de uma carve-out de qualquer forma; esta é a carve-out,
explícita e testada (allowlist em `A4`).

**E2 — `RegistroOperacoes` não passa pelo portal.** É a própria auditoria.

Consequência: os itens *"Supabase mutável passa pelo Gateway"* e *"filesystem
mutável passa pelo Gateway"* da Fase 19 **não são marcados**. É exclusão
argumentada, não item esquecido.

### P2

1. **Nonce não discrimina em produção.** O vínculo real da confirmação é
   (operação, usuário, sessão, janela, estado). O nonce bloqueia replay via
   máquina de estados, mas o ramo "nonce errado" só é alcançável por chamador que
   carregue um — e "confirmo" é texto livre. Mitigado: `armar` recusa uma segunda
   pendência idêntica, então a mais recente é sempre a que o operador acabou de
   ler.
2. `MemoriaOperacional` não declara semântica de efeito.
3. `appendFile` sem `fsync` — janela de perda em queda de energia.
4. `fecharOperacao` engole erro de transição e publica `FALHA`; degrada para
   `desconhecida` via reidratação (lado seguro), sem teste dedicado.
5. `jaVistas` (dedup de webhook em memória) continua existindo ao lado da dedup
   do jornal. Redundante, não prejudicial — mas é estado duplicado.

### P3

6. Sem trava entre processos no jornal.
7. Jornal cresce indefinidamente; sem compactação nem retenção.
8. Não existe lint no projeto.
9. Webhook de status da Meta (`sent`/`delivered`/`read`) ainda não é consumido —
   é a evidência de `verificador` que promoveria a operação a `verificada`. A
   `referencia` (`wamid`) já é gravada no jornal esperando por ele.

---

## 14. Riscos residuais

| Risco | Natureza | Mitigação atual |
|---|---|---|
| Duplo envio entre **processos** | jornal sem trava entre processos | garantia declarada como "por processo" |
| Entrega não confirmada no WhatsApp | limite do provedor | estado `aceita_pelo_provedor`, nunca "enviado" |
| Perda de linha do jornal em queda de energia | sem `fsync` | operação some → tratada como nunca ocorrida (lado seguro) |
| **Build repo-wide bloqueado** | **edição em curso de outra sessão** em `components/projecao/EntidadePresenca.tsx` (357 linhas, usa `GLSL_COMUM`/`criarFitas` sem os imports) | **não é código desta auditoria**; escopo auditado compila limpo |

---

## 15. Evidências

| Evidência | Onde |
|---|---|
| Fronteira única | `servidor/nucleo/kernel/PortalEfeitos.ts` |
| Contrato de operação | `servidor/nucleo/kernel/Operacao.ts` |
| Jornal | `servidor/nucleo/kernel/RegistroOperacoes.ts` |
| Adaptador WhatsApp | `servidor/nucleo/kernel/integracoes/whatsapp.ts` |
| Canal corrigido | `servidor/canais/PortaWhatsapp.ts` |
| **Teste de arquitetura** | `testes/fronteira-efeitos.test.ts` (A1–A6, 12d) |
| Crash real SIGKILL | `testes/fronteira-efeitos.test.ts` (15, 15b) |
| Escrita/idempotência | `testes/cerebro-escrita-integridade.test.ts` (51) |
| Prova final | `scripts/prova-encerramento-escrita.ts` (21 asserções) |

---

## 16. Veredito final

**ENCERRADO COM DÉBITOS.**

Quando a IARA executa uma ação que altera o mundo, existe uma operação
identificável, autorizada por uma fonte tipada, persistida em disco **antes** do
efeito, protegida contra duplicação por três barreiras, executada por **uma única
fronteira**, verificada contra o estado real quando isso é possível — e
representada honestamente na resposta quando não é.

Isso vale hoje para **WhatsApp, shell, filesystem e toda habilidade do catálogo**,
e valerá para **Microsoft Graph, e-mail e qualquer integração futura** por
construção: o adaptador vai em `integracoes/`, o cliente HTTP só pode ser
importado por ele, e o teste de arquitetura falha se alguém tentar o contrário.

O que **não** é reivindicado: nenhuma garantia de entrega, nenhuma garantia de
"exatamente uma vez", nenhum provedor externo real exercitado. O provedor aceitar
não é a pessoa receber, e o estado `aceita_pelo_provedor` existe para que a IARA
nunca confunda os dois.

---

### Nota sobre o método

As três falhas P0 desta linha de trabalho — **P0-A**, **P0-B** e **P0-C** — não
vieram de escrever o código. Vieram de **atacar a correção depois da suíte ficar
verde**. P0-C é o caso mais instrutivo: a correção do D3 estava completa, 356
testes passavam, e ela teria feito a IARA emudecer no WhatsApp em produção — em
silêncio, sem erro, na primeira vez que repetisse uma frase.

O teste de mutação foi o que separou "359 testes verdes" de "359 testes com
dentes". Nas duas rodadas, mutações sobreviveram na primeira tentativa.

> Não parei na primeira suíte verde. Ataquei as correções duas vezes, e as duas
> rodadas encontraram defeito P0.
