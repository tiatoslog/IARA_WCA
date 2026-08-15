# RESULTADOS — QA independente · INSTALAR-PWA-2026-08-15

**Escopo executado:** UI-001 a UI-012 e RG-002 (UN-001..007 e RG-001 executados fora deste ciclo; MANUAL-001 é pós-deploy e permanece pendente por definição do plano).
**Alvo:** aplicação real em `http://localhost:3057` (dev server isolado, modo local sem login).
**Ferramenta:** Playwright 1.62.1 (Chromium headless), projeto de QA isolado no scratchpad — nenhum arquivo do repositório foi modificado além de `test-evidence/`.
**Execução:** 15/08/2026, duas rodadas (ver "Notas de execução"). O `result.json` de cada pasta é o resultado FINAL do item.

## Tabela de resultados

| ID | Status | Evidência |
|---|---|---|
| UI-001 | PASS | `UI-001/` — screenshot.png, console.log, result.json |
| UI-002 | PASS | `UI-002/` — screenshot.png (confirmação "A IARA já está instalada neste aparelho."), console.log, result.json |
| UI-003 | PASS | `UI-003/` — screenshot.png, console.log (0 erros), result.json |
| UI-004 | PASS | `UI-004/` — screenshot.png, screenshot-aguardando.png ("Aguardando o navegador…", disabled=true), console.log, result.json |
| UI-005 | PASS | `UI-005/` — screenshot.png (viewport 390×844), console.log, result.json |
| UI-006 | PASS | `UI-006/` — screenshot.png, console.log, result.json |
| UI-007 | PASS | `UI-007/` — screenshot.png, console.log, result.json |
| UI-008 | PASS | `UI-008/` — screenshot.png, console.log, result.json |
| UI-009 | PASS* | `UI-009/` — screenshot.png, screenshot-passo2.png, console.log (inclui verificação HTTP do instalador), result.json — *ver divergência de pré-condição abaixo |
| UI-010 | PASS | `UI-010/` — screenshot.png, console.log, result.json |
| UI-011 | PASS | `UI-011/` — screenshot.png, console.log (0 erros pós-reload), result.json |
| UI-012 | PASS | `UI-012/` — screenshot.png, screenshot-menu-aberto.png, console.log, result.json |
| RG-002 | PASS | `RG-002/` — screenshot-perfil.png, screenshot-dispositivos.png, screenshot-automacao.png, screenshot.png, console.log, result.json |

**Total: 13 PASS, 0 FAIL.**

## Destaques do observado

- **UI-002:** `prompt()` do evento sintético chamado exatamente 1×; após `{outcome:'accepted'}` a gaveta trocou para `.instalar-confirmacao` = "A IARA já está instalada neste aparelho."
- **UI-003:** após `{outcome:'dismissed'}` a gaveta permaneceu viva, com a mensagem de recusa ("Sem problema — o navegador guarda a recusa por um tempo…") apontando a **barra de endereço**; 0 erros de console.
- **UI-004:** dois cliques rápidos (DOM direto, sem espera de acionabilidade) → `__qaPromptChamadas === 1`; durante a espera o botão exibia "Aguardando o navegador…" com `disabled=true`.
- **UI-005/006:** no UA de iPhone nenhum botão "Instalar a IARA" aparece; Safari recebe a instrução Compartilhar → Adicionar à Tela de Início, CriOS recebe "abra localhost:3057 no Safari".
- **UI-008:** com `display-mode: standalone` emulado, só a confirmação de instalada; nenhum botão.
- **UI-011:** F5 com a gaveta aberta → estado padrão (sugestões "A sala está aberta"), 0 erros de console (só o aviso esperado de raciocínio em nuvem desligado, que não é erro).
- **UI-012 / RG-002:** menu fecha ao clicar fora; gavetas Meu perfil, Dispositivos e Automação abrem e fecham como antes.

## Divergência de pré-condição — UI-009

O plano (e a instrução de execução) assumia `NEXT_PUBLIC_IARA_INSTALADOR` **ausente** neste ambiente, esperando o texto "Ainda não há um instalador publicado". A variável **está definida** em `.env.local:66` deste ambiente (dev 3057 a carrega). O comportamento observado é o ramo correto do código para o ambiente real:

- link `Baixar o Braço` presente, `href` idêntico à env var (`https://wmuromeegnjderebnrsd.supabase.co/storage/v1/object/public/instaladores/iara-braco.exe`);
- o endereço respondeu **HTTP 200** na verificação feita durante o teste (registro no `UI-009/console.log`) — **não é link morto**, que é o risco que o item protege;
- "Conectar um computador →" trocou para a gaveta Dispositivos (`section[aria-label="Computadores conectados"]`), e a gaveta Instalar saiu do DOM.

O ramo "Ainda não há um instalador publicado" **não foi exercitado em UI** neste ambiente: exigiria remover a env var e reiniciar o servidor, ações vedadas a este QA. Ele está coberto pela suíte UN-* (classificação/render por estado) fora deste ciclo. Marcado PASS pelo invariante do item (passo 2 presente, nunca link morto, troca de gaveta funcionando), com esta divergência registrada para o orquestrador decidir se exige a evidência do outro ramo.

## Notas de execução (integridade da evidência)

1. **Duas rodadas.** Na rodada 1 (`_sumario-execucao.json`, mantido como registro bruto) UI-010..012 e RG-002 caíram com `ERR_CONNECTION_REFUSED`: o dev server 3057 reiniciou no meio da execução (PID novo às 19:31; há sessões concorrentes que mantêm esse servidor em laço de reinício). O servidor **não** foi derrubado nem reiniciado por este QA. A rodada 2 reexecutou os itens afetados com tolerância a reinício; os `result.json` finais são os da rodada 2 para UI-005, UI-006, UI-009, UI-010, UI-011, UI-012 e RG-002.
2. **Interceptação no viewport móvel (UI-005/006).** A `.faixa-aviso` ("Modo local sem autenticação…", `position:fixed; top:0; z-index:60`), exclusiva do modo local de QA, cobre o cabeçalho no viewport 390×844 e intercepta o hit-test do Playwright sobre `button.conversa-saudacao`. Os cliques desses dois cenários foram feitos via DOM (`el.click()`), com a nota gravada no `console.log` de cada item. Observação de ambiente, não defeito da mudança sob teste — mas em modo local num telefone real o banner sobrepõe o cabeçalho de fato.
3. **Caminho do prompt por evento sintético.** Conforme o "Limite de verificação declarado" do plano: UI-002/003/004 provam a camada da IARA (captura, estado, clique, aceite/recusa), não a integração com o Chrome real — essa prova continua sendo MANUAL-001, pós-deploy.

*Este documento registra execução e evidência. Veredito de aprovação/bloqueio é de outra fase.*
