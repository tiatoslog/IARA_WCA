# Test plan — calendário real (Google Calendar)

## AMENDA (17/08/2026, durante a implementação) — trocado de provedor

Este plano começou desenhado contra a Microsoft Graph (mesmo provedor de
e-mail/SharePoint). A operadora interrompeu a implementação: não conseguiu a
permissão `Calendars.ReadWrite` no Azure AD (exige consentimento de
administrador do tenant da Atos Log) e pediu para usar **Google Calendar**
em vez disso — uma conta de serviço do Google Cloud não depende de nenhum
admin externo, só do dono do calendário compartilhar o acesso com ela.

Regra da Fase 1 desta skill: não alterar silenciosamente os critérios. Este
parágrafo é o registro da mudança, não uma reescrita do plano original — os
IDs (`CAL-*`) continuam os mesmos porque o CONTRATO (ler/criar evento, arma
pendência, confirma, verifica) não mudou; só o provedor por trás mudou.
Referências a "Microsoft Graph"/"MS_GRAPH_*"/"ClienteCalendario.ts" abaixo
são o desenho ORIGINAL e viraram, na implementação real: Google Calendar,
`GOOGLE_CALENDAR_*`, `ClienteGoogleCalendario.ts` (leitura) +
`ClienteGoogleCalendarioEscrita.ts` (escrita).

## BASELINE

- `BASELINE_ID`: `CALENDARIO-GRAPH-2026-08-17`
- Repositório: `IARA_WCA`, branch `main`, commit `688950e`.
- Working tree: sujo com trabalho de outra sessão concorrente (arquivos de
  `testes/validacao/`, `docs/prd/test-plan-isolamento-cruzado.md`,
  `testes/duplicacao-efeito-adversarial.test.ts`, `test-evidence/CAMPANHA-*`)
  — não tocado por este plano; ver `iara-gate-sistemico`/`sessoes-concorrentes`
  na memória do operador sobre por que a árvore fica assim.
- `.env.local`: `MS_GRAPH_CLIENT_ID/TENANT_ID/CLIENT_SECRET` e
  `MS_GRAPH_CAIXA=daiane@atoslog.com.br` já configurados e validados
  end-to-end (e-mail e SharePoint reais, nesta mesma sessão, antes deste
  plano). `Calendars.ReadWrite` (Aplicativo) pedida à operadora — pode não
  estar concedida ainda no momento da implementação.
- Testes existentes: `testes/graph.test.ts` (16 testes, cobre `ClienteGraph`)
  é o modelo de estilo a seguir para os testes novos deste plano.

## Escopo e recorte explícito

Esta é uma capacidade NOVA (calendário real via Microsoft Graph), distinta
do lembrete interno já existente (`servidor/nucleo/Agenda.ts`, que continua
intocado). Cobre:

- **Leitura** — listar próximos eventos do calendário real.
- **Escrita** — criar um evento real, com o mesmo desenho de confirmação
  (arma pendência → operador confirma → executa) já usado por
  `enviarWhatsapp`.

**Fora de escopo nesta rodada, `UNVERIFIED` por decisão deliberada:**
convidados/attendees no evento (v1 não oferece — evento só no calendário da
própria operadora); edição/cancelamento de evento existente; recorrência;
fuso horário diferente de `America/Sao_Paulo`; chamada real de CRIAÇÃO
contra a caixa de produção (`daiane@atoslog.com.br`) — só leitura é
verificada contra a API real nesta sessão, por instrução explícita da
operadora (criar seria um efeito real na agenda dela sem ela ter confirmado
aqui).

