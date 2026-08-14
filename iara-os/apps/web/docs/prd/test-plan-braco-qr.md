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
| [x] | QR-003 | Mesma URL, agora COM sessão logada | Gaveta Dispositivos abre sozinha, campo já com o código do pareamento | DOM real: sessão logada de verdade encontrada nesta rodada (perfil persistente do Browser pane), navegação real a `http://localhost:3000/?parear=W7GAPMFC`, `input.parear-codigo.value === 'W7GAPMFC'` confirmado via `document.querySelector` — a gaveta abriu sozinha com o código certo | HIGH — **VERIFIED** (14/08, rodada 2 do orquestrador) na metade que dependia de sessão logada. O toque em "Autorizar" foi disparado de verdade e produziu uma resposta real do servidor, mas falhou por um motivo NÃO relacionado ao QR: `Could not find the table 'public.dispositivos_pareados' in the schema cache` — o Supabase deste ambiente de dev nunca recebeu a migração de `supabase/schema.sql`. Isso é uma lacuna de AMBIENTE (schema não aplicado neste projeto Supabase de teste), não um defeito do fluxo de pareamento — fica nomeado, não escondido, e fora do escopo desta correção (mudar schema de um Supabase de terceiro exige autorização explícita, que não foi pedida). |
| [ ] | QR-004 | Escanear o QR de verdade com câmera de celular | Câmera reconhece o QR e abre o link | vídeo/foto | HIGH — **UNVERIFIED**, exige hardware real (câmera de celular), fora do alcance deste ambiente |
| [x] | QR-005 | Regressão: typecheck + suíte | Sem quebrar nada existente | `tsc --noEmit` limpo; `npm test`: 772/772 (a falha pré-existente de `ClienteGraph.ts` já não aparece mais — corrigida pela sessão concorrente enquanto este trabalho corria) | HIGH — VERIFIED |

## Cuidado tomado durante o teste (registrado por transparência)

Existe uma credencial REAL de produção já gravada nesta máquina (`%APPDATA%\iara\braco.json`, sessão legada com refresh token do Supabase, apontando para `https://iara.up.railway.app`) — rodar `npm run braco` sem cuidado teria reusado essa identidade real e conectado ao motor de produção de verdade. O teste QR-001/002 usou `IARA_CREDENCIAL_BRACO` apontado para um arquivo temporário isolado (apagado ao final) e `IARA_MOTOR` apontado para o servidor de verificação local desta sessão (`localhost:3001`) — nunca tocou a credencial nem o motor reais.

## Regra de execução

QR-003 e QR-004 são os que decidem se o atalho funciona fim-a-fim; ambos dependem de coisas que este ambiente não tem (sessão logada, câmera física). `UNVERIFIED`, não `[x]`.

## Rodada 2 (14/08, orquestrador) — o defeito real que a usuária reportou

Auditoria com o app rodando de verdade encontrou dois defeitos reais nesta funcionalidade, os dois fora do escopo original desta rodada 1 (que só provou que o ASCII imprime e que a URL sobrevive à navegação):

| Check | ID | Achado | Evidência | Severidade |
|---|---|---|---|---|
| [x] | QR-006 | A PWA (mobile e desktop) NUNCA renderiza QR nenhum — só lê `?parear=` da URL para pré-preencher o campo de texto. A usuária real, olhando a gaveta "Dispositivos" tanto no celular quanto no navegador, não via QR em lugar nenhum — porque não havia. `codigoInicial`/`Dispositivos.tsx` (antes desta correção) nunca mencionava que um QR existia. | Screenshot real da usuária (gaveta "Onde a IARA tem mãos", só código de texto) + leitura de `Dispositivos.tsx`, `app/page.tsx`, `PainelConversa.tsx` — nenhum `<img>`/canvas de QR em lugar nenhum do app. | HIGH — corrigido: `Dispositivos.tsx` agora menciona o QR explicitamente na instrução |
| [x] | QR-007 | O ASCII do terminal (`type:'terminal'`) depende de fonte monoespaçada e codepage UTF-8 do console — falha silenciosa e ilegível em `conhost.exe` legado sem `chcp 65001`. Sem forma de reproduzir um console legado real neste ambiente, mas é uma causa plausível e não excludente de "QR não aparece". | Análise de código + PNG gerado e verificado de verdade nesta sessão (`QRCode.toFile`, assinatura PNG confirmada byte a byte, 3585 bytes) como reforço que não depende de terminal nenhum | MEDIUM — mitigado: PNG gravado ao lado do ASCII, caminho impresso no console |

**O que ficou UNVERIFIED, nomeado, não escondido:** decodificação por câmera real do PNG novo (mesmo bloqueio de sempre: sem hardware de câmera neste ambiente) e renderização do `conhost.exe` legado real (sem Windows com console antigo disponível aqui). A confiança no PNG vem de a biblioteca `qrcode` gerar a MESMA matriz de bits para `toFile` e `toString` — só o renderizador de saída muda — e `toString` já tinha sido validado contra um motor real na rodada 1.

**Decisão deliberada, registrada:** NÃO foi adicionado `spawn`/`execFile` para abrir o PNG automaticamente. `testes/fronteira-efeitos.test.ts` (`A4`) confina shell a `AgenteLocal.ts` e mais 4 arquivos declarados; `servidor/braco/principal.ts` não está nessa lista, e abrir uma segunda porta para o shell só para mostrar uma imagem violaria esse invariante. O operador abre o arquivo manualmente se o ASCII sair ilegível — o caminho impresso no console é a instrução.

## B. Instalador empacotado — validado contra produção real

| Check | ID | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|
| [x] | INST-001 | `npm run empacotar:braco` com `IARA_MOTOR=https://iara.up.railway.app` | Gera `dist/braco/iara-braco.exe` sem erro, endereço assado sem prompt | Build real: `iara-braco.exe`, 82 MB, log mostra "Endereço assado: https://iara.up.railway.app" | HIGH — VERIFIED |
| [x] | INST-002 | Rodar o `.exe` gerado (não `tsx`, o binário de verdade) numa credencial isolada | Conecta em produção de verdade, pede código, mostra QR + caixa | Saída real do processo: `[braço] Conectando... em https://iara.up.railway.app`, QR válido, código `DFMC-F3B9` | CRITICAL — VERIFIED, é a prova mais forte deste bloco: o binário que uma operadora abriria numa máquina nova funciona ponta a ponta contra o motor real, sem depender de Node instalado |
| [ ] | INST-003 | Publicar o `.exe` num endereço estável (GitHub Release) e configurar `NEXT_PUBLIC_IARA_INSTALADOR` | Botão "Baixar o programa" na aba Dispositivos funciona para qualquer operadora, sem depender de mim | — | HIGH — **NÃO FEITO**: `gh` não está autenticado neste ambiente; publicar é ação externa que exige confirmação explícita do operador antes de executar (ver conversa) |
| [ ] | INST-004 | Instalar de verdade numa SEGUNDA máquina (não a que já tem credencial de produção) | SmartScreen aparece (esperado, binário não assinado), operadora consegue seguir "Mais informações → Executar assim mesmo", pareia, aparece na lista de Dispositivos | screenshot da 2ª máquina | CRITICAL — **UNVERIFIED**, exige uma segunda máquina física, fora do alcance deste ambiente |

Cuidado tomado: INST-002 rodou com `IARA_CREDENCIAL_BRACO` isolado (apagado ao final), então não gravou nem leu a credencial real de produção desta máquina — o pedido de pareamento em si é uma linha efêmera em memória no motor (expira em 5 min sem uso), sem efeito colateral em disco além do arquivo de teste já removido.
