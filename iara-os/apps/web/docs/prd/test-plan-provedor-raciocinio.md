# Test plan — ProvedorRaciocinio: abstração de provedor + backend Ollama

**Baseline:** submódulo `IARA_WCA` em `8bd488b`, branch `main`, árvore limpa
(exceto `public/sonda-voz.html`, de outra sessão, fora do escopo), Node
v22.17.0. `npm run verificar` (GLSL + segredos + tsc + suíte) rodado no
baseline em 15/08/2026 ANTES de qualquer edição: **908/908 verde, exit 0,
suíte em 49,7 s**. BASELINE_ID: `8bd488b-2026-08-15-verificar-908`.

**Ambiente desta máquina:** Ollama NÃO instalado e porta 11434 fechada
(verificado em 15/08). Consequência declarada: a integração com Ollama real é
coberta por um servidor HTTP local que implementa o contrato documentado do
Ollama (`/api/tags`, `/api/chat` com streaming JSON-lines) sobre socket real.
O E2E contra binário Ollama de verdade fica registrado como LACUNA DE
EVIDÊNCIA (E2E-004), não como PASS.

**Escopo:** plano aprovado em 15/08/2026 (arquivo de plano da sessão):

1. `Persona.ts` — PERSONA extraída byte a byte de `ClienteClaude.ts`.
2. `ProvedorRaciocinio.ts` — contrato + `ProvedorIndisponivel` +
   `normalizarHistorico` (movida, comportamento idêntico).
3. `ClienteOllama.ts` — sonda `/api/tags` (TTL 30 s, getter nunca bloqueia),
   `/api/chat` streaming, retentativa própria (404 não retenta), parser puro
   `interpretarLinhaOllama`.
4. `FabricaRaciocinio.ts` — `IARA_PROVEDOR` anthropic|ollama|auto; auto exige
   `OLLAMA_URL` declarada.
5. `MotorRaciocinio` — campo `provedor`, fim da 2ª fonte de verdade do modelo.
6. Tri-estado `origem_raciocinio` no snapshot; `nuvem_indisponivel` preserva
   semântica.
7. Config: `IARA_PROVEDOR`, `OLLAMA_URL` (natureza url), `OLLAMA_MODELO`.
8. Telemetria (`RACIOCINIO_INICIADO.origem`) e mensagens honestas.

**Requisito inviolável:** com `ANTHROPIC_API_KEY`, comportamento byte a byte
idêntico — payload, prefixo de cache, retentativa e mapeamento de resposta de
`ClienteClaude` não mudam. Evidência: diff revisado + suíte.

