# IARA — estado de execução da missão autônoma de 13/08/2026

STATUS=PARTIAL — e parcial **por escopo declarado**, não por falha: a missão
"IARA 2.0" (57 seções) não cabe numa sessão, e fingir que coube seria violar a
regra 45 dela mesma. O que foi feito, foi medido; o que não foi, está nomeado.

Nenhum valor de segredo neste documento.

---

## COMPLETED

**1. Incidente de configuração — causa raiz corrigida** (commit `e5734ef`)
- `Configuracao.ts`: fronteira única entre `process.env` e o sistema; registro
  tipado de 30 variáveis; contaminação DETECTADA e RECUSADA, nunca limpa.
- Falha-fechada nº 0 em `principal.ts`: configuração contaminada → não sobe.
- `configUtilizavel()` substitui `Boolean(env.X?.trim())`: presença ≠ validade.
- Redação no estrangulamento (`SessaoOperador.enviar`, pacote serializado):
  nenhum segredo do processo, nem de formato conhecido, atravessa o socket.
- Autodiagnóstico com 3 estados: ONLINE / OFFLINE (chave contaminada, com
  instrução de conserto) / DEGRADADO (modo local deliberado).
- 21 testes novos (`configuracao-contaminada.test.ts`), valores 100% fabricados,
  incluindo reprodução ponta a ponta do incidente contra o canal real.

**2. Auditoria de vazamento — MEDIDA, não suposta**
- Histórico Git completo dos DOIS repositórios varrido com
  `cat-file --batch-all-objects` (inclui objetos inalcançáveis: commit
  amendado, branch apagada): submódulo 6.066 blobs (3.760 de texto),
  pai 864 blobs (677 de texto). **Nenhuma credencial de formato conhecido.**
- A captura de tela do celular segue sendo a ÚNICA exposição conhecida.
- `AgenteLocal` (as mãos): importa só `mkdir`/`readdir`. **Não existe
  capacidade de leitura de conteúdo de arquivo** — o `.env` não alcança o
  contexto da LLM por esse caminho.
- Fluxo de prompt (`ClienteClaude`): o system é PERSONA + catálogo + camada
  global. Nenhum valor de env entra no prompt. A chave vai só ao SDK.

**3. Barreira de Git** (commit `a0d1eb3`)
- `scripts/varrer-segredos.mjs`: varre staged (linhas adicionadas) ou árvore
  inteira (`--tudo`); bloqueia commit com credencial de formato conhecido; nunca
  imprime valor; reconhece valores de teste pela entropia (caractere repetido),
  sem lista de exceções. Provado nos dois sentidos: árvore limpa passa,
  pseudo-credencial de entropia real bloqueia (exit 1).
- Ligada em `npm run verificar` (modo `--tudo`).

**4. Portões**: typecheck limpo; suíte 730 → **751 testes, 0 falhas**;
`npm run verificar` completo passando com a varredura ligada.

## PARTIALLY_COMPLETED

**Matriz de vazamento (item 18 do gate zero-trust).** Células cobertas por
teste automatizado: ENV→socket (redação), ENV→exceção (`lerConfig` sem valor),
ENV→subida (falha-fechada), staged→Git (varredura), formato alheio→socket
(redação por padrão). Células **não** cobertas: memória/RAG→LLM com DLP
dedicado, PDF→RAG, tool-output→LLM sanitizado. O RAG atual já tem contrato
forte (só hash + assinatura de uma linha, nunca log bruto — invariante do
CLAUDE.md), o que reduz o risco real dessas células, mas não as torna testadas.

## BLOCKED (exigem o operador — nenhum é bloqueio de código)

1. **ROTAÇÃO DAS CREDENCIAIS DA CAPTURA.** `ANTHROPIC_API_KEY` e `CRON_SECRET`:
   CREDENTIAL_COMPROMISED=true, required_rotation=true. Console da Anthropic +
   painel do host. O código já recusa subir com a variável contaminada, mas
   rotação é ato do operador.
2. **Separar as duas variáveis no painel do host** (a contaminação continua lá;
   o deploy não sobe até consertar — deliberadamente).
3. **`agenda_lembretes` no Supabase**: DDL pronta e idempotente em
   `INCIDENTE_CONFIGURACAO.md` §7; exige SQL Editor do console.

