# Test plan — convite de pareamento: QR na interface + nome na autorização

**BASELINE_ID:** CONVITE-PAREAMENTO-2026-08-15 · branch `main` · commit `543221f` +
gaveta Instalar a IARA (mesma árvore) · 953 testes verdes
**Data:** 15/08/2026
**Origem:** pedido da operadora — o QR do Braço não pode viver num terminal nem num
visualizador de PNG avulso: ele aparece num popover da própria interface da IARA, com a
estética da casa; e na autorização (no celular) a pessoa dá o nome do computador
("Notebook Daiane", "PC de Casa") num campo, salvando junto.

## O fluxo inteiro que este plano protege

1. A pessoa baixa o Braço e o abre no computador novo.
2. O Braço pede o código ao motor (`/parear/pedir`, inalterado) e **abre o navegador**
   em `<motor>/?convite=<código>`.
3. A interface da IARA mostra o **popover do convite**: QR (que codifica
   `<motor>/?parear=<código>`), o código legível e a instrução — sobre QUALQUER tela
   (login, sala, modo local): o computador novo pode não estar logado.
4. O celular lê o QR → abre `/?parear=<código>` → login (fluxo existente) → gaveta
   Dispositivos abre no assistente com o código preenchido (existente).
5. **Novo:** campo "nome deste computador" ao lado do código; Autorizar envia
   `{tipo:'parear', codigo, nome?}`; o motor grava o nome escolhido (ou o hostname,
   se vazio).
6. O Braço resgata a credencial e conecta (inalterado); a máquina aparece com o nome
   escolhido.

## O que muda

- `servidor/braco/pareamento.ts` — helpers puros `linkDoPareamento` / `linkDoConvite`.
- `servidor/braco/principal.ts` — abre o navegador no convite; PNG vira reforço
  impresso (não abre mais o visualizador de imagem); textos atualizados.
- `app/page.tsx` — lê `?convite=` uma vez (fora do gate de login), remove da URL,
  monta o popover.
- `components/ConvitePareamento.tsx` — o popover, novo.
- `lib/protocolo.ts` — `parear` ganha `nome?` (aparado, ≤80, vazio = ausente).
- `servidor/nucleo/Pareamento.ts` — `aprovar(..., nomeEscolhido?)` grava o nome
  escolhido; resposta carrega o nome efetivo.
- `servidor/barramento/Porta.ts` — repassa `pedido.nome`.
- `components/Dispositivos.tsx` — campo de nome no assistente.
- `hooks/useIaraSocket.ts`, `components/PainelConversa.tsx` — assinatura
  `autorizarComputador(codigo, nome?)`.

## Invariantes que NÃO podem regredir

- O nome vai no pacote, mas **quem aprova continua sendo a sessão resolvida** — o
  pacote nunca carrega `id_usuario`.
- Uso único do código, oráculo entre operadores fechado, cota de erro: intocados
  (suíte `pareamento.test.ts` inteira é a regressão).
- O QR continua sendo atalho e o código a segurança: o popover não autoriza nada.
- Segurança do convite: `?convite=` só EXIBE um código que o Braço acabou de criar;
  quem o vê já está na frente do computador. Autorizar continua exigindo sessão logada.

## Limite de verificação declarado

- O gesto físico (câmera do celular lendo o QR) e o fluxo completo com banco real
  (Supabase) não são executáveis neste ambiente de QA (modo local sem banco →
  `pareamentoDisponivel=false`, o assistente mostra o aviso de banco em vez dos
  campos). O campo de nome e a gravação são provados por unidade (motor) e o popover
  por Playwright; o fluxo de ponta a ponta com banco é MANUAL-002 pós-deploy.

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | UN-101 | unit | — | `linkDoConvite('https://x.app/', 'H7K2-9QP4')` | `https://x.app/?convite=H7K29QP4` (sem hífen, sem barra dupla) | node:test | QR/URL malformada |
| [ ] | UN-102 | unit | — | `linkDoPareamento` idem | `https://x.app/?parear=H7K29QP4` | node:test | celular não abre pré-preenchido |
| [ ] | UN-103 | unit | pedido aberto | `aprovar(codigo, ANA, agora, 'Notebook Daiane')` | grava nome 'Notebook Daiane' no repositório; resposta `nome` = escolhido | node:test | nome ignorado |
| [ ] | UN-104 | unit | pedido aberto | `aprovar` com nome vazio/só espaços | grava o hostname reportado (comportamento atual) | node:test | nome em branco apagando hostname |
| [ ] | UN-105 | unit | pedido aberto | `aprovar` com nome de 200 chars | aparado em 80 | node:test | estouro no banco |
| [ ] | UN-106 | unit | — | `lerPacoteCliente` de `{tipo:'parear',codigo,nome:'  PC de Casa  '}` | `nome: 'PC de Casa'`; sem nome → campo ausente; nome não-string → ausente | node:test | parser aceitando lixo |
| [ ] | UN-107 | unit | — | regressão: `pareamento.test.ts` inteiro | tudo verde sem alterar os testes existentes | node:test | quebra do uso único/oráculo |
| [ ] | UI-101 | playwright | app aberto com `?convite=H7K29QP4` | carregar | popover visível sobre a tela; QR renderizado (img com data:); código "H7K2-9QP4" legível; estética da casa (fundo grafite, sem branco chapado) | screenshot + DOM | popover ausente/quebrado |
| [ ] | UI-102 | playwright | popover aberto | conferir QR | o QR decodifica para `<origin>/?parear=H7K29QP4` (decodificar o data URL no teste) | result.json com o texto decodificado | QR apontando para lugar errado |
| [ ] | UI-103 | playwright | popover aberto | fechar (✕ ou botão) | popover some; app segue utilizável; `?convite` não volta no F5 (URL limpa) | screenshot + URL | popover preso/reaparecendo |
| [ ] | UI-104 | playwright | `?convite=` com valor fora do alfabeto (ex.: `<script>`) | carregar | nada de HTML injetado; ou popover com código normalizado ou nenhum popover; sem erro no console | screenshot + console | XSS/injeção via URL |
| [ ] | UI-105 | playwright | assistente Dispositivos (modo local, sem banco) | abrir "Conectar computador" | aviso de banco continua (regressão); NENHUM campo de nome órfão | screenshot | UI órfã sem banco |
| [ ] | UI-106 | playwright | viewport móvel 390×844 com `?convite=` | carregar | popover cabe na tela, QR inteiro visível | screenshot | popover cortado no celular |
| [ ] | RG-101 | regressão | árvore completa | `npm test` | tudo verde | log bruto | regressão silenciosa |
| [ ] | MANUAL-002 | produção | deploy + banco + Braço real | fluxo 1→6 completo com câmera | máquina aparece com o nome escolhido | relato/screenshot da operadora | única prova do fluxo físico |

## Decisão de bloqueio

- UN-103/104/106/107 ou UI-101/102/104 FAIL sem correção → BLOCK.
- MANUAL-002 pendente não bloqueia merge; fica como risco residual declarado.
