# IARA LEARNING STUDIO — IT-ADMLUFT-001

Treinamento operacional em vídeo do POP **IT-ADMLUFT-001 — Agendamento de
Coleta**, revisão **REV.:02**.

O procedimento é o primeiro elo da operação LUFT: tudo que vem depois (emissão
de CTE, CIOT, manifesto) depende de uma coleta marcada e registrada corretamente.

## O que tem aqui

```
video-training/
├── production/           pré-produção e auditoria — leia nesta ordem
│   ├── environment.md          ferramentas verificadas e limitações do ambiente
│   ├── pop-analysis.md         leitura integral do POP, matriz de etapas
│   ├── pop-audit.md            P0/P1/P2 encontrados ANTES do roteiro
│   ├── mascarar-relatorio.md   o que foi removido das capturas, e por quê
│   ├── learning-objectives.md  11 objetivos observáveis
│   ├── design-system.md        A LINGUAGEM VISUAL — leia antes de mexer no visual
│   ├── style-guide.md          histórico: a identidade da primeira versão
│   ├── script.md               GERADO — roteiro, cena a cena
│   ├── storyboard.md           GERADO — plano a plano, da linha do tempo real
│   ├── storyboard/             145 quadros de referência
│   ├── quiz.md                 5 questões, gabarito e rastreio ao POP
│   └── validation.md           QA técnico, perceptual e matriz de fidelidade
├── assets/
│   ├── screenshots/      capturas MASCARADAS — a única fonte do render
│   └── audio/            narração sintetizada + falas.json
├── project/              o pipeline (Python + Node)
├── subtitles/            legendas .srt (master) e .ass (corte de celular)
├── render/               final.mp4, mobile.mp4, narracao.wav, tempos.json
└── preview/              material de QA (folhas de contato, quadros extraídos)
```

## Como reproduzir

Pré-requisitos: Python 3.13+ com Pillow e numpy, Node 20+, FFmpeg no PATH.
As bibliotecas Node vêm do app web por junção (`node_modules` → `iara-os/apps/web/node_modules`).

```bash
python project/mascarar.py          # 1. portão de dados pessoais (obrigatório)
python project/verificar.py         # 2. portão de consistência roteiro × dados × POP
node   project/narrar.mjs           # 3. narração neural (idempotente)
python project/render.py --storyboard   # 4. quadros de referência
python project/render.py --preview      # 5. preview rápido, para QA
python project/render.py                # 6. master 1080p
python project/render.py --celular      # 7. corte 9:16 com legenda queimada
python project/gerar_storyboard.py      # 8. storyboard.md a partir da timeline
python project/qa.py render/final.mp4   # 9. portão de qualidade, medido no arquivo
```

A ordem importa: **o renderizador só lê de `assets/screenshots/`**, e esse
diretório só existe depois do passo 1. A cópia crua em
`iara-os/apps/web/public/procedimentos/` nunca é aberta pelo pipeline de vídeo.

### Os três portões

Cada um sai com código 1 quando falha, então servem de porta em CI:

- **`mascarar.py`** — nenhuma captura chega ao render sem passar pelo
  mascaramento. Emite `production/mascarar-relatorio.md` com faixa, motivo e
  hash de origem e saída.
- **`verificar.py`** — acusa divergência entre `script.md` e `cenas.py`,
  elemento do POP sem cena que o cubra, nome/telefone/e-mail vazando para a
  narração (que é enviada ao serviço de voz) e captura fora da pasta mascarada.
- **`qa.py`** — mede o **arquivo MP4**: loudness, pico, clipping, taxa, canais,
  quadros pretos, silêncios longos, sobreposição e velocidade de leitura das
  legendas. Render concluído não é qualidade aprovada; este é quem decide.

## A linguagem visual

**A tese: o treinamento tem a forma daquilo que ele ensina.** O procedimento é
sobre manter um registro correto, então o sistema é feito de **entradas de
registro** — código no trilho, filete, conteúdo no campo — e não de cartões.

Três decisões carregam a identidade: o **trilho** de 168 px que desloca o
conteúdo da margem; **duas vozes tipográficas** (Bahnschrift para o que a
máquina diz, Segoe UI para o que a instrutora diz); e o **degrau**, uma régua
que desce um nível, que é ao mesmo tempo a marca e o conector de todos os
diagramas.

São **18 arquétipos de página**, e `verificar.py` falha se algum se repetir três
cenas seguidas. Tudo em `production/design-system.md`.