## NOT_STARTED — o mapa honesto do "IARA 2.0"

A regra 54 da própria missão manda inspecionar antes de construir. Inspecionei.
Do que a missão pede, **já existe em português** (não duplicar):

| Pedido (missão) | Já existe |
|---|---|
| Policy engine determinística | `PorteiroAutorizacao` + `Seguranca.ts` + `Autonomia.ts` (teto, nunca concessão) |
| Fact/inference/uncertain | `Verdade.ts` + `Investigacao.ts` (confiança CALCULADA de evidência) |
| Verifier pós-execução | `GerenciadorHabilidades` exige prova/postcondition por habilidade |
| Tool contracts | manifesto por habilidade: permissões, risco, timeout, custo, esquema |
| Intent engine | `FuncaoExecutiva` + `Percepcao` (rotas, ambiguidade, esclarecimento) |
| Failure memory | `MemoriaDeSolucoes` (desempata, nunca decide) + `aprendizado-erros` |
| Prompt-injection defense | Cláusula pétrea de fronteira + barreira determinística no roteador |
| Tenant isolation | shards derivados de `id_usuario`, sondagem cruzada barrada no roteador |
| Modo degradado/offline | roteador local resolve sem nuvem e ANUNCIA o modo na interface |
| Kill switch | `encerramento-absoluto` + níveis de `Autonomia` |

O que **não existe** e ficou de fora por ser desproporcional a uma sessão:
- Abstração multi-provedor (`ProvedorModelo` + roteador + fallback OpenAI/local).
  Hoje `ClienteClaude` é o único módulo que toca o SDK — a costura para extrair
  a interface é limpa e pequena, mas fazê-la às pressas no fim de uma sessão
  longa é como se introduz regressão em código estável. É o próximo passo
  natural, com uma ressalva técnica: modelo local de qualidade num desktop
  Windows sem GPU dedicada tem custo/qualidade que precisa ser medido antes de
  prometido.
- Benchmark interno de 700+ tarefas; red team contínuo automatizado; DLP
  semântico de PII (além de credenciais por formato); consenso multi-modelo.

## SECURITY
- Varredura de histórico: PASS (medida, dois repositórios)
- Configuração: PASS (contaminação recusada na subida)
- Redação de saída: PASS (testada contra o canal real)
- Barreira de Git: PASS (provada nos dois sentidos)
- Rotação de credenciais: **PENDENTE DO OPERADOR** — e por isso o veredito
  não é GO.

## TESTS
751/751 PASS · typecheck PASS · `npm run verificar` PASS · CI: inexistente
(não "não verificado" — não há pipeline neste repositório)

## GIT
- Submódulo `main`: `a0d1eb3` — PUSH_STATUS=SUCCESS, confirmado por
  `ls-remote` (hash remoto = local)
- Pai `repositorio-pai`: `d6a7d73` + ponteiro atualizado neste fechamento —
  push pelo refspec `main:repositorio-pai` (o upstream do pai NÃO é a main do
  código; ver `iara-topologia-dos-repositorios`)

## FINAL
FINAL_STATUS=CONDITIONAL_GO
PUSH_CONFIRMED=true
REMOTE_COMMIT=a0d1eb359d6dca04c7fc4e754b747f60e3ed140d
CREDENTIAL_COMPROMISED=true (2: ANTHROPIC_API_KEY, CRON_SECRET — rotação pendente)
SHUTDOWN_AUTHORIZED=true

CONDITIONAL, não GO, por três pendências que só o operador fecha: rotação das
duas credenciais, separação das variáveis no painel do host, DDL do
`agenda_lembretes`. Nada disso é código; tudo está documentado com o passo
exato em `INCIDENTE_CONFIGURACAO.md`.

## NEXT_ACTIONS (ordem recomendada)
1. Rotacionar as duas credenciais (console Anthropic + painel do host).
2. Separar `ANTHROPIC_API_KEY` e `CRON_SECRET` em dois campos no painel.
3. Rodar a DDL de `agenda_lembretes` no SQL Editor.
4. Só então: redeploy. A subida falha-fechada confirma a configuração sã.
5. Sessão futura: extrair `ProvedorModelo` de `ClienteClaude` (costura única),
   e medir um modelo local antes de prometê-lo.
