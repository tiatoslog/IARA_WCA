# Test Plan — Voz em tempo real: VAD + aceleração de barge-in (fase 1, PWA) — 2026-08-14

## BASELINE

- `BASELINE_ID`: `VOZ-TEMPO-REAL-2026-08-14-F1`
- Submódulo `IARA_WCA`: branch `main`, commit `05dd44d`.
- Working tree: limpo.
- Não é continuação da auditoria de `test-plan.md` (`AUDITORIA-2026-08-14`) — frente nova, arquivo separado para não sobrescrever o registro daquela rodada.
- Escopo definido pelo operador: primeiro a voz em tempo real dentro do PWA (não depende de instalador). Barge-in por VAD é o item 1; agente local de wake-word fora do navegador é fase 2, fora deste plano.

## O que já existe hoje (não é gap, é o ponto de partida)

Levantamento em `hooks/useEscuta.ts` e `hooks/useVoz.ts`:

- **STT** já é contínuo, no navegador, via `SpeechRecognition` (`useEscuta.ts`).
- **Barge-in já existe hoje**, mas é **textual**: só dispara quando o reconhecedor devolve um resultado (parcial ou final) enquanto `iaraFalando === true` (`useEscuta.ts:467-471`). Isso tem a latência do reconhecedor — tipicamente centenas de ms a mais de 1s antes do primeiro resultado parcial.
- **Guarda de eco** hoje é textual e local (`pareceEco`, `useEscuta.ts:191-204`): compara o texto ouvido com o texto que a IARA está falando.
- **Interromper é interromper tudo**: `interromperTudo()` em `app/page.tsx:64-67` chama `voz.silenciar()` (para a síntese local, sem meio-termo) e `interromper()` (cancela o turno no kernel via WS `{tipo:'interromper'}`) — **não existe pausa reversível**. Uma vez chamado, o turno do kernel morre de verdade.

## O que este plano cobre

**Único objetivo desta fase:** acelerar o gatilho de barge-in de "textual, após resultado do reconhecedor" para "acústico, no início da fala" — usando VAD real (Silero, via `@ricky0123/vad-web`) capturado por `getUserMedia` com `echoCancellation`. Mesmo caminho de interrupção de hoje (`interromperTudo`), gatilho novo e mais rápido.

**Decisão de design explícita, registrada aqui para não se perder:** como `interromperTudo()` não tem meio-termo (cancela o turno de verdade), e o modelo VAD pode ter falso positivo (tosse, eco residual sem fone), a mitigação fica inteiramente nos parâmetros do próprio VAD (`positiveSpeechThreshold`, `minSpeechFrames`, `redemptionFrames`) — não numa pausa-e-confirma que exigiria um novo estado "pausado, turno ainda vivo" no kernel (fora de escopo desta fase). Isso é uma troca precisão-por-latência que só a validação AO VIVO com voz real decide se está bem calibrada — não é algo que se prova por leitura de código.

**Fora de escopo nesta fase, nomeado explicitamente como `UNVERIFIED`/não implementado:** agente local de wake-word fora do navegador; pausa reversível do turno do kernel; qualquer mudança no protocolo WebSocket (`lib/protocolo.ts`) ou no `SnapshotCognitivo`; qualquer novo elemento visual reativo (não há fato novo do kernel para acender algo, por invariante do CLAUDE.md).

## A. Fluxos principais

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | VAD-001 | Boot do modelo | ligação aberta (`escuta.ativa` ou vigília) | abrir microfone | VAD carrega modelo/worklet/wasm do CDN padrão da lib (jsdelivr); sem erro de console; falha de rede cai para VAD-004/VAD-009 | rede: `HEAD` para os dois assets exatos usados por `baseAssetPath`/`onnxWASMBasePath` retornou `200` (`vad.worklet.bundle.min.js` e `ort-wasm-simd-threaded.wasm`, versões travadas do `package.json`); console limpo além de 2 warnings de bundling do webpack sobre `require` dinâmico em `onnxruntime-web` (inofensivo, não é erro de runtime) | HIGH — **PARTIAL**: assets confirmados alcançáveis; boot completo do `MicVAD.new()` dentro do app não pôde ser observado (ver nota abaixo) |
| [ ] | VAD-002 | Permissão de microfone | app carregada, sem permissão prévia | ligar a escuta | UM prompt de permissão cobre SpeechRecognition + getUserMedia do VAD (ou dois prompts claros, nunca um silencioso) | screenshot + console | HIGH — NOT TESTED (bloqueado por ambiente, ver nota) |
| [ ] | VAD-003 | Barge-in acelerado | IARA falando (áudio real tocando) | falar por cima | `interromperTudo()` dispara a partir do VAD, antes de qualquer resultado do `SpeechRecognition`; áudio para no instante da fala, não segundos depois | screenshot + console (log de origem do disparo) + timestamp | CRITICAL — **UNVERIFIED**, exige microfone real (ver nota) |
| [x] | VAD-004 | Sem VAD disponível | navegador sem suporte a AudioWorklet/WASM, ou asset 404 | ligar a escuta | escuta funciona normalmente pelo caminho textual de hoje (regressão zero); nenhuma mensagem de erro trava a UI | `getUserMedia` negado de propósito no ambiente de QA (`NotAllowedError`) exercitou de verdade o `.catch()` de `useDeteccaoVocal` — cai para `estado:'indisponivel'` sem lançar exceção; `useEscuta` (caminho textual) não é afetado, é hook irmão independente | HIGH — VERIFIED via caminho de erro real (não simulado por leitura de código) |
| [ ] | VAD-005 | Desligar/religar escuta | escuta ativa com VAD rodando | clicar em desligar e religar | stream do VAD é liberado (`getUserMedia` track parado) ao desligar e recriado ao religar; sem stream órfão consumindo mic em segundo plano | rede/console + indicador de gravação | HIGH — NOT TESTED |

