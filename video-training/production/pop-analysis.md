# pop-analysis.md — leitura integral do POP

## Identificação

| Campo | Valor | Origem |
|---|---|---|
| Código | **IT-ADMLUFT-001** | cabeçalho, 8/8 páginas |
| Título | **AGENDAMENTO DE COLETA** | cabeçalho |
| Revisão | **REV.:02** | cabeçalho, consistente nas 8 páginas |
| Data | *(vazio)* | **lacuna** — ver `pop-audit.md` P1-1 |
| Elaborado por | *(vazio)* | **lacuna** |
| Analisado por | *(vazio)* | **lacuna** |
| Aprovado por | *(vazio)* | **lacuna** |
| Vigência | *(vazio)* | **lacuna** |
| Páginas | 8 | rodapé |
| Arquivo | `IT - ADMLUFT - 001 - AGENDAMENTO DE COLETA.pptx` | — |

### Fonte normativa adotada

**O `.pptx` é a fonte.** A base estruturada `dados/procedimentos/IT-ADMLUFT-001/`
foi usada **apenas** para as âncoras de captura (coordenadas x/y de cada passo).

Motivo, registrado por §48 do briefing: a extração automática **perdeu conteúdo
normativo do slide 6** — o parágrafo do envio para assinatura via Autentique e
link pelo SMBOT não aparece em `etapas[]`. Roteirizar pelo JSON teria omitido
uma ação obrigatória com prazo. Ver `pop-audit.md` P0-2.

### Sistemas realmente envolvidos

O índice classifica este POP como sistema **"GW"**. Pela leitura, o
procedimento **não executa nada dentro do GW**:

| Sistema/ferramenta | Papel no POP |
|---|---|
| E-mail (caixa da analista Atos) | recebe a OCI da LUFT |
| Excel, em caminho de rede | planilha de controle de OCIs — onde o trabalho acontece |
| Excel `CONTATOS LUFT – Postos e Centrais` | fonte dos contatos |
| Telefone / WhatsApp / BOT | execução do agendamento |
| GW | apenas **origem** do documento da OCI já gerado |
| Autentique | assinatura do documento da OCI |
| SMBOT | envio do link ao motorista e ao posto |

→ discrepância de rótulo registrada em `pop-audit.md` **P1-8**.

## Público e pré-requisitos

**Público** (derivado, não declarado no POP): analista administrativo da Atos Log
responsável pela conta LUFT. O POP fala em "analista responsável Atos" e "você".

**Pré-requisitos** (derivados das ações exigidas — o POP não traz seção própria):

- acesso à caixa de e-mail da analista responsável;
- acesso ao caminho de rede `Atoslog > atoslogdocumentos > CtrFrete`;
- acesso à planilha de controle de OCIs do ano corrente;
- acesso à planilha `CONTATOS LUFT – POSTOS E CENTRAIS`;
- telefone e WhatsApp/BOT para contato com posto, central e motorista;
- acesso ao Autentique e ao SMBOT (etapa final).

> Marcado como **derivado** em todo o material. O POP não possui seção de
> pré-requisitos, e inventá-la como se fosse normativa violaria §48.

## Matriz de etapas

Legenda de **Visual**: `CR` captura real tratada · `GR` gráfico/motion · `TX` cartão tipográfico

### ETAPA 1 — RECEBIMENTO DA OCI VIA E-MAIL *(slide 1)*

| ID | Etapa | Ação | Resultado esperado | Evidência | Visual |
|---|---|---|---|---|---|
| 1.1 | Recebimento | A LUFT envia a Ordem de Coleta por e-mail, para o e-mail da analista responsável Atos | Numeração da OCI em mãos | e-mail com `OCI 184957 / OCI 184958` | CR `b6e615e3f096` (mascarada) |
| 1.2 | Recebimento | A partir do recebimento da numeração, já é possível agendar a viagem | Autorização para iniciar o agendamento | texto do slide 1 | TX |
| 1.3 | Recebimento | Observar a particularidade da Região antes de agendar | Saber se agenda de imediato ou aguarda | "a Central de Piedade envia quais OCIs irá carregar na semana seguinte, na sexta-feira anterior" | GR |

### ETAPA 2 — PREENCHIMENTO DA PLANILHA E AGENDAMENTO *(slides 2 a 6)*

