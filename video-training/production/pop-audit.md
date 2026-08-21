# pop-audit.md — auditoria do POP antes do roteiro

Classificação:

- **P0** — impede treinamento correto. Bloqueia a produção daquela parte.
- **P1** — pode gerar erro operacional.
- **P2** — melhoria didática.

Regra aplicada (§5 e §48 do briefing): **nenhuma solução foi inventada para P0/P1.**
Onde o POP não define, o vídeo diz que não define e manda perguntar ao responsável.

---

## P0 — impedem treinamento correto

### P0-1 · Dados pessoais reais nas capturas do POP · **LGPD**

**Achado.** Duas das oito capturas do POP contêm dado pessoal real, verificado
por inspeção imagem a imagem:

| Captura | Conteúdo sensível |
|---|---|
| `42a3607a3cf2.png` | **~30 números de celular pessoais** associados a nome próprio (motoristas e contatos de posto/central), em tabela aberta |
| `b6e615e3f096.png` | **5 endereços de e-mail corporativos reais** + nomes completos de remetente e destinatários |
| `242b460e7efd`, `e93c9a811c0e`, `c55adba2c23c` | primeiros nomes de motoristas ligados a rota e data — identificáveis no contexto operacional |

**Por que é P0.** O vídeo é material de RH: circula para pessoas que não têm — e
não precisam ter — acesso à agenda de contatos da operação. Publicar telefone
pessoal de motorista num treinamento é tratamento de dado pessoal sem finalidade
legítima. O briefing (§36) proíbe explicitamente.

**Bloqueio.** A captura **não entra crua no render**, em nenhuma hipótese.

**Tratamento aplicado.** Mascaramento determinístico antes da composição, em
`project/mascarar.py`:

- telefones → tarja opaca da identidade + rótulo `CONTATO`;
- e-mails → substituídos por domínio genérico mascarado;
- nomes de pessoa → tarja, exceto quando o **nome é o próprio conteúdo didático**
  (ex.: Laudir e Linealdo, citados nominalmente **no texto normativo do POP** na
  exceção de Sorriso — ali o nome é regra, não dado de contato);
- números de OCI reais → mantidos. São identificadores de documento de carga, não
  dado pessoal, e são o que o aluno precisa reconhecer na tela.

**O que se perde.** A tabela de contatos aparece com a *estrutura* legível
(quais colunas existem, como se lê) e o *conteúdo* mascarado. É suficiente para
o objetivo do passo 2.10, que é "saber onde encontrar o contato" — não decorá-lo.

### P0-2 · A extração automática perdeu conteúdo normativo

**Achado.** O parágrafo do slide 6 —

> "Depois do processo de agendamento, (sempre 1 dia antes da coleta) o Analista
> envia o documento da OCI gerado No GW para assinatura pelo site do autentique
> e depois envia o Link para motorista e posto pelo SMBOT"

— **não existe** em `dados/procedimentos/IT-ADMLUFT-001/6b3f7fd537a43fe2.json`.
O array `etapas[]` termina no passo 15 e `particularidades[]` capturou apenas os
marcadores da lista, não o parágrafo.

**Por que é P0.** É uma ação obrigatória, com o **único prazo duro do POP**
("sempre 1 dia antes da coleta") e com dois sistemas que não aparecem em lugar
nenhum da base estruturada (Autentique, SMBOT). Um treinamento gerado a partir
do JSON ensinaria o procedimento **sem o passo final**, e o aluno terminaria o
vídeo achando que acabou na planilha.

**Resolução nesta produção.** Fonte normativa trocada para o `.pptx`; JSON
rebaixado a fornecedor de âncoras de captura. O passo entra como **2.16**, com
cena própria e destaque de prazo.

**Resolução pendente fora desta produção.** O defeito continua em
`scripts/geracao/ingerir-pops.ts` e **afeta os outros 10 POPs**, que não foram
auditados contra o `.pptx`. Ponto para revisão humana — está em `validation.md`.

---

## P1 — podem gerar erro operacional

### P1-1 · POP sem aprovador, sem elaborador e sem data de vigência

`Data:`, `Elaborado por:`, `Analisado por:` e `Aprovado por:` estão **vazios nas
8 páginas**. Um treinamento normativo sai de um documento que ninguém assinou.

**RESOLVIDO PARCIALMENTE, PELA ÁREA — 20/08/2026.** O aprovador é o **Sr.
Joaquim**, informado pela área responsável.

O vídeo passa a exibi-lo na abertura e no encerramento, no bloco de metadados.
**Mas a procedência é declarada:** a informação veio da área, não do documento,
e o campo `Aprovado por:` da REV.02 continua em branco. Enquanto continuar,
existe uma diferença entre o que o treinamento afirma e o que a norma registra —
e é a norma que uma auditoria vai ler.

**Continua em aberto:** elaborador, analista e **data de vigência**. O vídeo
declara a vigência como lacuna em tela (S040) e no encerramento.

**Ação necessária:** subir o POP para REV.03 com os quatro campos preenchidos.

### P1-2 · A exceção Adicer contradiz a Etapa 1, e o POP não fecha a contradição

Fluxo normal: recebe a OCI → agenda.
Exceção X2: "Cargas da Adicer: **agenda antes de solicitar a OCI**".

O POP **não informa** quem solicita a OCI, como se solicita, nem a quem.
A Etapa 1 diz que a LUFT envia a OCI espontaneamente por e-mail — o que não é
compatível com "solicitar".