**Nota de ambiente (afeta VAD-002/003/005 e todo o bloco C):** o Browser pane deste ambiente de QA **bloqueia captura real de microfone por política** — `getUserMedia` devolve `NotAllowedError` sempre, confirmado pela própria ferramenta ("microphone access... is blocked in the Browser pane... Don't treat device capture as working"). Não é um bug da feature: é um limite do ambiente automatizado. Não fica implícito como sucesso — fica `UNVERIFIED`.

## B. Fluxos não óbvios

| Check | ID | Categoria | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|
| [ ] | VAD-006 | Duas capturas de mic simultâneas | `SpeechRecognition` (vigília/ligação) + `getUserMedia` do VAD abertos ao mesmo tempo | nenhum dos dois é encerrado pelo navegador por disputa de dispositivo; ambos continuam funcionando | console + screenshot ao longo de 30s+ | HIGH — NOT TESTED (exige microfone real) |
| [ ] | VAD-007 | Múltiplos espelhos (líder de voz) | 2 abas/telas na mesma sessão | VAD roda em cada aba independentemente, mas só a aba `voz_lider` deveria acionar barge-in real (verificar se dispara duplicado em telas que não são líderes) | console das 2 abas | MEDIUM — NOT TESTED |
| [ ] | VAD-008 | Reload durante fala | F5 com IARA falando | sem erro, VAD remonta limpo na nova carga, sem stream pendurado da carga anterior | console + screenshot | MEDIUM — NOT TESTED |
| [ ] | VAD-009 | Falha ao baixar asset do modelo | simular 404/rede lenta no asset do VAD | UI não trava; cai para caminho textual (mesmo resultado de VAD-004) | network + console | MEDIUM — NOT TESTED diretamente, mas mecanismo é o mesmo `.catch()` já exercitado em VAD-004 |
| [ ] | VAD-010 | Permissão negada | negar permissão de microfone | mensagem existente de `useEscuta` ("Permissão de microfone negada...") continua correta; VAD não gera um segundo erro conflitante | screenshot + console | MEDIUM — NOT TESTED dentro do app autenticado (o `NotAllowedError` de VAD-004 confirma que o hook não lança erro não tratado, mas não confirma a UI logada lado a lado com a mensagem de `useEscuta`) |

## C. Edge cases (o núcleo do risco desta feature) — todos exigem microfone real

| Check | ID | Categoria | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|
| [ ] | VAD-011 | Eco sem fone de ouvido | falar sem fone, volume normal, IARA falando | `echoCancellation` do `getUserMedia` + limiar do VAD evitam autointerrupção pela própria voz da IARA na maioria dos casos; taxa de falso positivo registrada, não assumida | vídeo/gravação da sessão + contagem de disparos falsos vs. reais | CRITICAL — **UNVERIFIED**, ambiente de QA não tem microfone; precisa do operador testando na própria máquina |
| [ ] | VAD-012 | Ruído curto (tosse, batida na mesa) | emitir ruído curto sem falar | não deve disparar barge-in (ou se disparar ocasionalmente, taxa fica documentada, não escondida) | console + contagem | HIGH — UNVERIFIED |
| [ ] | VAD-013 | Fala real mas curta ("para", "espera") | interromper com palavra curta | dispara barge-in (não pode ser mais lento que o caminho textual de hoje para isso) | screenshot + timestamp | HIGH — UNVERIFIED |
| [ ] | VAD-014 | Ambiente ruidoso (música/TV ao fundo) | IARA fala com ruído de fundo constante | sem disparo espúrio contínuo | console ao longo de 1min | MEDIUM — UNVERIFIED |

## Regra de execução

VAD-001 a VAD-005 são bloqueantes: sem eles passando, não faz sentido avaliar precisão (bloco C). VAD-011 é o item que decide se a feature vai para produção como está ou precisa de ajuste de limiar — é o único jeito de saber é falar de verdade com o app rodando, não é provável por leitura de código nem por teste automatizado.

Nenhum item vira `[x]` sem evidência em `test-evidence/VOZ-TEMPO-REAL-2026-08-14-F1/<ID>/`. Itens que dependem de hardware de áudio real (microfone físico) e não puderem ser exercitados pelo ambiente de QA automatizado ficam `UNVERIFIED` explicitamente, não `[x]` por inferência.

## Rodada executada em 2026-08-14 (mesma sessão)

Cobertura real: typecheck (`tsc --noEmit`, limpo), suíte existente (`npm test`: 762/763 — a 1 falha, `A2. nenhum fetch a provedor externo` em `servidor/nucleo/ClienteGraph.ts`, é PRÉ-EXISTENTE e não relacionada a esta mudança, não investigada nem corrigida aqui, fora de escopo), carregamento da página sem login (console + rede reais via Browser pane), alcançabilidade dos assets do CDN, e o caminho de erro de permissão negada.

**Bloqueio de escopo:** autenticação Supabase real é exigida para chegar à conversa (`PainelConversa`, onde o hook está de fato montado) — sem credencial de operador, não dá para ver `useDeteccaoVocal` montado dentro do app de verdade, só o código isolado e o comportamento do navegador que ele depende. Bloco A parcialmente coberto, blocos B e C inteiramente `UNVERIFIED`. Isso NÃO é aprovação da feature — é o estado real da evidência nesta rodada. Fica `CONDITIONAL`: código correto e sem regressão, comportamento acústico fim-a-fim carece de sessão autenticada + microfone real, que só o operador tem.
