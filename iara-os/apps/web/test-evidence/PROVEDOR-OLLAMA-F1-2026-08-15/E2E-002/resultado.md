# E2E-002 — sem chave Anthropic, OLLAMA_URL no stub (modo auto)

Executado 15/08/2026, motor de QA em ambiente limpo (porta 3057), navegador da
sessão como usuário real (seletor local, operadora Daiane). Stub do contrato
Ollama (`stub-ollama.mjs`, socket real 127.0.0.1:30877). Screenshot não pôde
ser composto (painel de navegador sem exibição na sessão autônoma) — a
evidência visual é a árvore de acessibilidade e o texto integral da página,
capturados abaixo, mais os logs do stub e do motor.

## Ambiente (qa-cenario.json)
ANTHROPIC_API_KEY='' (apagada), Supabase apagado (seletor local via
NEXT_PUBLIC_IARA_MODO_LOCAL=1), OLLAMA_URL=http://127.0.0.1:30877,
OLLAMA_MODELO=modelo-teste, IARA_PROVEDOR='' (auto), voz externa desligada.

## Resultado — PASSOU

1. Aviso correto no cabeçalho ao abrir a sessão (antes de qualquer turno):
   "Raciocínio rodando localmente via Ollama — nada sai da sua rede. Clima,
   infraestrutura, histórico, hora e busca seguem ativos."
   (prova: sonda na abertura da sessão → origem 'local' → snapshot → UI)

2. Turno de raciocínio aberto — USUÁRIO: "O que você acha da arquitetura deste
   sistema? Me dê sua opinião sincera." → IARA respondeu com o texto do stub:
   "Resposta gerada pelo caminho local. Estou raciocinando nesta máquina, via
   Ollama, sem nuvem — este texto atravessou percepção, planejamento, provedor
   local e barramento até a sua tela."
   Cadeia comprovada: interface → percepção → decisão executiva →
   planejamento (stub devolveu plano JSON de passo único, interpretado) →
   síntese via provedor local (streaming) → barramento → tela.

3. Diagnóstico ao vivo — USUÁRIO: "Faça um diagnóstico do sistema" → linha:
   "● Raciocínio  ONLINE  raciocínio local via Ollama (modelo-teste) em
   http://127.0.0.1:30877"
   Motor ONLINE, Barramento ONLINE, Banco DEGRADADO (arquivos locais — ambiente
   limpo sem Supabase), Executor DEGRADADO (sem braço) — todos coerentes com o
   ambiente de QA.

## Texto integral da página no fim do cenário

(cópia literal de get_page_text)

Raciocínio rodando localmente via Ollama — nada sai da sua rede. Clima,
infraestrutura, histórico, hora e busca seguem ativos.
O que você acha da arquitetura deste sistema? Me dê sua opinião sincera.
Resposta gerada pelo caminho local. Estou raciocinando nesta máquina, via
Ollama, sem nuvem — este texto atravessou percepção, planejamento, provedor
local e barramento até a sua tela.
Faça um diagnóstico do sistema
Diagnóstico da IARA:
● Motor          ONLINE       processo vivo, respondendo a esta conversa (win32)
● Barramento     ONLINE       esta resposta atravessou o WebSocket para chegar até você
◐ Banco          DEGRADADO    persistência em uso: arquivos locais (dados/)
○ Computador     OFFLINE      nenhum braço conectado a este operador
◐ Executor       DEGRADADO    sem braço; ações correm na máquina onde o motor está — que pode não ser a sua
◐ Ferramentas    DEGRADADO    30 no catálogo; sem credencial: Consulta ao banco operacional, Caixa de entrada, Envio de WhatsApp, Busca no SharePoint, Cargas da operação LUFT, Estatísticas da operação LUFT
● Raciocínio     ONLINE       raciocínio local via Ollama (modelo-teste) em http://127.0.0.1:30877

## Console do navegador

Só ruído pré-existente (onnxruntime/VAD da camada de voz, e um aviso transitório
de WebSocket durante o restart do motor de QA). Nenhum erro novo.

## Rede

Só assets do Next (200). A conversa flui pelo WebSocket /barramento.