**RESOLVIDO PELA ÁREA — 20/08/2026.** A solicitação da OCI é feita **pelo
WhatsApp do responsável, Geraldo**.

O vídeo passa a ensinar o passo (S026), com a procedência declarada em tela:
`INFORMADO PELA ÁREA — não consta na REV.02`. A narração diz a mesma coisa em
voz alta, porque um aluno que só ouve precisa saber que aquilo ainda não é
norma escrita.

**Por que a procedência não é preciosismo:** um POP ganha regra que ninguém
aprovou exatamente assim — alguém informa, o material de treinamento absorve, e
duas revisões depois ninguém sabe de onde a regra veio. Marcar a origem é o que
permite que a REV.03 a incorpore formalmente, ou a corrija.

**Ação necessária:** incorporar à REV.03. A contradição com a Etapa 1 (a LUFT
envia a OCI espontaneamente × na Adicer alguém solicita) continua sem tratamento
no texto do documento.

### P1-3 · "Normalmente" sem critério — motorista esporádico

X1 diz que para motorista esporádico o agendamento "**normalmente**" começa pelo
motorista. O POP não define o que é "esporádico" nem quando a regra não vale.

**Tratamento.** Apresentado com a palavra "normalmente" preservada e sinalizado
como critério que **depende de confirmação com o responsável**. Não foi
convertido em regra dura.

### P1-4 · Sorriso — destino do envio indefinido

X3 diz "não precisa ligar para o motorista, só envia OCI". O POP não diz **para
quem** a OCI é enviada nesse caso, nem por qual canal.

**Tratamento.** A parte definida é ensinada (não ligar; não preencher motorista
na planilha). A parte indefinida é marcada como lacuna em tela.

### P1-5 · Nenhum resultado negativo definido para o passo 2.7

"O campo rota irá preencher automaticamente" — o POP não diz o que fazer se **não**
preencher, nem o que isso significa. Nenhuma mensagem de erro é catalogada em
todo o documento.

**Tratamento.** O vídeo ensina o passo como **verificação** ("confira se
preencheu"), e diz que o POP não descreve o caso em que não preenche.

### P1-6 · Regra de prazo escondida em parágrafo de particularidades

"sempre 1 dia antes da coleta" está no meio de um parágrafo de um slide intitulado
PARTICULARIDADES, sem número de passo. É a regra mais fácil de perder do POP e a
que tem consequência operacional mais direta.

**Tratamento.** Promovida a passo numerado (2.16), com cena própria, linha do
tempo e cartão de ATENÇÃO. A promoção é **de destaque, não de conteúdo** — o
texto normativo não foi alterado.

### P1-7 · Ligar × registrar: o POP manda os dois, e eles se contradizem

Slide 3: "você irá **ligar** no posto x central e para o motorista".
Slide 4: "Dica: **sempre agendar via BOT ou WhatsApp** para deixar o registro".

Ligação não deixa registro. O POP não diz se a dica substitui a ligação, se a
complementa, ou se vale só em alguns casos.

**Não resolvido.** O vídeo mostra os dois como estão no POP: a ligação como o
passo, e o registro por BOT/WhatsApp como **boa prática declarada no POP**, com a
observação de que o documento não define a precedência entre os dois.

### P1-8 · Rótulo de sistema incorreto no índice

`indice.json` e a base estruturada classificam o POP como sistema **GW**. O
procedimento não executa nada no GW (ver `pop-analysis.md`). O próprio README do
projeto marca como proibição ❌5 misturar procedimentos de sistemas diferentes —
e um rótulo errado é como a mistura começa.

**Fora do escopo do vídeo.** Registrado para correção na ingestão.

---

## P2 — melhorias didáticas

| ID | Achado | Tratamento |
|---|---|---|
| P2-1 | Numeração de etapas inconsistente: marcadores 1, 2, 3 e depois **7** no slide 8 | O vídeo usa **3 etapas** e não reproduz o marcador "7". Divergência declarada aqui. |
| P2-2 | Dados de exemplo das capturas são de **2022**; o POP é de 2025. Uma captura mostra a marca d'água **"Ativar o Windows"** | Datas mantidas (é a captura real). A marca d'água é **recortada** na composição. |
| P2-3 | 3 de 8 slides trazem pouca instrução escrita — a informação está só na captura | É a razão de o vídeo depender de zoom e destaque, não de leitura de texto |
| P2-4 | "cx" (slide 4) é abreviação não definida | **Não interpretada.** A narração diz "posto, central e motorista", que é o que os blocos da planilha mostram |
| P2-5 | "ensinaremos como fazer na IT2" — referência a documento futuro | Convertida em encaminhamento explícito para **IT-ADMLUFT-002** no encerramento |
| P2-6 | O POP não declara objetivo, público nem pré-requisitos | Derivados e **marcados como derivados** em `pop-analysis.md` e no vídeo |

---

## Consequência para a produção

| Decisão | Motivo |
|---|---|
| Fonte normativa = `.pptx`, não o JSON | P0-2 |
| Capturas mascaradas antes de qualquer render | P0-1 |
| 3 lacunas ditas em tela (aprovador, solicitação de OCI na Adicer, canal de envio em Sorriso) | P1-1, P1-2, P1-4 |
| Passo 2.16 promovido a cena própria | P1-6 |
| Nenhum erro de sistema ensinado | POP não cataloga erro |
| Narração sem nome, telefone ou e-mail | P0-1 + privacidade do TTS |
