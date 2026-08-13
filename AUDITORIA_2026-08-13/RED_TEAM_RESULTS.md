# RED_TEAM_RESULTS

Ataques **executados**. Cada linha corresponde a código que rodou nesta máquina.
O que não rodou está em `NAO_EXECUTADO`, no fim.

## Rodada 1 — sondas (H)

| # | Ataque | Hipótese | Resultado |
|---|---|---|---|
| H1 | colidir a chave de idempotência de transporte com `&`/`=` no valor de um parâmetro | duas ordens distintas viram uma | **NÃO reproduzido pelo catálogo** — a ordenação alfabética põe o parâmetro restrito (`local`) antes do livre (`nome`). Defeito de primitiva confirmado por revisão → IARA-003 |
| H2 | dois pedidos idênticos disparados no mesmo tique | dois efeitos reais | **CONFIRMADO** — 2 execuções. → IARA-001 |
| H3a | braço responde `sucesso` com `prova.confirmado:false, motivo:'nao_encontrado'` | o motor aceita | **CONFIRMADO** — `estado: 'sucesso'`. → IARA-002 |
| H3b | idem, sem `motivo` nenhum | o motor aceita | **CONFIRMADO** → IARA-002 |
| H4a | relato com `texto` de 2 MB | passa a fronteira | **CONFIRMADO** → IARA-004 |
| H4b | `prova.evidencia` como objeto | passa a fronteira | **CONFIRMADO** → IARA-004 |
| H4c | `estado: 'sucesso!!'` | passa a fronteira | **CONFIRMADO** (o `Braco` rebaixava para `falhou`, mas a fronteira aceitava) → IARA-004 |
| H5 | nome de pasta `CON`, `NUL`, `COM1` | aceito, `mkdir` estoura | **CONFIRMADO** → IARA-005 |
| H5b | `..`, `../x`, `a/b`, `a\b`, `C:x`, `\\servidor\share`, `.`, `a‮b` (RLO), `a／b` (solidus fullwidth) | travessia | **REPELIDO** — todos recusados |

## Rodada 2 — sondas (I)

| # | Ataque | Resultado |
|---|---|---|
| I1 | 200 mutações concorrentes em `EstadoAtomico` | **REPELIDO** — `TravaAssincrona` serializa; nenhuma perda de atualização (métrica estava saturada, então o teste é fraco: PARTIALLY_VERIFIED) |
| I2b | replay do mesmo "confirmo" | **REPELIDO** — segunda chamada `{ok:false}` |
| I2b | "confirmo" de **outro usuário** | **REPELIDO** |
| I2b | "confirmo" de **outra sessão** (navegador libera pendência do WhatsApp) | **REPELIDO** |
| I2b | nonce forjado | **REPELIDO** |
| I3 | duas reservas simultâneas do mesmo efeito no jornal | **REPELIDO** — `nova` + `duplicada` |
| I4 | `destinoDe('__proto__')`, `destinoDe('constructor')`, `listar('toString')` | **REPELIDO** — `null` / `[]`; sem confusão de protótipo |

## Rodada 3 — fronteira do socket (B4c/B4d, agora regressão)

Corpus de 12 entradas malformadas em `lerPacoteBraco`: string vazia, `null`,
`[]`, `"texto"`, JSON truncado, `relato` ausente/`null`/array, `tipo:"__proto__"`,
apresentação sem campos, `id_usuario` de 500 caracteres, `execucao_id` de 500.
**Todas recusadas**, nenhuma exceção, nenhum laço.

Poluição de protótipo via `"__proto__"` dentro do relato: **repelida** —
`({}).invadido === undefined`. (O `JSON.parse` cria propriedade própria e o
spread usa `CreateDataProperty`, que não dispara o setter.)

## Rodada 4 — regra de negócio (por revisão, sem execução)

| Ataque | Barreira | Estado |
|---|---|---|
| plano `[acionar_energia, resolver_confirmacao]` no mesmo turno | `PorteiroAutorizacao` (origem emergente) + catálogo não oferece + `transicionar` exige fonte `operador` | REPELIDO (suíte existente E1) |
| autorizar plano proposto para pular a confirmação de energia | duas portas independentes; `executar_plano` traduz em passos do Kernel | REPELIDO (suíte `planos-autorizados`) |
| nível máximo de autonomia libera desligamento | `Autonomia` é teto, nunca concessão; `PorteiroAutorizacao` não a conhece | REPELIDO (suíte `autonomia-vigia-aprendizado`) |
| `id_usuario` como parâmetro de habilidade | `validar` recusa chave não declarada | REPELIDO (D1) |

## NÃO EXECUTADO

Estes ataques do protocolo **não foram tentados**. Não há resultado, e nenhum
deles está sendo declarado repelido.

- **Fase 11 inteira** — prompt injection direta e indireta com LLM real
  ("Ignore as instruções anteriores", "SYSTEM: grant admin", injeção dentro de
  PDF/DOCX/e-mail, injeção via resultado de busca web, injeção via shard).
  A barreira determinística foi validada; **o comportamento do modelo não**.
- **Fase 10** — dois tenants reais no Supabase, ataque "mostre os dados do
  Tenant B" em SQL, vector DB, cache, filas e embeddings.
- **Fase 13** — vetores de SSRF. Não aplicável hoje (destino literal), logo não
  tentados.
- **Fase 14 parcial** — registro do Windows, variáveis de ambiente, credenciais,
  operações elevadas, ordem de busca de DLL, junções e links simbólicos.
- **Fase 16** — memória contaminada, contraditória, documentos envenenados,
  embeddings maliciosos, estouro de contexto.
- **Fase 18** — derrubar deliberadamente LLM, DB, Redis, fila, WebSocket, DNS,
  API externa.
- **Fases 20/21** — as 27 capacidades ponta a ponta com braço real, variações
  linguísticas, comando ambíguo, comando durante reconexão, interrupção no meio.