| ID | Etapa | Ação | Resultado esperado | Evidência | Visual |
|---|---|---|---|---|---|
| 2.1 | Planilha | Acessar a planilha no caminho da rede | Planilha de controle aberta | `CtrFrete > 3 - CONTROLE OCIS` | CR `1c66b4f5a0c3` |
| 2.2 | Planilha | Incluir o número da OCI recebido | Coluna **OCI** preenchida | coluna OCI | CR `242b460e7efd` zoom |
| 2.3 | Planilha | Preencher **Origem** | Coluna Origem preenchida | coluna ORIGEM | CR zoom |
| 2.4 | Planilha | Preencher **Destino** | Coluna Destino preenchida | coluna DESTINO | CR zoom |
| 2.5 | Planilha | Preencher a **data em que recebeu a OCI** | Coluna DATA REC. preenchida | coluna DATA REC. | CR zoom |
| 2.6 | Planilha | Preencher o **motorista que faz a região** | Coluna MOTORISTA preenchida | coluna MOTORISTA | CR zoom |
| 2.7 | Planilha | **Não preencher a rota** — o campo preenche automaticamente | Campo ROTA preenchido sozinho | "O campo rota irá preencher automaticamente" | GR — **verificação, não ação** |
| — | Agendamento | Verificar se pode agendar de imediato ou se aguarda para agendar 1×/semana; então **ligar** para posto × central e para o motorista | Agendamento combinado | parágrafo do slide 3 | GR decisão |
| 2.8 | Contatos | Os contatos ficam na planilha, na rede | Sabe onde buscar contato | texto | TX |
| 2.9 | Contatos | Abrir a planilha `CONTATOS LUFT – POSTOS E CENTRAIS` | Planilha de contatos aberta | arquivo destacado | CR `294247ef05fb` |
| 2.10 | Contatos | Nela estão os contatos de postos e centrais, o motorista da rota e o contato dele | Contato correto localizado | tabela CENTRAL / CONTATO POSTO / MOTORISTA / TELEFONE / CONTATO CENTRAL | CR `42a3607a3cf2` **mascarada** |
| 2.11 | Registro | **POSTOS**: registrar data, hora e **nome da pessoa** com quem agendou | Bloco POSTOS preenchido | bloco AGENDAMENTO | CR `e93c9a811c0e` zoom |
| 2.12 | Registro | **CENTRAL**: registrar data, hora e nome da pessoa com quem agendou | Bloco CENTRAL preenchido | bloco AGENDAMENTO | CR zoom |
| 2.13 | Registro | **TAC**: registrar data e hora em que avisou o motorista | Bloco TAC preenchido | bloco AGENDAMENTO | CR zoom |
| — | Boa prática | *"Dica: sempre agendar via BOT ou WhatsApp para deixar o registro do agendamento"* | Agendamento rastreável | slide 4 | TX BOA PRÁTICA |
| 2.14 | Datas | Preencher a **data em que a coleta será realizada no posto** | DATA COLETA preenchida | coluna DATA COLETA | CR `c55adba2c23c` zoom |
| 2.15 | Datas | Preencher a **data em que a descarga será feita na Central** | DATA DESCARGA preenchida | coluna DATA DESCARGA | CR zoom |
| **2.16** | Documento | **Sempre 1 dia antes da coleta**: enviar o documento da OCI gerado no GW para assinatura pelo site do **Autentique** e depois enviar o link ao **motorista e ao posto** pelo **SMBOT** | OCI assinada e link entregue | slide 6, parágrafo | GR linha do tempo |

> **2.16 é o passo que a extração automática perdeu.** É também a única regra com
> prazo duro do POP inteiro. Tratado como passo obrigatório e com destaque próprio.
> O *como fazer* é explicitamente remetido à IT-ADMLUFT-002 ("ensinaremos como fazer na IT2").

### Exceções declaradas — PARTICULARIDADES DO AGENDAMENTO *(slide 6)*

| ID | Exceção | O que muda em relação ao fluxo normal |
|---|---|---|
| X1 | **Motorista esporádico** | O agendamento "normalmente" é feito **com o motorista primeiro** — inverte a ordem posto → central → motorista |
| X2 | **Cargas da Adicer** | **Agenda antes de solicitar a OCI** — inverte a premissa da Etapa 1 (agendar só após receber a OCI) |
| X3 | **Sorriso** | **Não tem agendamento.** A própria central passa as notas e a data. Não ligar para o motorista, só enviar a OCI. Ao lançar na planilha, **não preencher motorista** (a região tem dois: Laudir e Linealdo/Lino) |

### ETAPA 3 — PARTICULARIDADES: ENVIO DE DOCUMENTOS *(slide 7)*

| ID | Regra | Resultado esperado |
|---|---|---|
| 3.1 | Apenas as **minutas** são geradas automaticamente. **CIOT e manifesto precisam ser autorizados manualmente** | Não assumir que CIOT/manifesto saíram sozinhos |
| 3.2 | O posto de **Sorriso** envia a nota **no mesmo dia** para emissão do CTE | CTE de Sorriso emitido no mesmo dia |
| 3.3 | No agendamento envia-se: **100% dos casos, a OCI** | OCI sempre enviada |
| 3.4 | No agendamento envia-se: **CTE e MDFe nos trechos interestaduais e MT** | CTE/MDFe nos casos previstos |
| 3.5 | **Emitimos CTE para MT e cargas interestaduais** | Critério de emissão de CTE |

### *(slide 8)* — CONTATOS PARA AGENDAMENTO

Informa que os contatos estão disponíveis **na rede**. Reforça 2.9/2.10; não
introduz ação nova. Marcador de etapa impresso: "7" — ver `pop-audit.md` P2-1.

## Resultado esperado do procedimento

Ao final, para cada OCI recebida:

1. a OCI está lançada na planilha de controle, com origem, destino, data de recebimento e motorista;
2. o campo rota preencheu-se automaticamente;
3. posto, central e motorista foram contatados e o agendamento está combinado;
4. data, hora e nome do interlocutor estão registrados nos blocos POSTOS, CENTRAL e TAC;
5. a data de coleta e a data de descarga estão preenchidas;
6. até **1 dia antes da coleta**, a OCI foi enviada para assinatura no Autentique e o link foi entregue ao motorista e ao posto pelo SMBOT.

## Erros comuns — base normativa

O POP **não possui seção de erros** e **não cataloga nenhuma mensagem de erro**
(vale para os 11 POPs). Por §29 do briefing e §48, **nenhum erro foi inventado**.
Os três "erros comuns" do vídeo são derivados de regras explícitas do próprio POP,
por negação direta:

| Erro no vídeo | Regra do POP que ele viola | Trecho |
|---|---|---|
| Preencher o campo **Rota** na mão | o campo preenche automaticamente | 2.7 |
| Lançar **motorista** numa carga de **Sorriso** | "quando lançar na planilha não colocar motorista" | X3 |
| Agendar só por ligação, sem registro | "sempre agendar via BOT ou WhatsApp para deixar o registro" | dica do slide 4 |

Erros de sistema, de validação e de mensagem **não são cobertos** — e o vídeo
diz isso ao aluno, em vez de fingir cobertura.
