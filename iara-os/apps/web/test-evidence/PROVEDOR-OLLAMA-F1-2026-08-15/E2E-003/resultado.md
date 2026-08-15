# E2E-003 — OLLAMA_URL declarada, servidor morto (porta fechada)

Executado 15/08/2026, motor de QA em ambiente limpo (porta 3057), navegador da
sessão como usuário real. `OLLAMA_URL=http://127.0.0.1:39999` (porta fechada),
sem chave Anthropic.

## Resultado — PASSOU

1. Cabeçalho mostra o aviso clássico (origem `nenhuma`): "Raciocínio em nuvem
   desligado (sem ANTHROPIC_API_KEY)..." — o aviso de "raciocínio local" NÃO
   aparece, porque a sonda da abertura da sessão falhou. Estado nunca mente:
   configurado ≠ funcionando.

2. USUÁRIO: "Faça um diagnóstico do sistema" → linha exata:
   "○ Raciocínio  OFFLINE  OLLAMA_URL configurada (http://127.0.0.1:39999) mas
   o servidor não responde — o Ollama está desligado, a porta está errada ou a
   rede não alcança. Não é falta de configuração: é servidor declarado e mudo."
   (OFFLINE, não DEGRADADO — mesma distinção da chave contaminada: capacidade
   fora do ar por engano, não modo deliberado.)

3. USUÁRIO: "Me explique a diferença entre logística e cadeia de suprimentos"
   → IARA respondeu honestamente, SEM inventar:
   "Isso exige raciocínio aberto, e a camada de raciocínio está desligada —
   falta a chave da Anthropic no ambiente, e não há Ollama local configurado e
   alcançável. Prefiro dizer isso a improvisar. [...]"

Texto integral da página preservado via get_page_text na transcrição da sessão.
