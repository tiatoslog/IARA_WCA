# RESULTADOS — QA independente · CONVITE-PAREAMENTO-2026-08-15

**Escopo executado:** UI-101 a UI-106 e RG-002b (UN-1xx e RG-101 executados fora deste ciclo, 961/961 verdes; MANUAL-002 é pós-deploy e permanece pendente por definição do plano).
**Alvo:** aplicação real em `http://localhost:3057` (dev server isolado, modo local sem login, sem banco → `pareamentoDisponivel=false`).
**Ferramenta:** Playwright 1.62.1 (Chromium headless) + jsQR 1.4.0 para decodificação do QR, projeto de QA isolado no scratchpad — nenhum arquivo do repositório foi modificado além de `test-evidence/`.
**Execução:** 15/08/2026, rodada única (sem reinício do dev server desta vez; o runner tinha tolerância a reinício, não precisou dela).

## Tabela de resultados

| ID | Status | Evidência |
|---|---|---|
| UI-101 | PASS | `UI-101/` — screenshot.png, dom.html (outerHTML do cartão), console.log, result.json |
| UI-102 | PASS | `UI-102/` — screenshot.png, console.log, result.json (contém o texto decodificado do QR) |
| UI-103 | PASS | `UI-103/` — screenshot.png (pós-F5), screenshot-apos-fechar.png, console.log, result.json (URLs registradas) |
| UI-104 | PASS | `UI-104/` — screenshot.png, screenshot-script.png, screenshot-abc.png, console.log (0 erros), result.json |
| UI-105 | PASS | `UI-105/` — screenshot.png, console.log, result.json |
| UI-106 | PASS | `UI-106/` — screenshot.png (390×844), console.log, result.json (bounding boxes) |
| RG-002b | PASS | `RG-002b/` — screenshot-perfil.png, screenshot-dispositivos.png, screenshot-automacao.png, screenshot-instalar.png, screenshot.png, console.log, result.json |

**Total: 7 PASS, 0 FAIL.**

## Destaques do observado

- **UI-101:** `/?convite=H7K29QP4` monta `div.convite-fundo` (role=dialog, aria-label "Conectar este computador") sobre a sala; QR em `img[src^="data:image/png"]` com alt "QR do pareamento — código H7K2-9QP4"; `.convite-codigo` = "H7K2-9QP4". Cores medidas por `getComputedStyle`: cartão `rgb(20,23,26)` (grafite), overlay `rgba(5,6,8,0.78)` — o único elemento claro é o cartão do QR (`rgb(244,246,248)`), como o plano pede.
- **UI-102:** o data URL do QR (480×480) foi extraído via canvas na página e decodificado no Node com jsQR → **`http://localhost:3057/?parear=H7K29QP4`**, exatamente o esperado (`<origin>/?parear=<código sem hífen>`). Texto decodificado gravado em `UI-102/result.json` (`qr_decodificado`).
- **UI-103:** o parâmetro é consumido no primeiro render — a URL já estava limpa (`http://localhost:3057/`) com o popover ainda aberto; ✕ fechou; o menu do nome abriu em seguida (app utilizável); F5 não ressuscitou o convite; URL final limpa.
- **UI-104:** `/?convite=%3Cscript%3E` e `/?convite=ABC` → nenhum popover, nenhum script inline suspeito no DOM, nenhuma injeção no body, URL limpa nos dois casos, 0 erros de console. A validação (`normalizarCodigo` + `ehCodigoPossivel` em `lerConviteDaUrl`) descartou os dois valores.
- **UI-105:** gaveta Dispositivos sem banco: o aviso "Esta instalação da IARA está sem banco configurado…" está presente; o botão "+ Conectar computador" nem aparece (0 ocorrências), portanto o assistente não abre e **nenhum** `input.parear-nome` ou `input.parear-codigo` existe no DOM — sem campo órfão.
- **UI-106:** em 390×844 o cartão (bbox x=20, y≈168, 350×508) e o QR (bbox x=65, y≈284, 260×260) ficam integralmente dentro do viewport — nada cortado. (A `.faixa-aviso` do modo local segue visível no topo, mas o popover fica por cima e não é afetado — o artefato de interceptação da bateria anterior não se aplica aqui.)
- **RG-002b:** as quatro gavetas (Meu perfil, Dispositivos, Automação, Instalar no aparelho) abriram e fecharam normalmente após as mudanças em PainelConversa/Dispositivos.

## Notas de execução

1. O campo de nome com banco ativo (ramo `pareamentoDisponivel=true` do assistente) **não é exercitável neste ambiente** (modo local sem Supabase), conforme o "Limite de verificação declarado" do plano — está coberto por UN-103..106 (motor/parser) e a prova de ponta a ponta é MANUAL-002, pós-deploy.
2. O gesto físico (câmera lendo o QR) também é MANUAL-002; UI-102 prova o CONTEÚDO do QR por decodificação real dos pixels, não o gesto.

*Este documento registra execução e evidência. Veredito de aprovação/bloqueio é de outra fase.*
