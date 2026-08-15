# S1 rodada 1 — FALHOU (registro preservado, protocolo §7)

Data: 2026-08-15 ~13:35–13:50 · Motor isolado porta 3057, `IARA_PROVEDOR=ollama`,
Ollama real 0.32.13, llama3.1 8B Q4_K_M, CPU-only (Iris Xe), 15,7 GB RAM.

## O que aconteceu

- A interface abriu com o aviso correto ("Raciocínio rodando localmente via
  Ollama — nada sai da sua rede") — ver `00-inicial.png` e
  `E2E-004a-pergunta.png`.
- O turno 1 foi roteado para `plano_cognitivo` (decomposição pela LLM) e NÃO
  respondeu dentro dos 420 s do driver. `server.log` do Ollama: cada
  `POST /api/chat` levou 4m05s e 3m42s. Rota cognitiva = 2+ chamadas por turno
  → >7 min por turno.
- O driver estourou o timeout nos turnos e a rodada foi abortada.

## Causas-raiz encontradas (investigação, protocolo §9)

1. **Truncamento silencioso de contexto** — `ollama ps` mostrou
   `CONTEXT 4096`: o binário usa `num_ctx=4096` por padrão e o `ClienteOllama`
   não declarava `options.num_ctx`. A PERSONA sozinha tem ~3,7k tokens — o
   modelo respondia sem nunca ter visto o começo do prompt. O stub dos testes
   (que espelha a doc, não o binário) não podia revelar isso; é exatamente a
   divergência doc≠binário que a lacuna E2E-004 declarava como risco.
2. **Latência real de CPU** — ~4 min por chamada nesta máquina, com memória a
   97,9%.

## Correção aplicada (código, não máscara)

- `ClienteOllama` agora SEMPRE envia `options.num_ctx` (padrão 8192;
  `OLLAMA_CONTEXTO` declara outro valor; valor contaminado é recusado na
  subida por `ConfiguracaoInvalida`, coerente com a fronteira de config).
- Testes novos UN-024/UN-025 fixam o payload no wire (stub em socket real).
- O timeout do driver da rodada 2 subiu para 900 s/turno — isso NÃO é máscara:
  documenta a latência real de um 8B em CPU; a leitura de usabilidade fica no
  relatório final.

Artefatos desta rodada: `00-inicial.png`, `E2E-004a-pergunta.png`, `motor.log`
(rota `plano_cognitivo` auditada às 16:35:52Z e 16:43:40Z sem resposta dentro
do prazo). `result.json` não existe porque o driver foi morto com a árvore de
processos — a ausência é esperada e está documentada aqui.