## A. Fluxos principais

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | CAL-R01 | Listar próximos eventos | credenciais de teste (fetch mockado) | pedido de "eventos" | lista eventos, ordenados, em horário local | `calendario-google.test.ts` — VERIFIED (fetch mockado). Real contra a API do Google **NOT TESTED**: sem `GOOGLE_CALENDAR_*` reais nesta sessão (dependia da operadora terminar o Cloud Console, que ficou pendente) | MEDIUM |
| [x] | CAL-R02 | Sem eventos no período | resposta vazia | diz "sem compromissos", não inventa | `calendario-google.test.ts` — VERIFIED | LOW |
| [x] | CAL-W01 | Criar evento — arma pendência | — | "marca reunião..." não cria nada, devolve pedido de confirmação com data já resolvida por `interpretarQuando` | `calendario-arm-confirmar.test.ts` teste 1 (via `Kernel` real) — VERIFIED | HIGH |
| [x] | CAL-W02 | Confirmar → cria de verdade | pendência armada | "confirmo" dispara `resolver_confirmacao` → `AgenteLocal.confirmarCriarEventoCalendario` → provedor (mockado) | `calendario-arm-confirmar.test.ts` teste 1 — VERIFIED. Provedor real (Google) **NÃO** chamado de propósito — ver nota na Fase "Evidência exigida" | CRITICAL |
| [ ] | CAL-W03 | Verificação pós-execução via GET | evento "criado" | reler o evento criado para confirmar | **NÃO IMPLEMENTADO, por decisão consistente com o resto do catálogo**: `resolverConfirmacao.verificar()` trata a resposta SÍNCRONA do provedor como o fato verificado (mesma regra de `enviar_whatsapp` — "a Cloud API não oferece leitura da mensagem enviada; um verificador aqui seria teatro", `fronteira-efeitos.test.ts` A6). Uma releitura via GET é melhoria futura, não regressão desta entrega. | HIGH |

## B. Fluxos não óbvios

| Check | ID | Categoria | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|
| [x] | CAL-B01 | Pedido duplicado (double-submit) | pedir o mesmo evento duas vezes | converge numa pendência só | `calendario-arm-confirmar.test.ts` teste 3 — VERIFIED. Achado durante o teste: a barreira que realmente pega é a do `Kernel` (nível de operação-passo), mais forte que a dedup interna da habilidade — documentado no comentário do teste | CRITICAL |
| [ ] | CAL-B02 | Confirmação de outro operador | operador B tenta confirmar pendência de A | recusado | **NÃO RETESTADO especificamente para calendário** — o interlock é o MESMO mecanismo genérico (`AgenteLocal.valida`, por `id_usuario`+`sessao`) já provado para energia/WhatsApp em `fronteira-interna.test.ts` (G7/G8). Risco residual: baixo, porque o código do interlock não foi tocado, só reutilizado — mas não é a mesma coisa que uma prova direta | CRITICAL |
| [ ] | CAL-B03 | Confirmação expirada (>60s) | confirma depois da janela | pendência já não existe | **NOT TESTED** — exigiria manipular relógio ou esperar 60s reais; mesmo mecanismo genérico de `VALIDADE_PENDENCIA_MS`, não específico deste código | HIGH |
| [x] | CAL-B04 | Cancelamento explícito | "cancela" | pendência descartada, provedor nunca chamado | `calendario-arm-confirmar.test.ts` teste 4 — VERIFIED | MEDIUM |
| [x] | CAL-B05 | `quando` ambíguo | "marca reunião" sem hora | pergunta, nunca chuta | `calendario-arm-confirmar.test.ts` — VERIFIED | HIGH |
| [ ] | CAL-B06 | Retomada multiturno (`pendencia.parametro`) | — | — | **DESCOPADO**: a habilidade segue o padrão mais simples de `agendar_lembrete` (devolve texto pedindo de novo, sem usar o campo `pendencia` estruturado) — mesma escolha do resto do catálogo de agenda, não uma lacuna nova | MEDIUM |

## C. Edge cases

