# S1 rodada 2 — llama3.1 8B: pipeline PROVADO, usabilidade REPROVADA nesta máquina

Data: 2026-08-15 ~13:51–14:12 · Motor isolado 3057 com a correção do
`num_ctx` aplicada · llama3.1 8B Q4_K_M · CPU-only, 15,7 GB RAM.

## O que a rodada provou

1. **A correção do contexto está viva no wire**: `ollama ps` durante a rodada
   → `CONTEXT 8192` (antes da correção: 4096 truncando a PERSONA em silêncio).
2. **O pipeline completa**: o turno 1 atravessou percepção → rota
   (`plano_cognitivo`) → ClienteOllama → retentativa → resposta 200 no kernel.
3. **A retentativa e a honestidade funcionaram ao vivo, no binário real**:
   - a PRIMEIRA carga do modelo com 8192 de contexto derrubou o runner do
     Ollama duas vezes (`llm server error`; `500` após 5m17s e 5m09s —
     `OLLAMA_LOAD_TIMEOUT` de 5 min) — RAM no limite;
   - o `ClienteOllama` tratou os `500` como transitórios e retentou (política
     UN-023), fechando com `200` em 5m04s na terceira tentativa;
   - o erro em voo **zerou o cache da sonda**: o turno seguinte foi roteado
     como "camada de raciocínio desligada" (motor.log 17:09:06Z,
     `rota:raciocinio_direto`) — a IARA não fingiu ter cérebro no intervalo.

## O que a rodada reprovou

- Latência por chamada após a carga: ~5 min. Turno cognitivo (2+ chamadas):
  >15 min. O driver estourou 900 s no turno 1
  (`driver-s1a.log`: TIMEOUT em 922009 ms).
- **Veredito de uso real (protocolo §8): uma pessoa NÃO consegue usar
  llama3.1 8B nesta máquina** (sem GPU dedicada, 15,7 GB RAM). Não é defeito
  do código da IARA: é dimensionamento de modelo para o hardware.

## Decisão

Cenários seguem com `OLLAMA_MODELO=llama3.2:3b` — o botão de configuração que
o produto expõe exatamente para isso. A evidência do 8B fica preservada aqui;
o relatório final registra a recomendação de modelo por classe de hardware.

Artefatos: `00-inicial.png`, `E2E-004a-pergunta.png` (aviso local presente,
turno sem resposta em 900 s), `E2E-004b-memoria-t1.png` (resposta honesta
imediata "camada desligada" após o erro em voo), `motor.log`, e
`server.log` do Ollama (500/500/200 com durações).
