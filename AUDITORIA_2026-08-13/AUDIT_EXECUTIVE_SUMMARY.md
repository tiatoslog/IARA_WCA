# IARA VALIDATION VERDICT

```
STATUS:
CONDITIONAL GO

CRITICAL FINDINGS (P0):   0
HIGH FINDINGS (P1):       2   — os dois corrigidos e com regressão provada
MEDIUM FINDINGS (P2):     2   — os dois corrigidos e com regressão provada
LOW FINDINGS (P3):        3   — os três corrigidos

CORE CAPABILITIES:        7/7 implementadas no catálogo de ponte; 0/7 exercitadas
                              ponta a ponta com braço real nesta auditoria
SECURITY TESTS:           29/29 (suíte zero-trust existente) + 28/28 (nova)
REGRESSION TESTS:         669/669
FUZZ TESTS:               ~40 entradas (fronteira do relato, pacotes do socket,
                              nomes de pasta) — property-based NÃO executado
MUTATION TESTS:           1 mutação real, aplicada por `git stash` do conserto:
                              15/28 dos novos testes morrem sem ele

CROSS-TENANT VIOLATIONS:      0
UNAUTHORIZED EXECUTIONS:      0
REPLAY VIOLATIONS:            0
UNVERIFIED SUCCESS EVENTS:    2 encontrados → 0 remanescentes
UNKNOWN STATE VIOLATIONS:     0
```

Baseline congelado: commit `8d057e2` (`main`, submódulo `IARA_WCA`), Node
v22.17.0, Windows 11, 641 testes verdes e `tsc --noEmit` limpo.
Estado final: **669 testes verdes, `tsc --noEmit` limpo.**

---

## 1. O que foi validado

| Área | Como | Veredito |
|---|---|---|
| Identidade canônica (`Identidade.ts`) | suíte existente A1–A5 | VERIFIED |
| Selo e integridade do jornal | suíte existente B1–B5, C1–C5 | VERIFIED |
| Parameter tampering / esquema | suíte existente D1–D6 | VERIFIED |
| LLM não é fonte de autorização | suíte existente E1–E2 + `PorteiroAutorizacao` + `Operacao.transicionar` | VERIFIED |
| RBAC por papel | suíte existente E3 | VERIFIED |
| Sondagem entre shards | suíte existente F1–F2 | VERIFIED |
| Replay de confirmação (nonce, usuário, sessão) | sonda I2b — 5 variantes, todas recusadas | VERIFIED |
| Reserva concorrente do mesmo efeito | sonda I3 — `nova` + `duplicada` | VERIFIED |
| Isolamento de dispositivos por operador | sonda I4 + revisão de `Braco.receber` | VERIFIED |
| **Idempotência de transporte sob concorrência** | sonda H2 → **defeito** → conserto → B1/B1b/B1c | FIXED + VERIFIED |
| **Coerência `sucesso` × prova** | sonda H3 → **defeito** → conserto → B2/B2b | FIXED + VERIFIED |
| **Chave de idempotência não ambígua** | revisão + B3/B3b/B3c | FIXED + VERIFIED |
| **Fronteira do relato do braço** | sonda H4 → **defeito** → conserto → B4 (14 casos) | FIXED + VERIFIED |
| Nome de pasta (travessia, reservados Windows) | sonda H5 → **defeito** → conserto → B5 | FIXED + VERIFIED |
| Estado atômico sob 200 mutações concorrentes | sonda I1 | PARTIALLY_VERIFIED |

## 2. O que NÃO pode ser considerado validado

Estas fases do protocolo **não foram executadas**. Não há evidência, portanto
não há veredito — e nenhuma delas está sendo declarada segura.

