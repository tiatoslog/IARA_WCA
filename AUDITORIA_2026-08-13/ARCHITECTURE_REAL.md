# ARCHITECTURE_REAL — o que o código faz, não o que a documentação diz

Levantado por inspeção em `8d057e2`. Onde a documentação e o código divergiam,
vale o código, e a divergência está anotada.

## Processos

| Processo | Entrada | Autoridade | Roda onde |
|---|---|---|---|
| **motor** (`servidor/principal.ts`, porta 8787/3000) | WebSocket `/` (operador), WebSocket `/dispositivo` (braço), webhook WhatsApp | decide tudo | nuvem (Linux) ou máquina do operador |
| **braço** (`servidor/braco/principal.ts`) | WebSocket cliente → motor | **nenhuma** — executa ordem de catálogo fechado | computador do operador (Windows) |
| **projeção** (Next, porta 3000) | `SnapshotCognitivo` | nenhuma | navegador / Tauri |

A conexão é **sempre** braço → motor. Nenhuma porta é aberta no computador do
operador.

## Fronteiras de confiança

```
navegador ──ola{token}──▶ Porta.conectarOperador
                             │  autenticacaoAtiva() ? verificarToken(token) : identidadeLocal(id)
                             ▼
                        OperadorAutenticado{id_usuario, nome, email}   ← ÚNICA fonte de identidade
                             │
                             ├── papelDe()  ← IARA_ADMINS / IARA_SOMENTE_LEITURA (ambiente, nunca LLM)
                             ▼
                        Kernel{sessao, idUsuario, papel}
                             │
   texto do operador ──▶ Percepcao (âncoras determinísticas)
                             │
                             ├── plano DETERMINÍSTICO (receita disparada por âncora)
                             └── plano EMERGENTE (decomposto pela LLM)
                             ▼
                        PorteiroAutorizacao.avaliar({habilidade, risco, origem})
                             │   risco alto + origem emergente → RECUSA
                             ▼
                        RegistroOperacoes.reservar → jornal append-only + nonce
                             │
                        SandboxPorPolitica.verificar(habilidade, permissoes, papel)
                             ▼
                        GerenciadorHabilidades.executarVerificando
                             │   validar(esquema, parametros)  ← recusa chave não declarada, NUL, C0
                             ▼
                        Habilidade.executar → Braco.executar
                             │   fila por operador + idempotência de transporte
                             ▼
                        PonteDispositivos.destinoDe(id_usuario) ──▶ socket do braço
                             │                                        │
                             │                                        ▼
                             │                                   ExecutorDesktop → AgenteLocal
                             │                                        │ allowlist de apps
                             │                                        │ 3 raízes nomeadas
                             │                                        │ spawn sem shell
                             │                                        ▼
                             ◀──────────── RelatoExecucao + ProvaExecucao ─────────
                             │   lerPacoteBraco (fronteira validada campo a campo)
                             │   Braco.receber (portão de coerência sucesso × prova)
                             ▼
                        Habilidade.verificar  ← QUINTA PORTA: confere o MUNDO
                             ▼
                        estado ∈ {verificado, desconhecido, falhou}
```

## As sete portas entre intenção e efeito

1. **Percepção** — âncora determinística no texto do operador decide se há
   receita. A LLM não escolhe habilidade num plano determinístico.
2. **Porteiro** (`PorteiroAutorizacao`) — risco alto só de plano determinístico.
   Segunda barreira: o catálogo oferecido à LLM nem lista habilidade de risco alto.
3. **Jornal** (`RegistroOperacoes`) — reserva com impressão digital do efeito e
   nonce; `duplicada`/`bloqueada` em vez de repetir.
4. **Tipo** (`Operacao.transicionar`) — risco alto só chega a `autorizada` com
   evidência de fonte `operador`. `FonteEvidencia` **não tem** `llm`.
5. **Esquema** (`Habilidade.validar`) — `Object.hasOwn`, tipos, `dentre`, teto de
   texto, recusa de NUL e controles C0.
6. **Sandbox de papel** (`SandboxPorPolitica`) — permissões concedidas pelo papel.
7. **Verificador** (`Habilidade.verificar`) — confere o mundo, não o relato.

## Ponte de execução — estados reais

`recebida → validando → [enviada_ao_dispositivo → recebida_pelo_dispositivo →
executando] → sucesso | falhou | expirou | dispositivo_ausente | duplicada`

Distinções que o código de fato mantém:

- `enviada_ao_dispositivo` ≠ `recebida_pelo_dispositivo` (escrita no socket não é leitura)
- `expirou` ≠ `falhou` (não sei ≠ sei que não)
- `EXPIROU` **não** é retentável (`RETENTAVEL` em `lib/execucao.ts`)
- `dispositivo_ausente` é estado real, com frase própria — nunca executa "em outro lugar"

## Superfícies de ataque inventariadas

| # | Superfície | Autenticação | Estado |
|---|---|---|---|
| 1 | WebSocket `/` (operador) | token Supabase, ou id digitado em modo local | validado |
| 2 | WebSocket `/dispositivo` (braço) | mesmo token; `id_usuario` do pacote é decoração | validado |
| 3 | Relato do braço → motor | nenhuma além da sessão do socket | **corrigido nesta auditoria** (IARA-002, IARA-004) |
| 4 | Webhook WhatsApp | `PortaWhatsapp` | NÃO auditado nesta rodada |
| 5 | `buscarNaWeb` → DuckDuckGo | nenhuma; destino literal e fixo | teto de corpo adicionado |
| 6 | `ANTHROPIC_API_KEY` / `ClienteClaude` | ambiente | NÃO auditado nesta rodada |
| 7 | Shards em disco (`dados/`) | caminho derivado do id canônico | validado (A4) |
| 8 | Jornal `dados/operacoes/*.jsonl` | idem, com selo HMAC quando há chave | validado (B1–B5) |

## Divergências documentação × código encontradas

1. `Braco.ts` afirma cobrir "o operador toca no botão duas vezes". Não cobria
   quando os dois toques eram concorrentes → IARA-001.
2. `Braco.receber` afirma que "um relato dizendo `sucesso` com prova não
   confirmada seria exatamente o falso positivo que esta camada existe para
   impedir". A condição só pegava um dos três formatos → IARA-002.
3. `braco/principal.ts` afirma que a assinatura existe porque "uma cache que
   devolve o relato de OUTRA ação é uma mentira com selo de sucesso". A
   assinatura era ambígua → IARA-003.
4. `AgenteLocal.Pendencia.id` é descrito como "o nonce que dá à pendência uma
   identidade própria, para que 'confirmo' nunca seja um cheque em branco sobre
   o slot atual". **`confirmar(idUsuario, sessao)` não recebe id nenhum** — o
   nonce só aparece na linha de auditoria. A proteção real contra troca
   silenciosa é a frase "Descartei o pedido anterior de …", que existe e
   funciona. Não é defeito explorável hoje (a substituição é sempre anunciada),
   mas o comentário descreve um mecanismo que não está no caminho.
   → ver `SECURITY_FINDINGS.md`, OBS-1.
