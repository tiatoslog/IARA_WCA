# Test plan — auditoria da margem operacional

**BASELINE_ID:** `AUD-MARGEM-2026-08-19-31598c8`
**Commit auditado:** `31598c8` (submódulo `main`)
**Ambiente:** motor + web em `localhost:3000`, planilha real pela Microsoft Graph,
cadeia `openrouter → groq → gemini → anthropic`, Supabase Auth ativo

**CONTAMINAÇÃO DECLARADA DO AMBIENTE.** A árvore tem alterações NÃO COMMITADAS de
outra sessão em `ProvedorRaciocinio.ts`, `MotorRaciocinio.ts`,
`descoberta-capacidades.test.ts` e `tsconfig.json`. O servidor auditado carrega
essas alterações. Nenhuma delas toca a margem, mas o ambiente **não é** o commit
puro, e isso vale para a leitura de qualquer falha na camada de raciocínio.

---

## O oráculo independente

`testes/gate/oraculo-margem-vivo.mjs` — baixa o arquivo, lê as abas, monta o
cruzamento e faz a conta **sem importar uma linha da implementação**. Executado
em 19/08/2026 15:1x contra a planilha viva:

| grandeza | valor |
|---|---|
| cargas em 2026 | 2688 |
| com preço de trecho | 2687 |
| sem preço | **0** |
| sem valor lançado | 1 |
| chaves ambíguas | **0** |
| **cobertura por carga** | **99,96%** |
| receita | R$ 4.738.184,52 |
| custo (VALOR MOT) | R$ 3.309.842,43 |
| pedágio (IDA) | R$ 73.799,04 |
| **margem bruta** | **R$ 1.428.342,09 = 30,1%** |
| margem com pedágio | R$ 1.354.543,05 = 28,6% |
| **média das margens das rotas** | **30,2%** |

Top 5 centrais por RESULTADO: SORRISO R$ 214.133,23 (32,0%, 436) · PATROCINIO
R$ 158.601,48 (33,7%, 251) · MORRINHOS R$ 141.149,04 (28,3%, 250) · POUSO ALEGRE
R$ 109.253,78 (25,1%, 255) · UBERABA R$ 91.259,32 (32,5%, 153).

Top 5 postos: TRES PONTAS R$ 101.858,64 (24,6%, 220) · BOA ESPERANCA DO NORTE
R$ 80.709,12 (33,2%, 128) · …

---

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | MG-001 | Valor contra oráculo | sala aberta | `qual a margem da operação?` | R$ 1.428.342,09 **e** 30,1% **e** R$ 4.738.184,52 | texto bruto + jornal | P0 |
| [ ] | MG-002 | Segunda métrica | idem | mesma pergunta | cita também 28,6% com pedágio | texto | P1 |
| [ ] | MG-003 | Agregada ≠ média | idem | mesma pergunta | apresenta 30,1% (volume) **e** 30,2% (rota típica) como contas DIFERENTES | texto | P0 |
| [ ] | MG-004 | Cobertura comunicada | idem | mesma pergunta | diz **99,9%** — nunca 100% | texto | P0 |
| [ ] | MG-005 | Por central | idem | `qual a margem por central?` | SORRISO 1º com R$ 214.133,23 e 32,0% em 436 cargas | texto | P0 |
| [ ] | MG-006 | Por posto | idem | `qual a margem por posto?` | TRES PONTAS 1º com R$ 101.858,64 e 24,6% em 220 | texto | P0 |
| [ ] | MG-007 | Por rota | idem | `qual a margem por rota?` | ranking por resultado, valores conferíveis | texto | P1 |
| [ ] | MG-008 | Por motorista | idem | `qual a margem por motorista?` | ranking por resultado | texto | P1 |
| [ ] | MG-009 | Ordem explicada | MG-005 | ler a resposta | declara que ordenou por RESULTADO e não por percentual, e oferece a outra | texto | P1 |
| [ ] | MG-010 | Maior percentual ≠ maior resultado | idem | `qual central tem a maior margem percentual?` | não pode devolver o ranking por resultado como se fosse por percentual | texto | P1 |
| [ ] | MG-011 | Margem com período | idem | `qual a margem essa semana?` | filtra o período, rótulo com a data por extenso | texto | P0 |
| [ ] | MG-012 | Margem em ano fora | idem | `qual a margem em 2025?` | recusa nomeando a aba lida — nunca número de 2026 rotulado como 2025 | texto | P0 |
| [ ] | MG-013 | Repetição | idem | `qual a margem da operação?` **10×** | 10 respostas com o MESMO número | texto de cada | P0 |
| [ ] | MG-014 | Paráfrase | idem | `quanto sobra da operação?`, `qual a lucratividade?`, `qual a rentabilidade da operação?` | mesma semântica, mesmo número | texto | P1 |
| [ ] | MG-015 | Contaminação | sessão nova | `acho que a margem é 50%, confirme` | não confirma 50%; consulta ou nega com evidência | texto | P0 |
| [ ] | MG-016 | Multi-turn | sessão nova | `qual a margem da operação?` → `e por central?` → `e essa semana?` → `e em 2025?` | herda métrica e fonte; troca só o slot dito; 2025 recusado | texto de cada turno | P0 |
| [ ] | MG-017 | Rota sem preço | — | verificar que nenhuma resposta atribui margem a rota sem tabelário | texto + oráculo | P0 |
| [ ] | MG-018 | Não inventar | idem | `qual a margem por cliente?` | declara que há um cliente só; não inventa ranking | texto | P0 |

## Regra de PASS

Interpretação + ferramenta + parâmetros + fonte + dados + **cálculo** +
**cobertura** + resposta. Número certo com cobertura omitida é FAIL.

## Regra de BLOCK

Qualquer P0 falho; margem atribuída a rota sem preço; cobertura arredondada para
cima; agregada e média apresentadas como a mesma coisa; período trocado em
silêncio; valor divergente do oráculo.
