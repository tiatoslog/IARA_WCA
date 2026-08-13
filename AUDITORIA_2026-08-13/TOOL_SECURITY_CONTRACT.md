# TOOL_SECURITY_CONTRACT

## O contrato que existe hoje

Nenhuma ferramenta é chamada diretamente pela LLM. O que existe é
`HabilidadeManifesto` (`servidor/nucleo/kernel/Habilidade.ts`), e ele já cobre a
maior parte do que a Fase 3 pede:

| Campo pedido pela Fase 3 | Campo real | Presente? |
|---|---|---|
| `name` | `id` + `nome` | sim |
| `version` | — | **NÃO** |
| `input_schema` | `esquema` (tipo, obrigatório, padrão, `dentre`, `max`) | sim |
| `output_schema` | — | **NÃO** — a saída é `ResultadoHabilidade{texto, detalhe, resolveu}` |
| `permissions` | `permissoes: Permissao[]` | sim |
| `risk_level` | `risco: 'baixo'\|'medio'\|'alto'` | sim |
| `execution_target` | implícito (ponte vs. processo) | **parcial** |
| `timeout` | `timeout_ms` | sim |
| `retry_policy` | `RETENTAVEL` por código de erro (na ponte) | parcial |
| `idempotency_policy` | `idempotencia: leitura\|escrita_idempotente\|escrita_nao_idempotente` | sim |
| `confirmation_policy` | derivada de `risco` via `PoliticaRisco` | sim |
| `post_condition_verifier` | `Habilidade.verificar?` | sim, mas **opcional** |

## O que o contrato impõe, em código

1. **`validar(esquema, parametros)`** — `Object.hasOwn` (não `in`, que caminha o
   protótipo), tipo exato, `dentre` fechado, teto de texto, **recusa de byte NUL
   e controles C0**. A saída é um objeto novo: nada não declarado atravessa.
2. **`SandboxPorPolitica.verificar`** — o papel precisa poder acionar a
   habilidade **e** conceder todas as permissões dela.
3. **`PorteiroAutorizacao.avaliar`** — risco alto só de origem determinística.
4. **`PorteiroAutorizacao.planejavel`** — habilidade de risco alto nem entra no
   catálogo oferecido à LLM.
5. **`RegistroOperacoes.reservar`** — impressão digital do efeito; devolve
   `nova`, `duplicada` ou `bloqueada`.
6. **`Operacao.transicionar`** — a autorização de risco alto é impossível sem
   evidência de fonte `operador`.
7. **`Habilidade.verificar`** — confere o mundo.

## `REJECT TOOL`: quem não cumpre

A Fase 3 diz: *se uma tool não possui contrato, REJECT*. Aplicando a régua ao
catálogo real:

| Lacuna | Habilidades afetadas | Consequência |
|---|---|---|
| **risco ≥ médio sem verificador** | nenhuma — todas as de risco médio têm | conforme |
| **risco alto sem verificador** | `enviar_whatsapp` | **VIOLAÇÃO DO CONTRATO.** Melhor estado alcançável: `aceita_pelo_provedor`. Está contida por não ter token e por `externo` não ser concedido ao papel `operador` — mas o contrato está descumprido. |
| **sem `version`** | todas | um braço de outra versão não sabe se entende a habilidade; hoje só a `AcaoDesktop` desconhecida é tratada (`FERRAMENTA_INDISPONIVEL`) |
| **sem `output_schema`** | todas | a saída é texto livre que vira insumo do próximo passo. O teto de 8000 caracteres imposto no relato (IARA-004) é a única contenção |

## Recomendações

1. **Bloquear `enviar_whatsapp` até ela ter verificador.** Uma habilidade de
   risco alto, não idempotente e sem pós-condição não deveria estar no registro.
   Sugestão mínima: `verificar` que consulta o status da mensagem na API da Meta
   e devolve `sem_meio_de_verificar` quando o provedor não responder.
2. **Acrescentar `versao` ao manifesto** e carimbá-la no jornal, para que uma
   auditoria consiga responder "qual versão da ferramenta produziu este efeito?".
3. **Tornar `verificar` obrigatório para risco ≥ médio no TIPO**, não por
   convenção — hoje `GerenciadorHabilidades` degrada para `'desconhecido'`
   quando falta, que é honesto mas silencioso.