| Check | ID | Categoria | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|
| [x] | CAL-C01 | Sem `GOOGLE_CALENDAR_ID`/credenciais | variáveis ausentes | indisponível, sem bater na rede | `calendario-google.test.ts` — VERIFIED | MEDIUM |
| [x] | CAL-C02 | Chave privada inválida | `createSign` recusa | erro claro, sem bater na rede | `calendario-google.test.ts` — VERIFIED | MEDIUM |
| [x] | CAL-C03 | 403 (falta permissão no calendário) | — | mensagem fala de permissão, não "não encontrei" | `calendario-google.test.ts` (leitura E escrita) — VERIFIED | HIGH |
| [~] | CAL-C04 | 401 (credencial expirada) | — | mensagem fala de credencial | `calendario-google.test.ts` — VERIFIED só na LEITURA; a escrita (`ClienteGoogleCalendarioEscrita`) tem o mesmo `if (resposta.status === 401)` no código mas não ganhou um teste dedicado — gap pequeno, nomeado | HIGH |
| [ ] | CAL-C05 | 404 | calendário inexistente | mensagem clara | **NOT TESTED** — nenhum caso 404 dedicado neste plano | MEDIUM |
| [x] | CAL-C06 | Timeout/rede | fetch rejeita | erro de rede, não "sem eventos" | `calendario-google.test.ts` (leitura E escrita) — VERIFIED | MEDIUM |
| [x] | CAL-C07 | `assunto` vazio | — | recusa antes da rede | `calendario-arm-confirmar.test.ts` — VERIFIED | LOW |
| [~] | CAL-C08 | `duracao_minutos` extremo | negativo/gigante | piso/teto aplicado | `calendario-arm-confirmar.test.ts` — VERIFIED só o PISO (negativo→5min); o TETO (valor gigante→480min) não ganhou caso próprio, só existe no código (`Math.min`) | MEDIUM |
| [ ] | CAL-C09 | Caractere de controle em `assunto`/`local` | CRLF | recusado | **NÃO TESTADO ESPECIFICAMENTE PARA CALENDÁRIO** — coberto pela proteção GENÉRICA de `Habilidade.validar()` (mesma que blinda todo o catálogo, exercitada pelos testes `D1-D4` de fuzzing que continuam verdes) | MEDIUM |
| [x] | CAL-C10 | `fronteira-interna.test.ts` / `fronteira-efeitos.test.ts` | mudança de fronteira | continuam verdes | 43/43 + 30/30 — VERIFIED. Achado no processo: precisou declarar `ClienteGoogleCalendario.ts` (LEITURA_EXTERNA) e `ClienteGoogleCalendarioEscrita.ts` (EFEITO_EXTERNO) nos DOIS arquivos de teste (`Fronteira.ts` sozinho não bastava — `fronteira-efeitos.test.ts` tem seu PRÓPRIO registro independente de POSTs permitidos) | CRITICAL |
| [x] | CAL-C11 | `verificacao.test.ts` | — | habilidade de risco alto tem `verificar()` | 51/51 — VERIFIED | HIGH |
| [x] | CAL-C12 | `habilidades.test.ts` / `integridade-cognitiva.test.ts` (contrato) | catálogo novo | exemplos, permissões, RBAC corretos | VERIFIED (incluindo o teste genérico que checa `externo` não concedido a `operador`) | MEDIUM |
| [x] | CAL-C13 | Suíte completa (`npm test`) | fim da implementação | 0 regressão | **1281/1285 passando.** As 4 falhas são em `testes/escape-sandbox-adversarial.test.ts` — não importa nenhum arquivo tocado por este plano (confirmado lendo os imports), não estava rastreado pelo git antes desta sessão (pertence a outra sessão concorrente rodando na mesma árvore) — PRÉ-EXISTENTE, não regressão. `npx tsc --noEmit` limpo. | CRITICAL |

## Evidência exigida

Backend puro, sem superfície de UI nova (a habilidade é acionada pelo mesmo
chat já testado em auditorias anteriores) — Playwright não se aplica a este
plano.

**O que rodou de verdade nesta sessão:**
- `node --import tsx --test testes/calendario-google.test.ts` — 16/16.
- `node --import tsx --test testes/calendario-arm-confirmar.test.ts` — 7/7,
  contra o `Kernel` REAL (não um stub) — prova que `resolver_confirmacao`
  realmente despacha para `criar_evento_calendario` e não só que o cliente
  HTTP está correto isoladamente.
- `node --import tsx --test "testes/**/*.test.ts"` — 1281/1285, 4 falhas
  pré-existentes não relacionadas (ver CAL-C13).
- `npx tsc --noEmit` — limpo.

**O que NÃO rodou, por decisão explícita da operadora, não por limitação de
ferramenta:** nenhuma chamada real de CRIAÇÃO de evento contra a API do
Google — isso teria criado um evento de verdade na agenda dela sem
confirmação humana nesta conversa. A LEITURA real (listar eventos) ficou
pendente por outro motivo: a operadora não tinha terminado de configurar o
Google Cloud (conta de serviço + calendário compartilhado) no momento em que
esta rodada de testes foi escrita. Validar a leitura real, no mesmo formato
já usado para e-mail/SharePoint (chamada direta contra a API, evidência
colada na conversa), é o próximo passo natural assim que
`GOOGLE_CALENDAR_CLIENT_EMAIL/PRIVATE_KEY/ID` estiverem preenchidos.