## Matriz de casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|-------|----|-----------|--------------|------|--------------------|-----------|-------|
| [x] | UN-001 | unit | histórico começando em `iara` | `normalizarHistorico` | prefixo cortado até o 1º `operador` | `npm test` | 400 da Anthropic em histórico órfão |
| [x] | UN-002 | unit | dois registros `operador` seguidos | idem | fundidos num bloco único com `\n\n` | `npm test` | alternância quebrada |
| [x] | UN-003 | unit | histórico termina em `operador` com o MESMO texto da mensagem corrente | idem | não duplica; texto diferente → funde | `npm test` | mensagem duplicada no prompt |
| [x] | UN-004 | unit | histórico vazio | idem | lista = só a mensagem corrente como `user` | `npm test` | chamada sem mensagem |
| [x] | UN-010 | unit | linha `{"message":{"content":"abc"}}` | `interpretarLinhaOllama` | pedaço `"abc"`, sem final | `npm test` | streaming mudo |
| [x] | UN-011 | unit | linha `done:true` com `prompt_eval_count`/`eval_count` | idem | contagens mapeadas para tokens_entrada/saida; `cache_lido:0`; `recusado:false` | `npm test` | telemetria mentindo |
| [x] | UN-012 | unit | linha malformada / vazia / JSON inválido | idem | ignorada sem lançar | `npm test` | uma linha ruim matar o stream |
| [x] | UN-020 | unit | porta TCP fechada (efêmera reservada e liberada) | `sondar()` | `false` em < 2 s; `disponivel` false | `npm test` com medição de tempo | subida do motor travar 30 s |
| [x] | UN-021 | unit | sonda nunca rodou / falhou | `raciocinar()` | lança `ProvedorIndisponivel` | `npm test` | chamada cega em provedor morto |
| [x] | UN-022 | unit | stub responde 404 em `/api/chat` | `raciocinar()` | falha SEM retentativa (1 requisição no contador do stub) | `npm test` | modelo não baixado gerar 3× espera |
| [x] | UN-023 | unit | stub responde 500 na 1ª, stream ok na 2ª | `raciocinar()` | retenta e devolve texto; contador = 2 | `npm test` | transitório derrubar turno |
| [x] | UN-030 | unit | ambiente injetado: chave Anthropic válida | `criarProvedorRaciocinio` | instância `ClienteClaude` (`origem:'nuvem'`) | `npm test` | regressão do caminho pago |
| [x] | UN-031 | unit | sem chave + `OLLAMA_URL` | idem | instância `ClienteOllama` (`origem:'local'`) | `npm test` | modo local não ligar |
| [x] | UN-032 | unit | sem chave, sem `OLLAMA_URL` | idem | `ClienteClaude` com `disponivel:false` (modo honesto atual) | `npm test` | mensagem honesta sumir |
| [x] | UN-033 | unit | `IARA_PROVEDOR` forçado nos dois sentidos | idem | forçado vence o auto | `npm test` | operador sem controle explícito |
| [x] | UN-034 | unit | `IARA_PROVEDOR=ollama` SEM `OLLAMA_URL` | idem | `ClienteOllama` com URL padrão 127.0.0.1:11434 | `npm test` | default surpreendente |
| [x] | UN-040 | unit | `definirOrigemRaciocinio('local')` | ler estado | `origem_raciocinio:'local'` E `nuvem_indisponivel:true` sob a mesma trava | `npm test` | os dois campos divergirem |
| [x] | UN-041 | unit | `definirOrigemRaciocinio('nuvem')` | idem | `nuvem_indisponivel:false` | `npm test` | aviso falso na UI |
| [x] | UN-042 | unit | snapshot compilado após UN-040 | `compilar()` | snapshot carrega `origem_raciocinio` | `npm test` | projeção cega ao campo novo |
| [x] | IT-001 | integration | stub Ollama em socket real (porta efêmera): `/api/tags` 200 + `/api/chat` streaming 3 linhas + done | `sondar()` depois `raciocinar()` | pedaços chegam via `aoReceberTexto` na ordem; texto agregado; contagens do done | `npm test` (servidor `node:http` real, sem mock de função) | contrato de wire quebrado |
| [x] | IT-002 | integration | stream em andamento | abortar `AbortSignal` no 2º pedaço | promessa resolve/rejeita sem exceção não tratada; nenhum pedaço após aborto | `npm test` | mensagem nova não cancelar a antiga |
| [x] | IT-003 | integration | stub derrubado entre sonda e chamada | `raciocinar()` | erro tratado; cache de alcançabilidade zerado (`disponivel` false no turno seguinte) | `npm test` | 30 s de mentira no TTL |
| [x] | RG-001 | regressão | suíte inteira pós-implementação | `npm test` | todos os testes do baseline + novos, 0 falhas | saída `npm test` | qualquer regressão |
| [x] | RG-002 | regressão | — | `npx tsc --noEmit` | 0 erros | saída tsc | tipo quebrado servidor↔cliente |
| [x] | RG-003 | regressão | diff de `ClienteClaude.ts` | revisão do diff | só: import PERSONA, re-export de tipos, `implements`, visibilidade de `modelo`, `origem`, chamada a `normalizarHistorico`, `extends ProvedorIndisponivel` | `git diff` anexado à evidência | invalidação silenciosa do cache/payload |
| [x] | RG-004 | regressão | A5 generalizado | `autoconhecimento`, `fronteira-interna`, `fronteira-efeitos`, `persona` | verdes; A5 cobre contrato + 2 clientes + fábrica + Persona | `npm test` | provider novo fora da vigilância |
| [x] | RG-005 | regressão | env vars novas no REGISTRO | `node scripts/varrer-segredos.mjs --tudo` | verde; `OLLAMA_URL` validada como natureza url | saída do script | segredo/URL fora da disciplina de config |
| [x] | E2E-001 | Playwright | motor real SEM chave e SEM `OLLAMA_URL`, porta própria | perguntar algo que exige raciocínio | resposta honesta "camada de nuvem desligada"; aviso no PainelConversa | screenshot + console em `test-evidence/PROVEDOR-OLLAMA-F1/` | modo honesto regredir |
| [x] | E2E-002 | Playwright | motor real SEM chave, `OLLAMA_URL` → stub real em socket local | mesma pergunta | resposta gerada pelo caminho local; aviso "raciocínio local"; evento com `origem:'local'` | screenshot + console + network | caminho local não funcionar de ponta a ponta |
| [x] | E2E-003 | Playwright | `OLLAMA_URL` configurada, porta fechada | `diagnosticar` via chat + pergunta aberta | diagnóstico OFFLINE com endereço; resposta honesta | screenshot | estado mentiroso "configurado = funcionando" |
| [ ] | E2E-004 | LACUNA | Ollama real com modelo baixado | — | NÃO EXECUTÁVEL nesta máquina (Ollama não instalado) — risco residual declarado; contrato de wire coberto por IT-001/E2E-002 via stub fiel à documentação | registro nesta linha | divergência entre doc do Ollama e binário real |

## Fluxos não óbvios cobertos

- **Perda de conexão** meio-stream: IT-002/IT-003.
- **Retry**: UN-022 (não retenta 404), UN-023 (retenta 500), corte no 1º token
  herdado do desenho (asserção via contador do stub em IT-001: 1 requisição).
- **Empty state**: UN-004 (histórico vazio), UN-032 (nenhum provedor).
- **Estado inconsistente**: UN-040/UN-041 (dois campos sob a mesma trava).
- **Timeout**: UN-020 (sonda com teto de 1500 ms).
- **Resposta inválida**: UN-012 (linha malformada).
- **Sessão/refresh/back/teclado/double-submit**: N/A — a superfície de UI desta
  mudança é um aviso condicional no `PainelConversa`; nenhum controle novo,
  nenhum formulário. Registrado como decisão, não omissão.

## Regra de bloqueio aplicável

BLOCK se: RG-001..RG-005 falharem; E2E-001/002/003 sem evidência; diff de
`ClienteClaude.ts` contiver mudança fora da lista de RG-003. E2E-004 é lacuna
declarada e não bloqueia sozinha — vira risco residual no relatório final.