## Duas procedências, nunca misturadas

O vídeo distingue, em tela e na voz, o que está escrito na REV.02 do que foi
**informado pela área** e ainda não entrou no documento:

| Rótulo | Significa |
|---|---|
| *(sem rótulo)* | texto normativo da REV.02 |
| `INFORMADO PELA ÁREA` | verdadeiro e necessário, mas fora do documento — precisa entrar na REV.03 |
| `O POP NÃO DEFINE` | ninguém respondeu ainda; a instrução é perguntar ao responsável |

Hoje há dois itens de procedência: o **aprovador (Sr. Joaquim)** e a
**solicitação da OCI na Adicer (WhatsApp do Geraldo)**. Sem essa separação, um
POP ganha regra que ninguém aprovou — alguém informa, o treinamento absorve, e
duas revisões depois não há como saber de onde veio.

## Decisões que valem saber

**A fonte normativa é o `.pptx`, não a base estruturada.** A ingestão automática
(`dados/procedimentos/*.json`) perdeu um passo obrigatório do POP — o envio da
OCI para assinatura, com prazo de um dia antes da coleta. Roteirizar pelo JSON
teria produzido um treinamento sem o passo final. Ver `pop-audit.md` P0-2.

**Nenhuma interface foi recriada.** Todas as telas são capturas reais do sistema,
feitas por quem escreveu o POP, tratadas com recorte, zoom e destaque. O
procedimento roda em Excel + e-mail + pasta de rede, não em aplicação web — por
isso o Playwright, disponível no projeto, não foi usado: dirigir um navegador
aqui seria encenação, não captura.

**Dado pessoal não entra no vídeo.** As capturas do POP traziam cerca de trinta
celulares pessoais com nome e cinco e-mails corporativos reais. Tudo mascarado
antes do render, preservando a estrutura da tabela — que é o conteúdo didático —
e removendo o conteúdo das células. `mascarar-relatorio.md` lista faixa a faixa.

**A voz é a da IARA, não uma escolha desta produção.** `pt-BR-FranciscaNeural`
está declarada como identidade inegociável em `servidor/nucleo/Voz.ts`.

**O entregável primário é o 16:9.** `render/final.mp4`, 1920×1080. O
`render/mobile.mp4` é **1080×1080**, não 9:16: o conteúdo é uma planilha larga,
e encher um quadro de retrato exigiria recortar as colunas — que são o assunto
do treinamento. O primeiro corte foi feito em 9:16 e o texto saía menor no
telefone do que assistindo o master deitado. No quadrado, o vídeo entra em
largura cheia e a faixa de baixo vira lugar da legenda.

**As lacunas do POP são ditas em tela.** O documento não registra aprovador nem
vigência, não explica como solicitar a OCI nas cargas da Adicer, não define o
canal de envio em Sorriso e não cataloga nenhuma mensagem de erro. O vídeo
declara as quatro e ensina a resposta certa: perguntar ao responsável pela conta.
Preencher essas lacunas por conta própria seria inventar norma.

## Trocar a voz sintética por locução humana

O roteiro está marcado por cena. Grave 45 faixas nomeadas `S0NN.wav` (e
`S0NNb.wav` para as respostas do quiz), coloque em `assets/audio/humana/` e
rode `project/render.py --voz humana`.

**Nada mais precisa mudar.** Cortes, legendas e trilho de progresso são
recalculados a partir da duração dos novos áudios — a duração de cada cena é
medida do som, nunca arbitrada no roteiro.

## Limitações conhecidas

1. **Sem trilha musical.** Não há biblioteca licenciada no projeto, e a regra do
   repositório exige verificar uso comercial antes de qualquer asset novo. O mix
   é voz + sound design sintetizado, sem licença de terceiro. Espaço reservado.
2. **Capturas de origem são faixas largas e baixas** (a mais alta tem 438 px).
   Daí o zoom com contexto, limitado a 2,4× para não amolecer o texto.
3. **Dados de exemplo das capturas são de 2022**, enquanto o POP é de 2025.
   Inconsistência do material de origem, mantida por fidelidade.
4. **A voz neural envia o texto da narração à Microsoft.** Mitigado: nenhuma
   narração contém nome de pessoa, telefone, e-mail ou documento.
5. **O defeito de ingestão (P0-2) afeta os outros 10 POPs**, que não foram
   auditados contra os `.pptx`. Ver `validation.md`.
