# TEST_MATRIX

## Suíte, por arquivo

36 arquivos, **669 testes, 669 passando** (baseline eram 641).

| Arquivo | Testes | O que cobre |
|---|---|---|
| `cerebro-escrita-integridade.test.ts` | 51 | jornal, estados de operação, autorização, idempotência semântica |
| `investigacao.test.ts` | 48 | evidência, hipótese, plano, lacuna |
| `invariantes-cognitivos.test.ts` | 35 | invariantes do kernel |
| `cerebro-integridade.test.ts` | 32 | integridade cognitiva |
| `zero-trust-adversarial.test.ts` | 29 | **identidade, selo, prova, tampering, RBAC, sigilo, vazão** |
| **`ponte-execucao-adversarial.test.ts`** | **28** | **NOVO — os 5 defeitos desta auditoria** |
| `fronteira-efeitos.test.ts` | 27 | `execFile`/`spawn` confinados ao `AgenteLocal` |
| `autonomia-vigia-aprendizado.test.ts` | 27 | autonomia como teto, vigia na borda, aprendizado |
| `planos-autorizados.test.ts` | 26 | plano autorizado passa pelas mesmas portas |
| `cerebro-integridade-final.test.ts` | 26 | — |
| `estabilizacao.test.ts` | 25 | voz, escuta, timers |
| `kernel.test.ts` | 24 | laço cognitivo |
| `agenda.test.ts` | 23 | lembretes |
| `ponte-execucao.test.ts` | ~20 | caminho feliz e falhas de rede da ponte |
| `fronteira-interna.test.ts` | 7 | grafo de dependências: quem raciocina não alcança o mundo |
| demais 21 arquivos | ~250 | percepção, persona, projeção, verificação, mentira operacional, WhatsApp, regressões |

## Matriz de fases × cobertura

| Fase | Item | Testes | Estado |
|---|---|---|---|
| 4 | identidade e autoridade | A1–A5 | VERIFIED |
| 5 | execution_id, replay, idempotência | I2b, I3, B1, B1b, B3 | VERIFIED |
| 6 | máquina de estados | `cerebro-escrita-integridade`, B2 | VERIFIED |
| 7 | verificação de pós-condição | `verificacao.test.ts`, `mentira-operacional.test.ts`, B2b | VERIFIED |
| 8 | timeout e UNKNOWN | `ponte-execucao.test.ts` (expirou ≠ falhou), B1 (expirou na duplicata órfã) | PARTIALLY_VERIFIED |
| 9 | concorrência | I1, I3, B1, B1b (10 em rajada), B1c | PARTIALLY_VERIFIED — 1000 requisições não testadas |
| 10 | multi-tenant | A4, A5, F1, I4 | PARTIALLY_VERIFIED — sem Supabase |
| 11 | prompt injection | F1, F2 (barreira determinística) | **NOT_VERIFIED** — sem LLM |
| 12 | tool abuse | D1, D2, D6, E1, E3 | VERIFIED |
| 13 | SSRF | — | N/A (destino literal) |
| 14 | agente Windows | `fronteira-efeitos`, B5, B5c | PARTIALLY_VERIFIED |
| 15 | sandbox | — | **NOT_IMPLEMENTED** |
| 16 | memória / RAG | — | **NOT_VERIFIED** |
| 17 | fuzzing | D3, D4, D5, B4 (14), B4c, B4d, alvo 6 | PARTIALLY_VERIFIED — sem property-based |
| 18 | fault injection | D7 (provedor explode) | **NOT_VERIFIED** |
| 19 | mutation testing | 1 mutação real | PARTIALLY_VERIFIED |
| 20 | capacidades E2E | — | **NOT_VERIFIED** — sem braço real |
| 21 | intent resolution | `persona`, `decisao`, `Ambiguidade` | PARTIALLY_VERIFIED |
| 22 | ações perigosas | E1, E2, `planos-autorizados` | VERIFIED (com dublês) |
| 23 | observabilidade | campos presentes no log estruturado | PARTIALLY_VERIFIED |
| 24 | regressão | 669/669 | VERIFIED |

## Como reproduzir

```bash
cd iara-os/apps/web
npm install
npm test
```

Só a suíte nova:

```bash
node --import tsx --test testes/ponte-execucao-adversarial.test.ts
```

Provar que ela mata os defeitos (Fase 19):

```bash
git stash push -- iara-os/apps/web/lib/execucao.ts iara-os/apps/web/servidor/nucleo/Braco.ts iara-os/apps/web/servidor/nucleo/AgenteLocal.ts iara-os/apps/web/servidor/braco/principal.ts iara-os/apps/web/servidor/nucleo/BuscaWeb.ts
node --import tsx --test testes/ponte-execucao-adversarial.test.ts   # 15 falham
git stash pop
```
