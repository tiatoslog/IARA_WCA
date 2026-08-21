"""
cenas.py — as 41 cenas, como dados.

Espelha `production/script.md`. Divergência entre os dois é bug, e
`project/verificar.py` a acusa.

DUAS PROCEDÊNCIAS, NUNCA MISTURADAS
-----------------------------------
`pop` aponta para a linha da matriz em `pop-analysis.md` — o que está escrito na
REV.02 do documento.

`procedencia` marca o que **não está no documento** e foi informado pela área
responsável (aprovador; canal de solicitação da OCI na Adicer). Esse conteúdo
entra no treinamento porque é verdadeiro e operacionalmente necessário, mas
aparece com rótulo próprio — `INFORMADO PELA ÁREA` — e nunca como se fosse
texto normativo. Confundir os dois é como um POP ganha regra que ninguém
aprovou; separá-los é o que faz a próxima revisão do documento ser possível.

RITMO DE ARQUÉTIPOS
-------------------
Nenhum arquétipo se repete mais de duas cenas seguidas, fora o bloco de prova —
que é um modo distinto e lê como seção. A variedade não é enfeite: é o que
impede o treinamento de virar uma sequência de telas iguais.
"""

from __future__ import annotations

CENAS: list[dict] = [
    # ------------------------------------------------------------- BLOCO 0
    dict(
        id="S001", tipo="abertura", narracao="", legenda="",
        pop="cabeçalho", duracao_fixa=4.5,
    ),
    dict(
        id="S002", ilustracao="envelope", tipo="registro",
        sobretitulo="objetivo do treinamento",
        titulo="Ao final, você vai conseguir",
        itens=[{"texto": "Receber e registrar a OCI"},
               {"texto": "Agendar com posto, central e motorista"},
               {"texto": "Enviar o documento para assinatura"},
               {"texto": "Conferir o próprio trabalho"}],
        narracao="Ao final deste treinamento, você vai conseguir agendar uma coleta da LUFT do começo ao fim: desde a ordem de coleta que chega por e-mail, até o envio do documento para assinatura. E, mais importante, você vai saber conferir se fez certo.",
        pop="objetivo terminal",
    ),
    dict(
        id="S003", tipo="fluxo",
        sobretitulo="por que isso importa",
        titulo="O agendamento é o primeiro elo",
        blocos=["Agendamento", "Emissão", "Transporte"],
        nota="Um agendamento sem registro é um caminhão que ninguém sabe explicar onde está.",
        narracao="O agendamento é o primeiro elo da operação LUFT. Tudo que vem depois — a emissão do CTE, o CIOT, o manifesto — depende de uma coleta marcada e registrada corretamente. Um agendamento sem registro é um caminhão que ninguém sabe explicar onde está.",
        pop="contexto da série IT-ADMLUFT",
    ),
    dict(
        id="S004", ilustracao="pastas", tipo="registro",
        sobretitulo="limites deste treinamento",
        titulo="O que fica para outra instrução",
        itens=[{"codigo": "IT-002", "texto": "Emissão da OCI no GW"},
               {"codigo": "IT-002", "texto": "Autentique e SMBOT"},
               {"codigo": "IT-004/5/7", "texto": "CTE, CIOT e manifesto"}],
        narracao="Uma coisa antes de começar: aqui você aprende a agendar. Emitir a ordem de coleta no sistema, usar o Autentique e o SMBOT, emitir CTE ou manifesto — cada um desses tem a sua própria instrução de trabalho.",
        pop="P2-5",
    ),
    dict(
        id="S005", ilustracao="planilha", tipo="conferencia",
        sobretitulo="antes de começar",
        titulo="Preparação",
        itens=["E-mail da analista responsável",
               "Caminho de rede CtrFrete",
               "Planilha de controle de OCIs",
               "Planilha de contatos LUFT",
               "Telefone e WhatsApp / BOT",
               "Acesso ao Autentique e ao SMBOT"],
        narracao="Antes de agendar qualquer coisa, confira se você tem estes acessos. Se faltar algum, resolva agora — no meio do agendamento é tarde, porque tem gente do outro lado da linha esperando.",
        pop="pré-requisitos derivados",
    ),

    # ------------------------------------------------------------- BLOCO 1
    dict(
        id="S006", tipo="secao", numero="1", titulo="Recebimento da OCI via e-mail",
        narracao="Etapa um: o recebimento da ordem de coleta.",
        etapa="ETAPA 01", pop="Etapa 1",
    ),
    dict(
        id="S007", tipo="tela", arquivo="b6e615e3f096.png",
        sobretitulo="tela real · caixa de entrada",
        titulo="A OCI chega por e-mail",
        focos=[(0, 610, 95, 112, "O assunto diz de onde sai e para onde vai"),
               (0, 90, 246, 282, "A numeração da OCI, no corpo")],
        narracao="A LUFT envia a ordem de coleta por e-mail, para a caixa da analista responsável na Atos. Repare no que interessa nessa mensagem: o assunto, que diz de onde sai e para onde vai a carga, e a numeração da OCI, destacada no corpo. Pode vir mais de uma na mesma mensagem.",
        etapa="ETAPA 01", passo="PASSO 01 / 16", pop="1.1",
        aviso="remetente e destinatários mascarados",
    ),
    dict(
        id="S008", tipo="gatilho",
        narracao="Assim que você tem essa numeração, já pode agendar a viagem. Não precisa esperar mais nada. A numeração é a autorização para começar.",
        etapa="ETAPA 01", pop="1.2",
    ),
    dict(
        id="S009", ilustracao="calendario", tipo="nota", estado="atencao",
        titulo="Cada região tem a sua particularidade",
        linhas=["A Central de Piedade avisa na sexta-feira quais ordens vai carregar na semana seguinte.",
                "Nem sempre você agenda no mesmo dia em que recebe."],
        narracao="Mas atenção: cada região tem o seu jeito. A central de Piedade, por exemplo, avisa na sexta-feira quais ordens vai carregar na semana seguinte. Ou seja, nem sempre você agenda no mesmo dia em que recebe. Antes de ligar, saiba com qual região você está lidando.",
        etapa="ETAPA 01", pop="1.3",
    ),
    dict(
        id="S010", ilustracao="envelope", tipo="conferencia",
        sobretitulo="antes de seguir",
        titulo="Confira a etapa 1",
        itens=["Numeração da OCI em mãos", "Região identificada"],
        narracao="Antes de seguir: você tem a numeração da OCI em mãos e sabe de qual região ela é?",
        etapa="ETAPA 01", pop="1.1–1.3",
    ),

    # ------------------------------------------------------------- BLOCO 2
    dict(
        id="S011", tipo="secao", numero="2",
        titulo="Preenchimento da planilha e agendamento",
        narracao="Etapa dois: o preenchimento da planilha e o agendamento. É a maior parte do trabalho.",
        etapa="ETAPA 02", pop="Etapa 2",
    ),
    dict(
        id="S012", tipo="tela", arquivo="1c66b4f5a0c3.png",
        sobretitulo="tela real · caminho de rede",
        titulo="A planilha vive na rede",
        focos=[(180, 700, 20, 44, "Pasta de controle de frete"),
               (185, 470, 178, 200, "Sempre a planilha do ano corrente")],
        cursor_em=1,
        narracao="A planilha de controle não fica no seu computador: ela mora no caminho de rede, na pasta de controle de frete. É sempre a planilha do ano corrente. Abrir a cópia errada é o tipo de erro que só aparece semanas depois.",
        etapa="ETAPA 02", passo="PASSO 01 / 16", pop="2.1",
    ),
    dict(
        # Registro, não captura: os cinco campos SÃO uma lista ordenada, e a
        # lista mostra a ordem melhor que cinco zooms seguidos na mesma planilha.
        id="S013", ilustracao="planilha", tipo="registro",
        sobretitulo="o que preencher, nesta ordem",
        titulo="Lance a OCI: cinco campos",
        itens=[{"texto": "Número da OCI recebido"},
               {"texto": "Origem"},
               {"texto": "Destino"},
               {"texto": "Data em que você recebeu a OCI",
                "apoio": "a data de hoje, não a da coleta"},
               {"texto": "Motorista que faz a região"}],
        narracao="Agora é sua vez. Na planilha, lance a OCI preenchendo cinco campos, nesta ordem: o número da OCI que você recebeu; a origem; o destino; a data em que você recebeu a OCI — a data de hoje, não a da coleta; e o motorista que faz aquela região.",
        etapa="ETAPA 02", passo="PASSOS 02–06 / 16", pop="2.2–2.6",
    ),
    dict(
        id="S014", tipo="tela", arquivo="242b460e7efd.png",
        sobretitulo="tela real · coluna rota",
        titulo="A rota preenche sozinha",
        focos=[(53, 290, 0, None, "Você não digita aqui"),
               (352, 679, 0, None, "Origem e destino alimentam a rota"),
               (53, 290, 0, None, "Confira: a rota apareceu?")],
        cor_foco="verde",
        lacuna="O POP não descreve o que fazer se a rota não preencher",
        narracao="O campo rota você não preenche. Ele se preenche sozinho, a partir da origem e do destino. Seu trabalho aqui é conferir: olhe se a rota apareceu. Se apareceu, o lançamento está consistente.",
        etapa="ETAPA 02", passo="PASSO 07 / 16", pop="2.7 · P1-5",
    ),
    dict(
        id="S015", ilustracao="bloqueio", tipo="nota", estado="erro",
        titulo="Digitar a rota na mão",
        linhas=["O que acontece: sobrescreve o cálculo automático, e a rota deixa de refletir origem e destino.",
                "Como corrigir: apagar e deixar o campo preencher."],
        narracao="Erro comum: digitar a rota na mão. Parece inofensivo, mas você sobrescreve o preenchimento automático — e a rota deixa de refletir a origem e o destino que estão na linha. Se digitou, apague e deixe o campo calcular.",
        etapa="ETAPA 02", pop="derivado de 2.7",
    ),
    dict(
        id="S016", tipo="decisao",
        pergunta="A carga pode ser agendada de imediato?",
        sim="Ligar agora para posto, central e motorista",
        nao="Aguardar a janela semanal da região",
        narracao="Antes de ligar, uma decisão: essa carga pode ser agendada de imediato, ou é uma região que agenda uma vez por semana? A resposta muda o seu próximo passo. Definido isso, você liga para o posto, para a central e para o motorista.",
        etapa="ETAPA 02", pop="parágrafo do slide 3",
    ),
    dict(
        id="S017", tipo="tela", arquivo="42a3607a3cf2.png",
        sobretitulo="tela real · planilha de contatos",
        titulo="Onde estão os contatos",
        focos=[(0, 256, 0, None, "A central"),
               (256, 540, 0, None, "O contato do posto"),
               (540, 932, 0, None, "O motorista da rota"),
               (932, 1259, 0, None, "O contato da central")],
        narracao="Os contatos também ficam na rede, numa planilha própria: contatos LUFT, postos e centrais. Nela você encontra, para cada central, o contato do posto, quem é o motorista daquela rota e como falar com ele. É a sua agenda de trabalho.",
        etapa="ETAPA 02", passo="PASSOS 08–10 / 16", pop="2.8–2.10 · P0-1",
        aviso="dados de contato mascarados",
    ),
    dict(
        id="S018", tipo="tela", arquivo="e93c9a811c0e.png",
        sobretitulo="tela real · bloco agendamento",
        titulo="Registre nos três blocos",
        focos=[(0, 199, 0, None, "Postos: data, hora e nome"),
               (199, 397, 0, None, "Central: data, hora e nome"),
               (397, 528, 0, None, "TAC: data e hora")],
        narracao="Feita a ligação, registre. E registre nos três blocos. No bloco de postos: a data, a hora e o nome da pessoa com quem você falou. No bloco da central: a data, a hora e o nome de quem agendou com você. No bloco TAC: a data e a hora em que você avisou o motorista. Repare que nos dois primeiros o nome é obrigatório — é ele que transforma uma ligação em registro.",
        etapa="ETAPA 02", passo="PASSOS 11–13 / 16", pop="2.11–2.13",
    ),
    dict(
        id="S019", ilustracao="telefone", tipo="nota", estado="pratica",
        titulo="Deixe rastro do combinado",
        linhas=["Sempre que puder, agende pelo BOT ou pelo WhatsApp.",
                "Na dúvida, faça as duas: ligue e deixe registrado por escrito."],
        lacuna="O POP pede a ligação e recomenda a mensagem, sem definir precedência",
        narracao="O POP traz uma dica: sempre que puder, agende pelo BOT ou pelo WhatsApp, porque assim fica registro do combinado. Vale dizer que o documento pede a ligação e recomenda a mensagem, mas não diz qual das duas tem precedência. Na dúvida, faça as duas: ligue e deixe registrado por escrito.",
        etapa="ETAPA 02", pop="dica do slide 4 · P1-7",
    ),
    dict(
        id="S020", ilustracao="bloqueio", tipo="nota", estado="erro",
        titulo="Agendar só por telefone, sem registro",
        linhas=["O que acontece: quando o combinado é questionado, não há o que mostrar.",
                "Como corrigir: confirmar por escrito e preencher os três blocos."],
        narracao="Erro comum: combinar tudo por telefone e não registrar em lugar nenhum. Quando o combinado é questionado, não há o que mostrar. Corrigir é simples: depois da ligação, mande a confirmação por escrito e preencha os blocos.",
        etapa="ETAPA 02", pop="derivado da dica do slide 4",
    ),
    dict(
        id="S021", tipo="tela", arquivo="c55adba2c23c.png",
        sobretitulo="tela real · datas",
        titulo="Duas datas, e elas são diferentes",
        focos=[(253, 355, 0, None, "Coleta: o dia em que a carga sai do posto"),
               (355, 463, 0, None, "Descarga: o dia em que chega na central")],
        narracao="Faltam duas datas, e elas são diferentes. A data de coleta é o dia em que a carga sai do posto. A data de descarga é o dia em que ela chega na central. Preencha as duas — quem acompanha a operação depois usa exatamente esses dois campos para saber se a carga está no prazo.",
        etapa="ETAPA 02", passo="PASSOS 14–15 / 16", pop="2.14–2.15",
    ),
    dict(
        id="S022", tipo="linha_tempo",
        sobretitulo="o único prazo fixo",
        titulo="Sempre até um dia antes da coleta",
        marcos=[("AGENDAMENTO", "combinado com posto e central", False),
                ("D-1", "envio para assinatura", True),
                ("D", "coleta no posto", False)],
        cadeia=["OCI gerada no GW", "Assinatura no Autentique", "Link pelo SMBOT"],
        lacuna="Como operar o Autentique e o SMBOT é assunto da IT-ADMLUFT-002",
        narracao="E tem um último passo, que não termina na planilha. Depois do agendamento, e sempre até um dia antes da coleta, o analista envia o documento da OCI gerado no sistema para assinatura, pelo site do Autentique. Assinado, o link vai para o motorista e para o posto pelo SMBOT. Esse é o único prazo fixo deste procedimento: um dia antes. Como operar o Autentique e o SMBOT é assunto da instrução de trabalho dois.",
        etapa="ETAPA 02", passo="PASSO 16 / 16", pop="2.16 · P0-2 · P1-6",
    ),
    dict(
        id="S023", ilustracao="visto", tipo="conferencia",
        sobretitulo="fim da etapa 2",
        titulo="Confira a etapa 2",
        itens=["Planilha lançada",
               "Rota preencheu sozinha",
               "Três blocos registrados",
               "Duas datas preenchidas",
               "Documento enviado no prazo"],
        narracao="Confira a etapa dois: planilha lançada, rota preenchida sozinha, três blocos registrados, duas datas preenchidas e documento enviado no prazo.",
        etapa="ETAPA 02", pop="2.1–2.16",
    ),

    # ------------------------------------------------------------- BLOCO 3
    dict(
        id="S024", tipo="secao", numero="3", titulo="As três exceções declaradas",
        rotulo_etapa="EXCEÇÕES",
        narracao="Até aqui, o fluxo normal. Agora as três exceções que o POP declara.",
        etapa="EXCEÇÕES", pop="particularidades do slide 6",
    ),
    dict(
        id="S025", tipo="contraste",
        titulo="Motorista esporádico",
        normal=["Posto", "Central", "Motorista"],
        excecao=["Motorista", "Posto", "Central"],
        lacuna='O POP diz "normalmente" e não define "esporádico" — confirme com o responsável',
        narracao="Primeira: motorista esporádico. Nesses casos, o agendamento normalmente começa pelo motorista, e não pelo posto. O POP usa a palavra normalmente e não define o que conta como esporádico — então, se você não tiver certeza, confirme com o responsável pela conta antes de inverter a ordem.",
        etapa="EXCEÇÕES", passo="EXCEÇÃO 01 / 03", pop="X1 · P1-3",
    ),
    dict(
        id="S026", tipo="contraste",
        titulo="Cargas da Adicer",
        normal=["Recebe a OCI", "Agenda"],
        excecao=["Agenda", "Solicita a OCI"],
        # Preenche a lacuna P1-2, com procedência declarada.
        procedencia="A solicitação da OCI é feita pelo WhatsApp do responsável, Geraldo — informado pela área, não consta na REV.02",
        narracao="Segunda: cargas da Adicer. Aqui a ordem se inverte de verdade — você agenda antes de solicitar a ordem de coleta. E a solicitação é feita pelo WhatsApp do responsável, o Geraldo. Uma observação importante: isso não está escrito na revisão dois do documento. Foi informado pela área, e precisa entrar na próxima revisão do POP.",
        etapa="EXCEÇÕES", passo="EXCEÇÃO 02 / 03", pop="X2 · P1-2 resolvida pela área",
    ),
    dict(
        id="S027", tipo="excecao",
        titulo="Sorriso",
        nao=["Tem agendamento",
             "Ligar para o motorista",
             "Preencher motorista na planilha"],
        sim=["Enviar a OCI"],
        motivo="A região tem dois motoristas — escolher um seria adivinhar.",
        lacuna="O POP não define o canal de envio da OCI em Sorriso",
        narracao="Terceira: Sorriso. Sorriso não tem agendamento. A própria central passa as notas e informa a data. Você não liga para o motorista: só envia a OCI. E, ao lançar na planilha, deixe o campo motorista em branco — porque aquela região tem dois motoristas, e escolher um seria adivinhar. O POP também não diz por qual canal a OCI é enviada nesse caso.",
        etapa="EXCEÇÕES", passo="EXCEÇÃO 03 / 03", pop="X3 · P1-4",
    ),
    dict(
        id="S028", ilustracao="bloqueio", tipo="nota", estado="erro",
        titulo="Preencher motorista em carga de Sorriso",
        linhas=["O que acontece: como a região tem dois motoristas, qualquer nome é um palpite.",
                "Como corrigir: apagar e deixar o campo em branco."],
        narracao="Erro comum, e ele decorre direto da exceção anterior: lançar um motorista numa carga de Sorriso. Como a região tem dois, qualquer nome que você escrever é um palpite — e vira informação errada para quem acompanha depois. Corrigir é apagar e deixar em branco.",
        etapa="EXCEÇÕES", pop="derivado de X3",
    ),

    # ------------------------------------------------------------- BLOCO 4
    dict(
        id="S029", tipo="secao", numero="3",
        titulo="Particularidades do envio de documentos",
        narracao="Etapa três: particularidades do envio de documentos.",
        etapa="ETAPA 03", pop="Etapa 3",
    ),
    dict(
        id="S030", tipo="contraste",
        titulo="Nem tudo é automático",
        rotulos=("AUTOMÁTICO", "EXIGE AUTORIZAÇÃO"),
        normal=["Minutas"],
        excecao=["CIOT", "Manifesto"],
        narracao="Nem tudo é automático, e essa distinção evita retrabalho. Apenas as minutas são geradas automaticamente. O CIOT e o manifesto precisam ser autorizados manualmente — se ninguém autorizar, eles simplesmente não saem.",
        etapa="ETAPA 03", pop="3.1",
    ),
    dict(
        id="S031", tipo="condicoes",
        titulo="O que sai junto com o agendamento",
        regras=[("SEMPRE", "OCI, em 100% dos casos", "verde"),
                ("SE INTERESTADUAL OU MT", "CTE e MDFe", "petroleo"),
                ("SORRISO", "Nota no mesmo dia, para o CTE", "ambar")],
        narracao="E o que sai junto com o agendamento? A OCI, em cem por cento dos casos — sempre. Além dela, CTE e MDFe nos trechos interestaduais e no Mato Grosso. O critério de emissão do CTE é esse: Mato Grosso e cargas interestaduais. Uma última particularidade: o posto de Sorriso envia a nota no mesmo dia, para a emissão do CTE.",
        etapa="ETAPA 03", pop="3.2–3.5",
    ),

    # ------------------------------------------------------------- BLOCO 5
    dict(
        id="S032", ilustracao="visto", tipo="conferencia",
        sobretitulo="como saber se você fez certo",
        titulo="Seis pontos de conferência",
        # Texto curto de propósito: a narração diz o detalhe, a tela dá o
        # gancho. As frases longas quebravam em duas linhas e a lista
        # estourava a área útil da página.
        itens=["OCI lançada na planilha",
               "Rota preencheu sozinha",
               "Posto, central e motorista contatados",
               "Data, hora e nome nos três blocos",
               "Datas de coleta e de descarga",
               "Documento enviado até D-1"],
        narracao="Terminou um agendamento? Confira estes seis pontos. Se todos estiverem marcados, o trabalho está completo. Se algum falhar, você sabe exatamente onde voltar.",
        pop="resultado esperado",
    ),
    dict(
        id="S033", tipo="mapa",
        passos=["Receber", "Lançar", "Agendar", "Registrar", "Datar", "Enviar D-1"],
        narracao="Em resumo: a OCI chega por e-mail e libera o agendamento. Você lança na planilha, agenda com posto, central e motorista, e registra tudo. Preenche as datas de coleta e descarga. E envia o documento para assinatura até um dia antes. Três exceções mudam esse caminho: motorista esporádico, Adicer e Sorriso.",
        pop="síntese",
    ),

    # ------------------------------------------------------------- BLOCO 6
    dict(
        id="S034", ilustracao="documento", tipo="declaracao",
        rotulo="avaliação",
        frase="Cinco perguntas para fixar.",
        apoio="Pense na resposta antes que ela apareça.",
        narracao="Cinco perguntas para fixar. Pense na resposta antes que ela apareça.",
        etapa="AVALIAÇÃO", pop="",
    ),
    dict(
        id="S035", tipo="prova", numero=1,
        pergunta="O que autoriza você a começar o agendamento?",
        alternativas=["A confirmação do motorista por telefone",
                      "A numeração da OCI recebida por e-mail",
                      "A data de coleta definida pela central"],
        correta=1,
        justificativa="Recebida a numeração, já se pode agendar a viagem.",
        narracao="Pergunta um. O que autoriza você a começar o agendamento? A confirmação do motorista por telefone; a numeração da OCI recebida por e-mail; ou a data de coleta definida pela central?",
        narracao_resposta="A resposta é a numeração da OCI recebida por e-mail. Recebida a numeração, você já pode agendar a viagem.",
        etapa="AVALIAÇÃO", passo="01 / 05", pop="1.1–1.2",
    ),
    dict(
        id="S036", tipo="prova", numero=2,
        pergunta="Onde ficam a planilha de controle e a de contatos?",
        alternativas=["No seu computador, na área de trabalho",
                      "Anexadas ao e-mail da OCI",
                      "No caminho de rede, na pasta de controle de frete"],
        correta=2,
        justificativa="Ambas vivem na rede. A de controle é sempre a do ano corrente.",
        narracao="Pergunta dois. Onde ficam a planilha de controle e a de contatos? No seu computador, na área de trabalho; anexadas ao e-mail da OCI; ou no caminho de rede, na pasta de controle de frete?",
        narracao_resposta="No caminho de rede, na pasta de controle de frete. As duas vivem na rede, e a de controle é sempre a do ano corrente.",
        etapa="AVALIAÇÃO", passo="02 / 05", pop="2.1 · 2.9",
    ),
    dict(
        id="S037", tipo="prova", numero=3,
        pergunta="Qual destes você NÃO preenche?",
        alternativas=["O campo rota, que se preenche sozinho",
                      "A data de recebimento da OCI",
                      "O motorista que faz a região"],
        correta=0,
        justificativa="A rota é calculada a partir da origem e do destino. Digitar sobrescreve o cálculo.",
        narracao="Pergunta três. Qual destes campos você não preenche? O campo rota, que se preenche sozinho; a data de recebimento da OCI; ou o motorista que faz a região?",
        narracao_resposta="O campo rota. Ele é calculado a partir da origem e do destino — digitar por cima sobrescreve o cálculo.",
        etapa="AVALIAÇÃO", passo="03 / 05", pop="2.7 · 3.1",
    ),
    dict(
        id="S038", tipo="prova", numero=4,
        pergunta="No bloco POSTOS, o que deve ser registrado?",
        alternativas=["Apenas a data da coleta",
                      "Data, hora e o nome da pessoa com quem você agendou",
                      "Data, hora e a placa do veículo"],
        correta=1,
        justificativa="É o nome do interlocutor que transforma uma ligação em registro.",
        narracao="Pergunta quatro. No bloco de postos, o que deve ser registrado? Apenas a data da coleta; data, hora e o nome da pessoa com quem você agendou; ou data, hora e a placa do veículo?",
        narracao_resposta="Data, hora e o nome da pessoa com quem você agendou. É o nome do interlocutor que transforma uma ligação em registro.",
        etapa="AVALIAÇÃO", passo="04 / 05", pop="2.11–2.15",
    ),
    dict(
        id="S039", tipo="prova", numero=5,
        pergunta="Numa carga de Sorriso, o que muda na planilha?",
        alternativas=["Preencher o motorista com os dois nomes",
                      "Deixar o campo motorista em branco",
                      "Preencher o motorista com o da central"],
        correta=1,
        justificativa="A região tem dois motoristas — escolher um seria adivinhar.",
        narracao="Pergunta cinco. Numa carga de Sorriso, o que muda na hora de lançar na planilha? Preencher o motorista com os dois nomes; deixar o campo motorista em branco; ou preencher com o motorista da central?",
        narracao_resposta="Deixar o campo motorista em branco, porque a região tem dois motoristas e escolher um seria adivinhar. E lembre do prazo: o documento vai para assinatura sempre até um dia antes da coleta.",
        etapa="AVALIAÇÃO", passo="05 / 05", pop="2.16 · X3",
    ),

    # ------------------------------------------------------------- BLOCO 7
    dict(
        id="S040", tipo="lacunas",
        itens=["O canal de envio da OCI em Sorriso",
               "O que fazer diante de uma mensagem de erro",
               "A data a partir da qual esta revisão vale"],
        narracao="Por último, e isso é parte do treinamento: ainda há coisas que este documento não define. Ele não diz por qual canal a OCI é enviada em Sorriso, não descreve nenhuma mensagem de erro e não registra desde quando esta revisão vale. O aprovador e a solicitação da OCI na Adicer você acabou de ver — mas os dois vieram da área, não do documento, e precisam entrar na próxima revisão. Diante de qualquer situação que o POP não cobre, a resposta certa não é improvisar: é perguntar ao responsável pela conta.",
        pop="P1-4 · P1-5 · P1-1 parcial",
    ),
    dict(
        id="S041", tipo="encerramento",
        narracao="Você concluiu o treinamento de agendamento de coleta, aprovado pelo senhor Joaquim. O próximo passo na trilha é a instrução de trabalho dois: a emissão da ordem de coleta no sistema, que é onde o Autentique e o SMBOT são ensinados. Bom trabalho.",
        pop="P2-5 · P1-1",
    ),
]


def por_id(cena_id: str) -> dict:
    for c in CENAS:
        if c["id"] == cena_id:
            return c
    raise KeyError(cena_id)
