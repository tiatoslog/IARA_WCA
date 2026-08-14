# Test Plan — QR no pareamento do braço (atalho visual) — 2026-08-14

## BASELINE

- `BASELINE_ID`: `BRACO-QR-2026-08-14-F1`
- Submódulo `IARA_WCA`: branch `main`, commit em cima de `f35988f` (voz em tempo real, já commitado).
- Escopo: só o atalho visual de QR sobre o pareamento por código já existente (`servidor/nucleo/Pareamento.ts`, inalterado). Nenhuma mudança de segurança — o código de 8 caracteres continua sendo a autoridade real.

## O que foi encontrado antes de implementar (divergência de spec, registrada)

O pedido original de 13/08 (`iara-braco-instalacao-e-pareamento`) descrevia "o desktop gera QR, o celular já logado aprova". O que existia até esta sessão era só o código digitado (WhatsApp-Web-style). Decisão tomada com o operador: manter o código como segurança real, e o QR entra como atalho — encode um link (`<motor>/?parear=<codigo>`) que abre a PWA já na gaveta certa, com o código pré-preenchido, poupando a digitação mas não o toque em "Autorizar".

## O que foi implementado

- `servidor/braco/principal.ts` — QR em ASCII/bloco Unicode no terminal (`qrcode`, `type:'terminal'`), impresso antes da caixa do código. Falha ao gerar (endereço não vira URL válida) não é fatal — o código sozinho continua funcionando.
- `app/page.tsx` — lê `?parear=` da URL uma vez (depois do login, quando `Sala` monta), remove da URL na hora (evita reabrir com código usado/expirado num F5).
- `components/PainelConversa.tsx` / `components/Dispositivos.tsx` — abre a gaveta Dispositivos automaticamente e pré-preenche o campo do código.

## A. Fluxos principais

| Check | ID | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|
| [x] | QR-001 | Rodar o braço apontado para um motor real, sem credencial gravada | Pede código de pareamento de verdade (HTTP real, não simulado), imprime QR + caixa do código no terminal | Saída real capturada: QR ASCII válido + código `AZJN-P8RR` retornado por `http://localhost:3001/parear/pedir` | HIGH — VERIFIED |
| [x] | QR-002 | URL que o QR encodaria (`<motor>/?parear=<codigo sem hífen>`) aberta num navegador real, SEM login prévio | Página carrega sem erro, query string sobrevive intacta na barra de endereço (não é consumida antes do login) | Navegação real no Browser pane a `http://localhost:3001/?parear=AZJNP8RR`; `window.location.search` confirmado via console: `?parear=AZJNP8RR` | HIGH — VERIFIED (só a metade pré-login; ver bloqueio abaixo) |
| [ ] | QR-003 | Mesma URL, agora COM sessão logada | Gaveta Dispositivos abre sozinha, campo já com `AZJN-P8RR`, um toque em "Autorizar" credencia o dispositivo | screenshot + network | CRITICAL — **UNVERIFIED**, exige login real (mesmo bloqueio da voz: sem credencial de operador neste ambiente) |
| [ ] | QR-004 | Escanear o QR de verdade com câmera de celular | Câmera reconhece o QR e abre o link | vídeo/foto | HIGH — **UNVERIFIED**, exige hardware real (câmera de celular), fora do alcance deste ambiente |
| [x] | QR-005 | Regressão: typecheck + suíte | Sem quebrar nada existente | `tsc --noEmit` limpo; `npm test`: 772/772 (a falha pré-existente de `ClienteGraph.ts` já não aparece mais — corrigida pela sessão concorrente enquanto este trabalho corria) | HIGH — VERIFIED |

## Cuidado tomado durante o teste (registrado por transparência)

Existe uma credencial REAL de produção já gravada nesta máquina (`%APPDATA%\iara\braco.json`, sessão legada com refresh token do Supabase, apontando para `https://iara.up.railway.app`) — rodar `npm run braco` sem cuidado teria reusado essa identidade real e conectado ao motor de produção de verdade. O teste QR-001/002 usou `IARA_CREDENCIAL_BRACO` apontado para um arquivo temporário isolado (apagado ao final) e `IARA_MOTOR` apontado para o servidor de verificação local desta sessão (`localhost:3001`) — nunca tocou a credencial nem o motor reais.

## Regra de execução

QR-003 e QR-004 são os que decidem se o atalho funciona fim-a-fim; ambos dependem de coisas que este ambiente não tem (sessão logada, câmera física). `UNVERIFIED`, não `[x]`.
