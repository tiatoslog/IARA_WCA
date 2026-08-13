# BUG REGISTER — auditoria de 13/08/2026

Baseline: `8d057e2`. Todos os defeitos abaixo foram encontrados **executando**,
com a suíte de 641 testes inteira em verde.

---

## IARA-001 — duplo clique concorrente executa duas vezes

- **SEVERITY**: P1 (High)
- **COMPONENT**: `servidor/nucleo/Braco.ts`
- **DESCRIPTION**: dois pedidos idênticos disparados antes de o primeiro
  terminar produziam **duas execuções reais**. O cabeçalho do arquivo declara
  cobrir exatamente esse caso ("o operador toca no botão duas vezes… nenhuma
  dessas repetições é um segundo pedido").
- **ROOT_CAUSE**: a marca de idempotência (`porChave`) só era escrita em
  `fechar()`, isto é, **depois** do desfecho. `repeticaoDe(chave)` consultava um
  mapa ainda vazio. A fila por operador não protegia: ela **serializa**, não
  deduplica — o segundo pedido apenas esperava a vez e executava.
  A janela de vulnerabilidade era exatamente a duração da execução, que é o
  intervalo em que o operador, sem resposta na tela, clica de novo.
- **REPRODUCTION**: `Promise.all([braco.executar(p), braco.executar(p)])` com
  executor espião → 2 chamadas.
- **IMPACT**: efeito não idempotente duplicado. Hoje o catálogo de ponte é
  benigno (`criar_pasta` converge, `abrir_aplicativo` abre duas janelas), mas
  `enviar_whatsapp` e qualquer ação futura de efeito externo herdariam o buraco.
- **EXPLOITABILITY**: alta e não requer ator malicioso — basta latência.
- **FIX**: mapa `emVoo: Map<chave, Promise<RelatoExecucao>>` gravado **antes**
  do primeiro `await`. Repetição em voo se pendura no desfecho do original e
  devolve `duplicada`. Se o original morrer sem relato legível, a repetição
  recebe `expirou` (não sei) — nunca um retry cego.
- **REGRESSION_TEST**: `testes/ponte-execucao-adversarial.test.ts` B1, B1b, B1c
- **STATUS**: FIXED

## IARA-002 — `sucesso` com prova negada atravessa o portão de coerência

- **SEVERITY**: P1 (High) — é um *unverified SUCCESS event*, critério de NO-GO
- **COMPONENT**: `servidor/nucleo/Braco.ts` (`receber`)
- **DESCRIPTION**: um braço hostil ou defeituoso podia relatar
  `estado: 'sucesso'` com `prova.confirmado: false` e o motor **mantinha
  `sucesso`**, desde que o motivo não fosse `divergente`.
- **ROOT_CAUSE**: a condição era
  `estado === 'sucesso' && !prova.confirmado && prova.motivo === 'divergente'`.
  Duas formas escapavam: `motivo: 'nao_encontrado'` e prova negada **sem motivo
  nenhum**. Nenhuma das duas é produzível por um executor honesto —
  `ExecutorDesktop` deriva `ok` da própria prova e todo `confirmado: false` do
  `AgenteLocal` carrega motivo. São **estados impossíveis** aceitos pela rede.
- **REPRODUCTION**: braço dublê respondendo `{estado:'sucesso', prova:{confirmado:false,
  motivo:'nao_encontrado'}}` → o motor devolve `estado: 'sucesso'`, e
  `Habilidade.executar` lê exatamente esse campo em `resolveu`.
- **IMPACT**: a IARA afirma "pronto" sobre um efeito que ninguém apurou. A
  quinta porta ainda carregava a ressalva, mas `resolveu`, a trilha e o texto do
  relato já mentiam.
- **FIX**: rebaixa para `falhou` sempre que a prova nega, **exceto**
  `sem_meio_de_verificar` — o único caso legítimo (aplicativo que já estava
  aberto; plataforma sem `tasklist`).
- **REGRESSION_TEST**: B2 (três variantes) + **B2b**, o contra-teste que impede a
  correção de virar excesso de zelo.
- **STATUS**: FIXED

## IARA-003 — chave de idempotência de transporte ambígua

- **SEVERITY**: P2 (Medium) — latente
- **COMPONENT**: `servidor/nucleo/Braco.ts` (`chaveDe`), `servidor/braco/principal.ts` (`assinaturaDa`)
- **DESCRIPTION**: as duas chaves usavam `=`, `&` e `|` como separadores —
  caracteres que um valor de parâmetro pode conter. `{local:"documentos&nome=x"}`
  e `{local:"documentos", nome:"x"}` produziam a **mesma** string.
- **ROOT_CAUSE**: serialização não injetiva. `Operacao.derivarChaveIdempotencia`
  já resolvia isso com `JSON` canônico unido por `\0`; as duas camadas de
  idempotência discordavam sobre o que é "o mesmo pedido".
- **IMPACT**: uma ordem legítima recebendo o relato de OUTRA ação — exatamente a
  "mentira com selo de sucesso" que o comentário de `principal.ts` diz existir
  para impedir. **Não explorável pelo catálogo atual**: em `criar_pasta` o
  parâmetro alfabeticamente anterior (`local`) é o restrito por esquema, e
  `validar()` já recusa `\0` e controles C0 em campo `texto`. É defeito de
  primitiva, não vulnerabilidade ativa.
- **FIX**: `[id_usuario, acao, JSON.stringify(pares ordenados)].join('\0')` nos
  dois lados.
- **REGRESSION_TEST**: B3, B3b, B3c
- **STATUS**: FIXED

## IARA-004 — a fronteira do relato do braço não validava quase nada

- **SEVERITY**: P2 (Medium)
- **COMPONENT**: `lib/execucao.ts` (`lerPacoteBraco`, caso `concluida`)
- **DESCRIPTION**: o leitor conferia quatro campos e repassava o objeto inteiro
  com `r as unknown as RelatoExecucao`. Entravam tipados por confiança: `texto`
  de qualquer tamanho (2 MB confirmados), `estado` fora do vocabulário fechado,
  `prova.evidencia` que não é texto, `motivo` inventado, `codigo_erro`
  inventado, `onde` arbitrário, `dados` de qualquer forma, e campos a mais.
- **ROOT_CAUSE**: asserção de tipo sobre dado de rede. O contraste é interno:
  `lerPacoteCliente` — a fronteira do navegador — sempre limitou tudo em 8000
  caracteres. A fronteira que **executa coisas** era a frouxa.
- **IMPACT**: `RelatoExecucao.texto` sobe para a resposta e, por contrato, é
  insumo do próximo passo — ou seja, pode acabar no prompt. Sem teto, um braço
  comprometido injeta megabytes no motor e na conta de tokens. `evidencia`
  não-texto ia direto para o log estruturado de auditoria.
- **FIX**: `lerRelato()` valida campo a campo contra vocabulários fechados
  (`ESTADOS_CONHECIDOS`, `CODIGOS_ERRO`, motivos, `onde`), impõe teto de 8000
  caracteres no texto e 2000 na evidência, e **constrói um objeto novo** — nada
  do socket passa por referência.
- **REGRESSION_TEST**: B4 (11 desvios) + B4b (cópia) + B4c (corpus de lixo) +
  B4d (`__proto__`)
- **STATUS**: FIXED

## IARA-005 — `validarNomePasta` aceita nomes de dispositivo do Windows

- **SEVERITY**: P3 (Low)
- **COMPONENT**: `servidor/nucleo/AgenteLocal.ts`
- **DESCRIPTION**: `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`
  passavam pela regra (são só letras e dígitos). O `mkdir` falhava com `EINVAL`,
  a exceção subia até a rede de segurança do `ExecutorDesktop` e o operador
  recebia "falhou por um erro interno".
- **IMPACT**: não é escape de sandbox — é a recusa falhando no único trabalho
  que ela tem, que é dizer o que fazer a seguir.
- **FIX**: `RESERVADOS_WINDOWS` recusa o nome com ou sem extensão, em qualquer
  caixa. Contra-teste garante que `Contratos`, `Console`, `Nulo` continuam
  válidos.
- **REGRESSION_TEST**: B5, B5b, B5c
- **STATUS**: FIXED

## IARA-006 — corpo da busca web sem teto

- **SEVERITY**: P3 (Low)
- **COMPONENT**: `servidor/nucleo/BuscaWeb.ts`
- **DESCRIPTION**: `await resposta.text()` materializava na heap do motor o que
  viesse do endpoint. Não é SSRF (o destino é fixo e literal, sem componente do
  operador na URL além do `encodeURIComponent` da consulta) — é um tamanho que
  este processo não controla.
- **FIX**: leitura por `ReadableStream` com teto de 2 MB e `cancel()` no fim.
- **REGRESSION_TEST**: nenhum automatizado (exigiria servidor HTTP no teste).
  **UNVERIFIED por teste; corrigido por revisão.**
- **STATUS**: FIXED (sem regressão automatizada)

## IARA-007 — mapa de últimos desfechos sem teto

- **SEVERITY**: P3 (Low)
- **COMPONENT**: `servidor/nucleo/Braco.ts` (`ultimos`)
- **DESCRIPTION**: indexado por (operador, sessão, ação) e nunca esvaziado. Em
  modo local o `id_usuario` vem de um campo que o cliente digita — um laço de
  conexões com ids diferentes fazia o mapa crescer sem credencial nenhuma.
  A chave também usava `|`, o mesmo separador ambíguo do IARA-003.
- **FIX**: teto de 500 entradas com descarte da mais antiga (`Map` preserva
  ordem de inserção) e separador `\0`.
- **REGRESSION_TEST**: coberto indiretamente por B1/B2 (o mapa continua servindo
  a quinta porta). **PARTIALLY_VERIFIED.**
- **STATUS**: FIXED
