# Test plan — botão "Instalar a IARA" (PWA) unificado com o Braço

**BASELINE_ID:** INSTALAR-PWA-2026-08-15 · branch `main` · commit `543221f` · árvore limpa
**Data:** 15/08/2026
**Origem:** a operadora não encontrou como instalar o PWA em https://iara.up.railway.app/ —
o deploy cumpre todos os critérios de instalabilidade (manifest 200, SW ativo, ícones 200,
HTTPS, verificado ao vivo em 15/08), mas o convite de instalação é do navegador e cada
plataforma o esconde num lugar diferente. A IARA passa a oferecer o convite dentro da
própria sala.

## O que muda

1. `app/layout.tsx` — script inline no `<head>` captura `beforeinstallprompt` ANTES da
   hidratação do React e o guarda em `window.__iaraEventoInstalacao`; `appinstalled` limpa
   o guardado. Eventos `iara:instalavel` / `iara:instalada` avisam quem estiver montado.
2. `lib/instalacaoPwa.ts` — classificação PURA do estado de instalação a partir de
   (user agent, standalone, prompt capturado). Sem DOM: testável em Node.
3. `hooks/useInstalacaoPwa.ts` — cola de cliente: lê o guardado, assina os eventos,
   expõe `instalar()`.
4. `components/InstalarIara.tsx` — a gaveta "Instalar a IARA": passo 1 instala o app
   neste aparelho (botão nativo quando o navegador deu o evento; instrução honesta nos
   demais casos), passo 2 aponta para o Braço (download + gaveta Dispositivos).
5. `components/MenuPerfil.tsx` — item "Instalar no aparelho".
6. `components/PainelConversa.tsx` — gaveta `instalar` no tipo `Gaveta` e no render.

## O que NÃO muda (regressão a proteger)

- `RegistrarPWA` (registro do SW) — intocado.
- `app/manifest.ts`, `public/sw.js` — intocados.
- Gavetas existentes (ficha, dispositivos, automacao) — mesmo comportamento.
- O menu de perfil continua fechando ao clicar fora.

## Limite de verificação declarado (antes da execução)

O prompt NATIVO do Chrome (`beforeinstallprompt` real + diálogo do sistema) **não dispara
em ambiente automatizado** (Playwright/headless não considera a página instalável e o
diálogo é do navegador, não da página). Os testes de UI exercitam o caminho com um
evento SINTÉTICO injetado antes do load — isso prova o comportamento da NOSSA camada
(captura, estado, clique, aceite/recusa), e é isolamento legítimo, não prova da
integração com o Chrome real. A prova da integração real é o item MANUAL-001, executado
no deploy após publicar. PASS de UI-0xx não pode ser promovido a prova de MANUAL-001.

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | UN-001 | unit | — | classificar com standalone=true (qualquer UA) | `instalada` | saída do node:test | app instalada reoferecendo instalação |
| [ ] | UN-002 | unit | — | UA iPhone Safari, sem prompt | `ios_safari` | node:test | instrução errada no iPhone |
| [ ] | UN-003 | unit | — | UA iPhone com CriOS/FxiOS/EdgiOS | `ios_navegador` | node:test | mandar instalar num navegador iOS que não instala |
| [ ] | UN-004 | unit | — | UA iPad (Macintosh + toques>1) | `ios_safari` | node:test | iPadOS classificado como desktop |
| [ ] | UN-005 | unit | — | UA desktop Chrome, prompt capturado | `pronta` | node:test | botão nativo não aparecer quando podia |
| [ ] | UN-006 | unit | — | UA desktop, sem prompt | `manual` | node:test | botão morto sem evento |
| [ ] | UN-007 | unit | — | UA Android Chrome, prompt capturado | `pronta` | node:test | Android sem botão |
| [ ] | UI-001 | playwright | sala aberta (modo local), desktop | abrir menu do nome | item "Instalar no aparelho" existe e abre a gaveta | screenshot + DOM | recurso indescobrível |
| [ ] | UI-002 | playwright | evento sintético injetado pré-load | clicar "Instalar a IARA" | `prompt()` do evento é chamado 1x; aceite → mensagem de instalada | screenshot + console (sonda registra chamada) | clique sem efeito |
| [ ] | UI-003 | playwright | evento sintético, userChoice=dismissed | clicar "Instalar a IARA" | recusa não quebra a gaveta; mensagem honesta de como instalar depois; sem erro no console | screenshot + console | recusa vira tela morta |
| [ ] | UI-004 | playwright | clique duplo rápido no botão | dois cliques | `prompt()` chamado no máximo 1x (botão desabilita aguardando) | console da sonda (contagem) | InvalidStateError do Chrome |
| [ ] | UI-005 | playwright | UA iPhone Safari emulado, viewport móvel | abrir gaveta | instrução Compartilhar → Adicionar à Tela de Início; NENHUM botão de prompt | screenshot | instrução impossível no iOS |
| [ ] | UI-006 | playwright | UA iPhone CriOS emulado | abrir gaveta | instrução "abra no Safari" com o endereço | screenshot | beco sem saída no Chrome iOS |
| [ ] | UI-007 | playwright | desktop sem evento sintético | abrir gaveta | instrução do menu do navegador (ícone na barra de endereço); sem botão morto | screenshot | botão que não faz nada |
| [ ] | UI-008 | playwright | display-mode: standalone emulado | abrir gaveta | "já está instalada"; sem botão | screenshot | reoferecer instalação dentro do app |
| [ ] | UI-009 | playwright | gaveta aberta | passo 2 visível | passo do Braço presente; sem `NEXT_PUBLIC_IARA_INSTALADOR` mostra o texto de instalador não publicado (nunca link morto); botão "Conectar computador" troca para a gaveta Dispositivos | screenshot + DOM | link morto / beco |
| [ ] | UI-010 | playwright | gaveta aberta | fechar no ✕ | volta ao fluxo da conversa | screenshot | gaveta presa |
| [ ] | UI-011 | playwright | gaveta aberta | F5 | página volta ao estado padrão sem erro no console | console | crash pós-refresh |
| [ ] | UI-012 | playwright | menu aberto | clicar fora | menu fecha (regressão do popover) | screenshot | regressão do menu |
| [ ] | RG-001 | regressão | árvore com a mudança | `npm test` completo | suíte inteira verde (base 946) | log bruto | regressão silenciosa |
| [ ] | RG-002 | regressão | dev server de QA | gavetas ficha/dispositivos/automacao abrem e fecham como antes | comportamento idêntico | screenshots | quebra de gaveta vizinha |
| [ ] | MANUAL-001 | produção | deploy publicado no Railway | Chrome desktop real: menu → Instalar no aparelho → botão | diálogo NATIVO do Chrome abre; aceitar instala; gaveta passa a dizer instalada | relato da operadora ou screenshot manual | única prova da integração real |

## Decisão de bloqueio

- Qualquer UI-0xx crítico (001, 002, 005, 009) FAIL sem correção → BLOCK.
- RG-001 com qualquer teste vermelho → BLOCK.
- MANUAL-001 pendente NÃO bloqueia o merge (não é executável antes do deploy), mas fica
  registrado como risco residual até alguém confirmar no aparelho real.
