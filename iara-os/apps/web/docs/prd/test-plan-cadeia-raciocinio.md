# Test plan — cadeia de raciocínio: provedores gratuitos e troca automática

**BASELINE_ID:** CADEIA-RACIOCINIO-2026-08-15 · commit `a94b160` · 967 testes verdes
**Data:** 15/08/2026
**Origem:** a conta da Anthropic zerou e a IARA ficou muda para todo pedido de nuvem —
com a chave PRESENTE, a `FabricaRaciocinio` escolhe `ClienteClaude` na subida e não há
para onde cair quando ele falha em runtime. A operadora pediu uma opção **sem custo**;
a escolha foi **Groq + Gemini juntos, com troca automática**.

## O que muda

1. `servidor/nucleo/ClienteCompativelOpenAI.ts` — UM cliente para os dois provedores
   gratuitos: Groq (`api.groq.com/openai/v1`) e Gemini
   (`generativelanguage.googleapis.com/v1beta/openai`) falam o mesmo dialeto
   (`/chat/completions`, SSE `data:` com `choices[].delta.content`).
2. `servidor/nucleo/CadeiaDeRaciocinio.ts` — implementa `ProvedorRaciocinio` e
   encadeia N provedores: tenta o primeiro; se ele falhar por **cota, chave ou
   indisponibilidade**, passa ao próximo — e **nunca** troca depois que texto já
   chegou ao operador (duplicaria a fala, mesma regra da retentativa).
3. `FabricaRaciocinio` — em `auto`, monta a cadeia com tudo que estiver declarado, na
   ordem: Anthropic (se houver chave) → Groq → Gemini → Ollama.
4. `Configuracao.ts` — declara `GROQ_API_KEY`, `GROQ_MODELO`, `GEMINI_API_KEY`,
   `GEMINI_MODELO` (fronteira de configuração: nada entra por env sem declaração).

## Invariantes que NÃO podem regredir

- **A LLM não escreve estado**: o texto de qualquer provedor passa pelo mesmo
  `interpretarPlano`, mesmo porteiro, mesmas travas. Provedor novo não ganha
  autoridade nenhuma.
- **Infraestrutura declarada, nunca descoberta**: sem chave no ambiente, o provedor
  não existe — nada de sondar serviço alheio.
- **Segredo não vaza**: chave nova entra na redação de `SessaoOperador.enviar` como
  as outras; nunca em log, erro ou snapshot.
- `IARA_PROVEDOR=anthropic|ollama` continua forçando UM provedor, sem cadeia.

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | UN-201 | unit | — | interpretar linha SSE `data: {"choices":[{"delta":{"content":"oi"}}]}` | pedaço "oi" | node:test | stream mudo |
| [ ] | UN-202 | unit | — | `data: [DONE]`, linha vazia, JSON inválido | `null` sem lançar | node:test | uma linha ruim mata o turno |
| [ ] | UN-203 | unit | — | linha com `usage` | tokens de entrada/saída lidos | node:test | telemetria mentindo |
| [ ] | UN-204 | unit | — | corpo de erro `{"error":{"message":"..."}}` | erro extraído legível | node:test | erro opaco |
| [ ] | UN-205 | unit | cadeia com A (falha por cota) e B (ok) | `raciocinar` | resposta de B; origem/modelo refletem B | node:test | IARA muda com alternativa viva |
| [ ] | UN-206 | unit | cadeia com A que JÁ entregou texto e depois falha | `raciocinar` | erro propaga, NÃO tenta B | node:test | fala duplicada |
| [ ] | UN-207 | unit | cadeia com todos falhando | `raciocinar` | `ProvedorIndisponivel` com o motivo do ÚLTIMO, sem engolir | node:test | erro fantasma |
| [ ] | UN-208 | unit | cadeia A indisponível (disponivel=false), B disponível | ler `disponivel` | `true` (a cadeia está disponível se ALGUM está) | node:test | roteador desliga rota que funciona |
| [ ] | UN-209 | unit | erro 429 / "rate limit" / "quota" / "credit balance" / 401 | classificar | todos contam como "tente o próximo" | node:test | cota não dispara troca |
| [ ] | UN-210 | unit | erro de ABORTO do operador (sinal) | classificar | NÃO troca de provedor — o operador cancelou | node:test | cancelar vira retentativa cara |
| [ ] | UN-211 | unit | fábrica com chave Anthropic + Groq declarados | `criarProvedorRaciocinio` | cadeia na ordem [anthropic, groq] | node:test | ordem trocada |
| [ ] | UN-212 | unit | fábrica com `IARA_PROVEDOR=ollama` | idem | só Ollama, sem cadeia | node:test | forçar provedor deixa de valer |
| [ ] | UN-213 | unit | fábrica sem nada declarado | idem | `ClienteClaude` indisponível (modo honesto de hoje) | node:test | regressão do modo honesto |
| [ ] | UN-214 | unit | `redigir` sobre texto com GROQ_API_KEY/GEMINI_API_KEY | conferir | chave redigida | node:test | segredo em log |
| [ ] | INT-201 | integração real | chave Groq no ambiente | turno real contra a API | resposta em português, tokens > 0 | log da rodada | provedor não funciona de verdade |
| [ ] | INT-202 | integração real | chave Gemini no ambiente | idem | idem | log da rodada | idem |
| [ ] | INT-203 | integração real | Anthropic SEM crédito + Groq válido | turno real | a IARA responde (via Groq), sem mensagem de erro | log + UI | o cenário que originou tudo |
| [ ] | RG-201 | regressão | árvore completa | `npm test` | 967+ verdes | log bruto | regressão silenciosa |

## Limite declarado

INT-201..203 exigem chaves reais de Groq/Gemini, que **a operadora precisa criar**
(groq.com e aistudio.google.com, ambos sem cartão). Sem elas, os unitários provam a
lógica e a integração fica PENDENTE — declarada, nunca presumida.

## Decisão de bloqueio

- Qualquer UN-2xx FAIL → BLOCK.
- INT-2xx pendente por falta de chave não bloqueia o merge do código (a cadeia é
  inerte sem chave declarada), mas bloqueia a AFIRMAÇÃO de que "a IARA funciona sem
  crédito" — isso só se diz com o turno real no log.
