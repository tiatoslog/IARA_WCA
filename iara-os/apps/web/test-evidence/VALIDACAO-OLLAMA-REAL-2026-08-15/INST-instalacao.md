# INST — Instalação do Ollama real nesta máquina

Data: 2026-08-15 · Máquina: Windows 11 Home, 15,7 GB RAM, Intel Iris Xe (CPU-only)

## INST-001 — binário

- Fonte: winget, pacote oficial `Ollama.Ollama` 0.32.13
- `winget install --id Ollama.Ollama --exact` → "Instalado com êxito", exit 0
- Binário: `C:\Users\daian\AppData\Local\Programs\Ollama\ollama.exe`
- `ollama --version` → `ollama version is 0.32.13`

## INST-002 — serviço

- `GET http://127.0.0.1:11434/api/tags` → HTTP 200 (serviço sobe com o app)
- Porta exposta APENAS em 127.0.0.1 (loopback), conforme a regra de nunca expor
  a 11434 à internet.

## INST-003 — modelo

- `llama3.1` (8.0B, Q4_K_M, 4,92 GB), digest
  `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`
- Incidente real durante a instalação (registrado, não mascarado): o
  `ollama pull` via CLI completou o download (POST /api/pull → 200 em 4m46s)
  mas NÃO registrou o modelo, e uma retentativa via CLI pendurou sem nunca
  alcançar o servidor. Resolução: pull refeito direto pela API HTTP
  (`POST /api/pull`), que retomou dos blobs parciais e fechou com
  `verifying sha256 digest → writing manifest → success`. Modelo listado em
  `/api/tags` na sequência.
- Prova de geração real: `POST /api/chat` ("Diga apenas: pronto") →
  `"Pronto"`, `done_reason:"stop"`, eval 3 tokens / 0,52 s (~6 tok/s em CPU),
  carga fria do modelo 17,9 s.

STATUS: PASSOU (com incidente de instalação documentado acima)
