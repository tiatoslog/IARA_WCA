
| Origem | Destino | Protocolo | Credencial | Operação real | Status | Latência | Evidência |
|---|---|---|---|---|---|---|---|
| motor | Anthropic Messages API | HTTPS | ANTHROPIC_API_KEY | completar "2+2" e conferir a resposta | **OPERACAO_OK** | 2141 ms | modelo respondeu "4" |
| motor | OpenRouter (compatível OpenAI) | HTTPS | OPENROUTER_API_KEY | completar "2+2" e conferir a resposta | **FALHOU** | 633 ms | respondeu "" em vez de 4 |
| motor | Groq (compatível OpenAI) | HTTPS | GROQ_API_KEY | completar "2+2" e conferir a resposta | **OPERACAO_OK** | 528 ms | modelo respondeu "4" |
| motor | Google Gemini (endpoint compatível) | HTTPS | GEMINI_API_KEY | completar "2+2" e conferir a resposta | **OPERACAO_OK** | 87578 ms | modelo respondeu "4" |
| motor | Ollama local | HTTP | OLLAMA_URL (sem chave) | listar modelos carregados | **OPERACAO_OK** | 9 ms | 2 modelo(s): llama3.2:3b, llama3.1:latest |
| motor | Supabase (service role) | HTTPS/PostgREST | SUPABASE_SERVICE_ROLE_KEY | SELECT com limite em uma tabela real | **OPERACAO_OK** | 697 ms | 7 tabela(s) expostas; SELECT em "erros_assinaturas" devolveu 1 linha(s) |
| navegador | Supabase Auth | HTTPS | NEXT_PUBLIC_SUPABASE_ANON_KEY | ler as configurações públicas do GoTrue | **OPERACAO_OK** | 177 ms | signup ligado; provedores: email |
| motor | Microsoft identity (client credentials) | HTTPS/OAuth2 | MS_GRAPH_CLIENT_SECRET | trocar segredo por token de aplicativo | **OPERACAO_OK** | 385 ms | token emitido, expira em 3599s |
| motor | Graph — planilha de OCIs | HTTPS | MS_GRAPH_OCI_URL | baixar a pasta de trabalho e contar bytes | **OPERACAO_OK** | 885 ms | 2.16 MB, assinatura xlsx confere |
| motor | Graph — caixa de e-mail | HTTPS | MS_GRAPH_CAIXA | listar 1 mensagem da caixa configurada | **OPERACAO_OK** | 51 ms | a caixa respondeu com 1 mensagem(ns) no topo |
| motor | Edge TTS (voz neural) | WSS | nenhuma (serviço gratuito) | sintetizar uma frase e medir os bytes de áudio | **OPERACAO_OK** | 1050 ms | 13536 bytes de MP3 sintetizados |
| motor | WhatsApp Cloud API | HTTPS | WHATSAPP_TOKEN | ler o número configurado | **SEM_CREDENCIAL** | — | variável ausente ou vazia no ambiente |
| motor | Google Calendar | HTTPS | GOOGLE_CALENDAR_PRIVATE_KEY | listar próximos eventos | **SEM_CREDENCIAL** | — | variável ausente ou vazia no ambiente |

OPERACAO_OK: 10   FALHOU: 1   SEM_CREDENCIAL: 2
falharam: OpenRouter (compatível OpenAI)
sem credencial: WhatsApp Cloud API, Google Calendar

## Notas de leitura

**Gemini · HTTP 503 em 49,7 s.** É indisponibilidade do provedor, não configuração
— e o produto JÁ trata: `PRAZO_PRIMEIRO_PEDACO_PADRAO_MS = 10_000` em
`CadeiaDeRaciocinio`, criado com esta justificativa medida no código: *"o gemini
não é lento a responder: é lento a FALHAR. (...) corta o 503 de 43 s em 10."*
A sonda esperou 49 s porque ela não tem prazo; o motor abandona em 10 e vai ao
próximo elo. O elo estava fora no instante da medição, e a cadeia tem outros três.

**Três "falhas" da primeira rodada eram da SONDA, não do produto** — ficam
registradas porque um auditor que só publica os acertos dele não é auditor:
1. `anthropic/claude-3.5-haiku` e `llama-3.3-70b-versatile` — modelos que eu
   inventei. Os padrões reais vêm de `ClienteCompativelOpenAI`.
2. `gemini-2.0-flash` na API nativa — o produto usa o alias `gemini-flash-latest`
   no endpoint COMPATÍVEL.
3. `MS_GRAPH_OCI_URL` buscada como URL de API — ela é um LINK DE
   COMPARTILHAMENTO, e o Graph só a entrega por `/shares/{shareId}/driveItem/content`.
4. `max_tokens: 16` — modelo de raciocínio gasta o teto pensando e devolve
   conteúdo vazio. Media o meu teto, não o provedor.
