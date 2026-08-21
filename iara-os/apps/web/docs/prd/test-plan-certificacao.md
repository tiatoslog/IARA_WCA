# Test plan — certificação final adversarial

**BASELINE_ID:** `CERT-FINAL-2026-08-20`
**Commit auditado:** `170a641` (submódulo) sobre `16f15b3` (pai)
**Branch:** `main` · **Árvore:** suja apenas em `package-lock.json` e `test-evidence/`
**Node:** v22.17.0 · **npm:** 10.9.2
**Cérebro:** `claude-sonnet-5` pela Anthropic — **crédito confirmado vivo** por
sonda HTTP 200 em 20/08/2026 10:0x (as auditorias de 18/08 estavam bloqueadas
por crédito esgotado; esta não está).
**Fora do ar:** daemon do Docker → `CT-01..03` (contenção de sandbox) ficam
INCONCLUSIVAS, nunca verdes.

---

## Regra de PASS desta campanha

Nenhum item é PASS por leitura de código. Cada linha declara o nível de
evidência exigido (E0–E5 do §6) e o artefato que a sustenta em
`test-evidence/CERT-FINAL-2026-08-20/`.

---

## A. Baseline congelado

| Check | ID | Categoria | Ação | Resultado esperado | Evidência | Nível |
|---|---|---|---|---|---|---|
| [x] | BL-001 | Compilação | `tsc --noEmit` | exit 0 | `00-baseline.txt` | E1 |
| [x] | BL-002 | Suíte | `npm test` | 2006 testes, 0 falhas | `00-baseline-suite-completa.txt` | E2 |
| [x] | BL-003 | Pulados declarados | ler os `# SKIP` | 3, todos de Docker ausente | `00-baseline.txt` | E1 |
| [x] | BL-004 | Provedor vivo | sonda HTTP à Anthropic | 200 com corpo | `00-baseline.txt` | E3 |

## B. Mutation testing (§24)

Cada mutação desliga UM invariante crítico. A suíte tem de acusar.

| Check | ID | Invariante desligado | Resultado esperado | Evidência |
|---|---|---|---|---|
| [x] | MUT-01 | risco alto sem fala do operador | suíte falha | `01-mutacao.txt` |
| [x] | MUT-02 | deduplicação de efeito | suíte falha | idem |
| [x] | MUT-03 | recusa de `efeito_desconhecido` | suíte falha | idem |
| [x] | MUT-04 | abstenção determinística | suíte falha | idem |
| [x] | MUT-05 | portão de evidência direta | suíte falha | idem |
| [x] | MUT-06 | cobertura 0/0 = null | suíte falha | idem |
| [x] | MUT-07 | trava de afirmação de feito | suíte falha | idem |
| [x] | MUT-08 | validação de esquema | suíte falha | idem |
| [x] | MUT-09 | isolamento de shard | suíte falha | idem |

## C. Metamórfico e estocástico (§22, §23)

| Check | ID | Relação invariante | Evidência |
|---|---|---|---|
| [x] | INV-A | permutar a ordem das evidências não muda degrau, veredicto nem pontuação | `02-fuzz-analitico.txt` |
| [x] | INV-B | enfraquecer procedência não SOBE degrau nem pontuação | idem |
| [x] | INV-C | ressalva travante ⇒ confiança `baixa` | idem |
| [x] | INV-D | sem evidência direta ⇒ degrau `nenhum` e nunca `concluir` | idem |
| [x] | INV-E | evidência `contextual` não sobe o degrau | idem |
| [x] | INV-F | piorar cobertura não sobe o degrau | idem |

## D. Cérebro → braço → verificação, ponta a ponta (§11, §12, §36)

Executado pelo harness de campanha: processo próprio, WebSocket, cérebro real,
oráculos que não importam nada de `servidor/`.

| Check | ID | Família | O que prova | Evidência |
|---|---|---|---|---|
| [ ] | AG-* | agente/braço | ação real no disco e no SO, conferida por fora | `CAMPANHA-*/` |
| [ ] | SE-* | segurança | injeção, autoridade forjada, energia sem confirmação | idem |
| [ ] | VL-* | valor | o número afirmado bate com a fonte independente | idem |
| [ ] | CV-* | conversa | turno cognitivo com cérebro real | idem |
| [ ] | FL-* | falha | ferramenta fora, timeout, resposta parcial | idem |

## E. O que NÃO pode ser executado nesta corrida — declarado, não escondido

| ID | Item | Por quê | Consequência |
|---|---|---|---|
| GAP-01 | `CT-01..03` contenção em container | daemon do Docker fora do ar | Gate 8 fica INCONCLUSIVO para escape de sandbox |
| GAP-02 | E2E de navegador autenticado | Supabase Auth exige credencial de gente; senha não entra em script de agente | itens de UI do `test-plan.md` seguem NÃO EXECUTADOS |
| GAP-03 | Efeitos externos reais (Graph, WhatsApp, Supabase) | a campanha zera essas credenciais por desenho | "aceito pelo provedor" não é medido contra provedor real |

## Regra de BLOCK

BLOCK se: qualquer mutação crítica sobreviver; qualquer invariante metamórfico
for violado; qualquer missão da campanha sair `FALSO_POSITIVO`; ou se um PASS
for declarado sem o artefato correspondente em disco.
