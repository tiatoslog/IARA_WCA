# CAPABILITY MATRIX

27 habilidades no catálogo. Levantado do código (`servidor/nucleo/kernel/habilidades/`),
não da documentação.

**Regra de classificação**: `IMPLEMENTED` exige código **e** teste **e** execução
observada. Nada foi marcado `IMPLEMENTED` só porque existe código.

| CAPABILITY | RISCO | PERMISSÕES | IDEMPOTÊNCIA | VERIFICADOR | EXECUTOR | STATUS |
|---|---|---|---|---|---|---|
| `agendar_lembrete` | medio | memoria | não idempotente | sim | `Agenda` | UNTESTED_E2E |
| `listar_lembretes` | baixo | memoria | leitura | sim | `Agenda` | UNTESTED_E2E |
| `cancelar_lembrete` | medio | memoria | idempotente | sim | `Agenda` | UNTESTED_E2E |
| `criar_pasta` | medio | escrita | idempotente | sim | ponte → `AgenteLocal` | PARTIAL — unitário sim, E2E com braço real não |
| `abrir_aplicativo` | medio | escrita | **não idempotente** | sim | ponte → `AgenteLocal` | PARTIAL — idem |
| `fechar_aplicativo` | medio | escrita | idempotente | sim | ponte → `AgenteLocal` | PARTIAL — idem |
| `listar_arquivos` | baixo | — | leitura | sim | ponte → `AgenteLocal` | PARTIAL |
| `informacoes_sistema` | baixo | — | leitura | sim | ponte → `AgenteLocal` | PARTIAL |
| `capturar_tela` | medio | escrita | não idempotente | sim | ponte → PowerShell | PARTIAL — só Windows com sessão gráfica |
| `acionar_energia` | **alto** | escrita | idempotente | sim | `AgenteLocal` (pendência 60 s) | PARTIAL — testado com executor espião |
| `resolver_confirmacao` | **alto** | escrita | não idempotente | sim | `AgenteLocal` | PARTIAL — idem |
| `auditar_sistema` | baixo | — | leitura | **não** | interno | UNTESTED_E2E |
| `executar_consulta_sql` | baixo | banco | leitura | **não** | consultas NOMEADAS | UNTESTED_E2E |
| `consultar_memoria_corporativa` | baixo | banco | leitura | **não** | Supabase | NOT_VERIFIED — exige Supabase |
| `extrair_texto_documento` | baixo | banco | leitura | **não** | — | NOT_VERIFIED |
| `diagnosticar_sistema` | baixo | — | leitura | **não** | interno | UNTESTED_E2E |
| `ler_emails` | baixo | rede, memoria | leitura | **não** | integração | NOT_VERIFIED — sem credencial |
| `enviar_whatsapp` | **alto** | rede, **externo** | **não idempotente** | **não** | Meta API | NOT_VERIFIED — sem `WHATSAPP_TOKEN` |
| `buscar_documento_sharepoint` | baixo | rede, banco | leitura | **não** | integração | NOT_VERIFIED |
| `investigar_lentidao` | baixo | — | leitura | **não** | `MotorAnalise` | TESTED_UNIT (`investigacao.test.ts`) |
| `assumir_plano` | baixo | — | idempotente | **não** | `PlanosPropostos` | TESTED_UNIT (`planos-autorizados.test.ts`) |
| `consultar_clima` | baixo | rede | leitura | **não** | API externa | UNTESTED_E2E |
| `consultar_infraestrutura` | baixo | banco | leitura | **não** | base determinística | TESTED_UNIT |
| `consultar_agenda` | baixo | — | leitura | **não** | base determinística | TESTED_UNIT |
| `pesquisar_web` | baixo | rede | leitura | **não** | `BuscaWeb` → DuckDuckGo | UNTESTED_E2E |
| `buscar_historico` | baixo | banco | leitura | **não** | shard privado | TESTED_UNIT |
| `recusar_por_sigilo` | baixo | — | leitura | **não** | `PortaoSigilo` | TESTED_UNIT (F1/F2) |

## Leituras que a matriz obriga

**1. `enviar_whatsapp` é a habilidade mais perigosa do catálogo e a menos
provada.** Risco alto, permissão `externo`, **não idempotente**, **sem
verificador**. Sem verificador, o melhor estado que ela alcança é
`aceita_pelo_provedor` — que, como o próprio `Operacao.ts` explica, prova que a
Meta enfileirou, não que alguém recebeu. Está protegida por três portas
(porteiro recusa origem emergente; `transicionar` exige fonte `operador`;
`externo` não é concedido ao papel `operador`) e por não ter token no ambiente.
**Quando `WHATSAPP_TOKEN` entrar, ela precisa de verificador antes de ser
liberada.**

**2. Nenhuma habilidade de risco alto tem execução observada nesta auditoria.**
As três (`acionar_energia`, `resolver_confirmacao`, `enviar_whatsapp`) foram
exercitadas só com dublês. Isso é o correto para uma suíte — e é exatamente por
isso que a Fase 20 (E2E real) continua devendo.

**3. Onze habilidades de risco baixo não têm verificador**, e está certo: em
risco baixo a leitura é a própria prova (`PoliticaRisco.podeConcluirSemVerificar`).
As de risco médio e alto **todas** têm.

**4. `abrir_aplicativo` é `escrita_nao_idempotente`** — é a habilidade em que o
defeito IARA-001 (duplo clique concorrente) produzia efeito real duplicado.