| Fase | Item | Estado | Por quê |
|---|---|---|---|
| 8, 18 | Fault injection completa (LLM, DB, Redis, DNS, backend caindo) | NOT_EXECUTED | exige ambiente de integração com os serviços reais |
| 10 | Dois tenants reais em Supabase (SQL, vector DB, cache, filas) | NOT_EXECUTED | exige projeto Supabase com dois usuários e schema aplicado |
| 11 | Prompt injection direta e indireta com LLM real | NOT_EXECUTED | exige `ANTHROPIC_API_KEY`; a barreira determinística (`Sigilo`, esquema, porteiro) foi validada, o comportamento do modelo não |
| 14, 15 | Sandbox real do agente Windows (Job Objects, restricted tokens, ACL) | NOT_IMPLEMENTED | não existe sandbox no produto hoje; a contenção é a allowlist de `AgenteLocal` |
| 16 | Memória/RAG envenenados, proveniência, conflito | NOT_EXECUTED | — |
| 17 | Fuzzing property-based (`fast-check` ou equivalente) | NOT_EXECUTED | o fuzzing feito foi por corpus fixo |
| 19 | Mutation testing sistemático (Stryker) | NOT_EXECUTED | foi feita **uma** mutação, a do próprio conserto |
| 20, 21 | E2E das habilidades com braço real (`npm run braco`) e variações linguísticas | NOT_EXECUTED | exige sessão gráfica e processo do braço em execução |
| 23 | Observabilidade ponta a ponta (correlação por `execucao_id` em coletor) | PARTIALLY_VERIFIED | os campos existem no log estruturado; não há coletor para provar a reconstrução |

## 3. Riscos que permanecem

1. **Não há sandbox de sistema operacional.** O `AgenteLocal` contém por
   allowlist (aplicativos fechados, três raízes nomeadas, sem `executar_comando`,
   sem `shell: true`), o que é forte — mas o processo do braço roda com o token
   do usuário e nada limita o que uma habilidade NOVA poderia alcançar se
   entrasse sem passar pelas mesmas réguas. A trava é revisão de commit, não
   enforcement.
2. **`sucesso` com `sem_meio_de_verificar` continua sendo `sucesso`.** É
   deliberado e correto (o aplicativo que já estava aberto), mas significa que
   `RelatoExecucao.estado === 'sucesso'` sozinho **não** é prova. Quem consumir
   esse campo sem ler `prova.confirmado` reintroduz a mentira. Hoje a quinta
   porta (`GerenciadorHabilidades.executarVerificando`) lê a prova e rebaixa
   para `desconhecido` — mas isso é uma segunda camada, não uma garantia do tipo.
3. **A suíte de 641 testes não detectou nenhum dos cinco defeitos.** Todos
   moravam na diferença entre o que um comentário afirmava e o que a condição ao
   lado dele testava. Cobertura de segurança por leitura de código não substitui
   sonda executada.
4. **Modo local (sem Supabase) aceita o `id_usuario` que o cliente digita.** É o
   comportamento declarado de desenvolvimento, e o motor avisa na subida — mas um
   processo exposto nesse modo não tem isolamento nenhum.

## 4. A IARA pode ir para produção?

**Condicionalmente.** O núcleo determinístico — autorização, jornal,
idempotência semântica, isolamento de shard, catálogo fechado de ações — está
sólido e agora tem regressão para os cinco buracos que existiam na ponte de
execução. O que impede um GO limpo não é um defeito conhecido: é a **ausência de
evidência** nas fases 10, 11, 14/15, 16, 20 e 21.

Condições para converter em GO:

1. rodar a Fase 20/21 com braço real numa máquina Windows, gravando `execucao_id`
   e prova de cada capacidade;
2. rodar a Fase 10 com dois usuários reais no Supabase;
3. rodar a Fase 11 com `ANTHROPIC_API_KEY`, incluindo injeção indireta via
   resultado de busca web e via shard;
4. decidir explicitamente sobre a Fase 15 — ou implementar contenção de SO, ou
   documentar a aceitação formal do risco pelo responsável técnico.
