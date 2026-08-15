# E2E-001 — sem chave Anthropic e sem OLLAMA_URL (nenhum provedor)

Executado 15/08/2026, motor de QA em ambiente limpo (porta 3057), navegador da
sessão como usuário real.

## Resultado — PASSOU

1. Cabeçalho: aviso clássico preservado byte a byte:
   "Raciocínio em nuvem desligado (sem ANTHROPIC_API_KEY) — clima,
   infraestrutura, histórico, hora e busca seguem ativos."

2. USUÁRIO: "Faça um diagnóstico do sistema" → linha:
   "◐ Raciocínio  DEGRADADO  sem ANTHROPIC_API_KEY e sem OLLAMA_URL: respondo
   pelo caminho local, sem raciocínio livre"
   DEGRADADO (modo deliberado que funciona como projetado) — distinto do
   OFFLINE do E2E-003 (declarado e mudo). O tri-estado do autodiagnóstico
   funciona ao vivo.

Texto integral da página preservado via get_page_text na transcrição.
