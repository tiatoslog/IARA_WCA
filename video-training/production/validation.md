# validation.md — QA, fidelidade e log de defeitos

> **Princípio aplicado:** render concluído não é qualidade aprovada. Tudo aqui
> foi medido no **arquivo MP4**, não no código que o gerou. Um pipeline correto
> pode produzir um vídeo ruim, e produziu — três vezes, antes de chegar aqui.

O portão automatizado é `project/qa.py`, que mede o arquivo e **sai com erro**
quando um limite é violado. Cada limite tem motivo declarado no próprio arquivo.

---

## 1. Matriz de fidelidade ao POP

Cobertura verificada por script: **27 de 27 elementos normativos** presentes.

| POP | Conteúdo | Cena | Presente | Correto |
|---|---|---|---|---|
| 1.1 | LUFT envia a OCI por e-mail | S007 | ✔ | ✔ |
| 1.2 | A numeração libera o agendamento | S008 | ✔ | ✔ |
| 1.3 | Particularidade de região (Piedade, sexta) | S009 | ✔ | ✔ |
| 2.1 | Acessar a planilha no caminho de rede | S012 | ✔ | ✔ |
| 2.2 | Incluir o número da OCI | S013 | ✔ | ✔ |
| 2.3 | Origem | S013 | ✔ | ✔ |
| 2.4 | Destino | S013 | ✔ | ✔ |
| 2.5 | Data de recebimento da OCI | S013 | ✔ | ✔ |
| 2.6 | Motorista que faz a região | S013 | ✔ | ✔ |
| 2.7 | Rota preenche automaticamente | S014 | ✔ | ✔ |
| — | Decisão: imediato ou 1×/semana; então ligar | S016 | ✔ | ✔ |
| 2.8 | Contatos ficam na rede | S017 | ✔ | ✔ |
| 2.9 | Planilha CONTATOS LUFT | S017 | ✔ | ✔ |
| 2.10 | Contatos de posto, central e motorista | S017 | ✔ | ✔ |
| 2.11 | POSTOS: data + hora + nome | S018 | ✔ | ✔ |
| 2.12 | CENTRAL: data + hora + nome | S018 | ✔ | ✔ |
| 2.13 | TAC: data + hora | S018 | ✔ | ✔ |
| — | Dica: agendar por BOT/WhatsApp | S019 | ✔ | ✔ |
| 2.14 | Data de coleta no posto | S021 | ✔ | ✔ |
| 2.15 | Data de descarga na central | S021 | ✔ | ✔ |
| **2.16** | **Autentique + SMBOT, sempre até D-1** | S022 | ✔ | ✔ |
| X1 | Motorista esporádico | S025 | ✔ | ✔ |
| X2 | Cargas da Adicer | S026 | ✔ | ✔ |
| X3 | Sorriso | S027 | ✔ | ✔ |
| 3.1 | Minutas automáticas; CIOT e manifesto manuais | S030 | ✔ | ✔ |
| 3.2 | Sorriso envia a nota no mesmo dia | S031 | ✔ | ✔ |
| 3.3 | OCI em 100% dos casos | S031 | ✔ | ✔ |
| 3.4 | CTE e MDFe interestadual/MT | S031 | ✔ | ✔ |
| 3.5 | Critério de emissão do CTE | S031 | ✔ | ✔ |

**Ordem normativa preservada.** As três etapas do POP aparecem na ordem do
documento. A única promoção de destaque é o **2.16**, que no POP está num
parágrafo de slide de particularidades e no vídeo virou cena própria — mudança
de ênfase, não de conteúdo, justificada em `pop-audit.md` P1-6.

**Nada inventado.** Os três "erros comuns" derivam de regras explícitas por
negação direta (tabela em `pop-analysis.md`). Nenhum erro de sistema é ensinado,
porque o POP não cataloga nenhum — e o vídeo diz isso ao aluno (S040).

**Nada omitido.** Inclusive o passo que a ingestão automática havia perdido.

---

## 2. QA técnico — `render/final.mp4`

Medido com `ffprobe`, `ebur128`, `astats`, `blackdetect`, `silencedetect`.

| Medida | Valor | Limite | |
|---|---|---|---|
| Duração | **11:00** (660,7 s) | — | |
| Resolução | **1920×1080** | 1920×1080 | ✔ |
| Codec / pixel | H.264 / yuv420p | H.264 | ✔ |
| Taxa de quadros | 30 fps | 30 | ✔ |
| Tamanho | 25,0 MB (≈318 kbps) | — | ✔ |
| Áudio | AAC 48 kHz, 2 canais | 48 kHz | ✔ |
| **Loudness integrado** | **−16,0 LUFS** | −16 ±1 | ✔ |
| Faixa (LRA) | 2,6 LU | — | ✔ |
| Pico real | **−1,49 dBFS** | ≤ −1,0 | ✔ |
| Clipping (flat factor) | **0,0** | 0 | ✔ |
| Quadros pretos | **0** | 0 | ✔ |
| Silêncio mais longo | 3,4 s | ≤ 3,6 | ✔ |
| Legendas | 180 | — | |
| Legendas sobrepostas | **0** | 0 | ✔ |
| Velocidade de leitura | 15,2 car/s (mediana) | ≤ 21 | ✔ |
| Legenda mais longa | 83 caracteres | ≤ 84 | ✔ |
| Legenda mais curta | 1,00 s | ≥ 1,0 | ✔ |

**Veredito automatizado: APROVADO.**

### `render/mobile.mp4` — corte de celular

| Medida | Valor | |
|---|---|---|
| Formato | **1080×1080** (1:1) | ✔ |
| Duração | 11:00 | ✔ |
| Tamanho | 21,1 MB (≈267 kbps) | ✔ |
| Áudio | AAC 48 kHz, 2 canais, **−16,0 LUFS**, pico −1,49 | ✔ |
| Quadros pretos | 0 | ✔ |
| Legendas | **queimadas**, em faixa própria abaixo do vídeo | ✔ |

**Veredito automatizado: APROVADO.**

O master 16:9 é o entregável primário; o quadrado é conveniência para assistir
em retrato. Ver V023 no log de defeitos, e a justificativa em "defeitos aceitos".

### Sincronia audiovisual

Medida comparando os inícios de fala detectados em `render/narracao.wav` com os
carimbos do `.srt`:

| Medida | Valor |
|---|---|
| Desvio legenda × fala, por cena | **mediana −60 ms · média −15 ms** |
| Fim do bloco de legenda × fim da fala | **0 ms** (mediana e pior caso) |
| Cenas fora de ±250 ms | 5 de 40 — todas cenas de etapa |

Os cinco desvios de +300 ms são artefato de medição, não defeito: nessas cenas
o `silencedetect` marca o **marcador sonoro** como início de fala, e ele toca
300 ms antes da voz. Verificado caso a caso.

### Ritmo

| Medida | v1 | **final** |
|---|---|---|
| Planos | 93 | **145** |
| Duração | 11:45 | **11:00** |
| Planos acima de 11 s | 15 | **1** |
| Plano mais longo | 22 s | **12,0 s** |

O único plano acima do teto é a **revelação da 5ª questão** (12,0 s): a tela
mostra a resposta e a justificativa enquanto a narração as lê e ainda relembra
o prazo D-1. É tempo de leitura, não tela congelada.

---

## 3. Log de defeitos — encontrados no arquivo, corrigidos, reverificados

Três ciclos de INSPECIONAR → DIAGNOSTICAR → CORRIGIR → RENDERIZAR → VALIDAR.

### Ciclo 1 — sobre `preview.mp4` v1

| ID | Sev. | Categoria | Local | Problema | Correção |
|---|---|---|---|---|---|
| **V001** | CRÍTICA | Ritmo / sincronia | todas as junções de cena | **2,05 s de silêncio entre todas as cenas.** O TTS do Edge devolve ~0,4 s de silêncio na cabeça e na cauda de cada arquivo; somados aos respiros, davam ar morto sistemático. Efeito colateral: a legenda era contada do início do arquivo, então entrava ~0,4 s antes da voz. | Aparar o silêncio na origem (`render.fala`), com guarda de 60 ms. Ritmo e sincronia corrigidos pela mesma mudança. **45 s recuperados.** |
| **V006** | ALTA | Motion / didática | S002, S004, S009, S010, S015, S019, S020, S027, S028, S030 | **Telas estáticas de 12 a 22 s.** Cena de cartão tinha um plano só; o quadro congelava enquanto a voz lia. É a definição visual de "PowerPoint com locução" — o modo de falha que o briefing proíbe (§8). | Revelação progressiva: uma linha por plano, entrando quando a narração chega nela. 93 → 145 planos. |
| **V012** | ALTA | Motion | 10:44–11:06 | **Encerramento parado por 22 s.** | Montagem em três tempos. |
| **V002** | ALTA | Ritmo | 00:00–00:07 | **7 s de silêncio absoluto sobre cartão parado.** Abertura sem gancho é onde o espectador decide se continua. | 4,5 s + marcador sonoro sustentado de duas notas. |
| **V003** | MÉDIA | Técnica | faixa inteira | Áudio saiu a **96 kHz mono**. `loudnorm` opera a 192 kHz e, sem `aresample` explícito, o mux herdou 96 kHz — taxa que alguns players de LMS recusam. | `aresample=48000` + estéreo. |
| **V008** | MÉDIA | Design de informação | 03:36–03:55 | Máscara repetida a cada 34 px virava **parede cinza** de "CONTATO/TELEFONE": a máscara passou a ser o assunto do quadro. | Repetição a cada 68 px. |

### Ciclo 2 — sobre `preview.mp4` v2

| ID | Sev. | Categoria | Problema | Correção |
|---|---|---|---|---|
| **V013** | ALTA | **REGRESSÃO** · Mixagem | Loudness subiu a **−13,1 LUFS** (alvo −16). Causa: o `pan` para estéreo ficou **depois** do `loudnorm`, e o R128 soma os canais — duplicar mono em L/R soma +3 dB sobre o que o normalizador acabara de medir. | Reordenar: `pan` → `loudnorm` → `aresample`. Reverificado: **−16,0 LUFS**. |
| **V018** | MÉDIA | Legenda | Uma legenda com **109 caracteres** (teto prático: 84 = duas linhas de 42). A frase era separada só por `:`, que não estava na lista de cortes. Na versão de celular, não caberia na tela. | `:` incluído nos cortes; teto 84; quebra em palavra como último recurso. |
| **V018b** | MÉDIA | Legenda | **7 legendas abaixo de 1 s** — piscam em vez de serem lidas. | Piso de 1,0 s por legenda. |
| **V018c** | ALTA | **REGRESSÃO** · Legenda | A primeira correção de V018b deslocava vizinhos e produziu uma legenda a **80 car/s** — quase 4× o limiar de leitura. | Substituída por repartição com piso (enchimento por níveis), correta por construção. Reverificado: pior caso **16,5 car/s**. |

### Ciclo 3 — sobre `final.mp4`

| ID | Sev. | Categoria | Local | Problema | Correção |
|---|---|---|---|---|---|
| **V019** | ALTA | Composição | 05:20 e 10:50 | **A moldura de conclusão do checklist cortava as descidas do título** ("Confira a etapa 2"). Defeito visível, do tipo que um espectador comum nota. | Folga do título de 20 → 56 px. |
| **V021** | MÉDIA | Acessibilidade | 10:55–11:00 | A nota "documento sem aprovador e sem data de vigência" estava a **4,24:1** em corpo 24 — a divulgação mais delicada do vídeo, no tom mais apagado da tela. | **5,92:1**, corpo 27. |
| **V022** | MÉDIA | Composição | 01:26–01:32 | Em "A numeração é o gatilho", a seta apontava para **metade de tela vazia** por ~2 s. Composição desequilibrada. | Destino desenhado como contorno fantasma desde o primeiro plano; grupo centralizado. |
| **V004** | BAIXA | Técnica | quiz | Silêncio de 4,4 s medido na abertura, acima do teto de 3,6 s do portão. | Coberto por V002. |
| **V023** | **CRÍTICA** | Formato / legibilidade | versão de celular, inteira | **O corte 9:16 era inutilizável.** O quadro 16:9 encaixotado ocupava 32% da altura, com 1313 px de tarja vazia: no telefone o texto saía **menor** do que se a pessoa assistisse o master deitado — o oposto do objetivo do corte. Somado a isso, a legenda queimada dentro do quadro 16:9 **cobria o cartão de lacuna**. | Refeito em **1080×1080**: vídeo em largura cheia no topo, faixa própria embaixo para a legenda. Recortar as laterais foi descartado — comeria as colunas da planilha, que são o conteúdo. |
| **V023b** | ALTA | **REGRESSÃO** · Legenda | idem | A primeira tentativa usou `subtitles=…:force_style` sobre o SRT. Sem `PlayResX/Y` declarados, o libass adota resolução de referência própria: as letras saíram com ~110 px cobrindo o quadro, e `MarginV` não deslocou nada. | Gerar um **`.ass` com resolução de referência explícita** (`subtitles/IT-ADMLUFT-001-celular.ass`) e queimar com o filtro `ass`. Corpo e margem passam a ser previsíveis. |

### Ciclo 4 — redesign visual completo

O sistema visual foi **reconstruído**, não retocado: a primeira versão estava
correta e genérica, e lia como apresentação corporativa. O que mudou e por quê
está em `production/design-system.md`; aqui ficam os defeitos que o redesign
introduziu e que a inspeção do arquivo pegou.

| ID | Sev. | Categoria | Problema | Correção |
|---|---|---|---|---|
| **V024** | ALTA | Composição · sistemático | **O rótulo da nota de rodapé entrava por baixo do texto** em toda cena com lacuna ou procedência. `O POP NÃO DEFINE` mede ~210 px em Bahnschrift 22 com entreletra +3; o trilho tem 168. | Rótulo empilhado **acima** do texto. De quebra, a nota ganhou forma de verbete. |
| **V025** | ALTA | Composição | Na cena de captura, a **anotação do trilho transbordava por cima da própria tela** que deveria explicar — mesma causa: 168 px de coluna. | Anotação movida para **abaixo** da captura, na largura do campo; o trilho fica com o contador, que é curto e cabe. |
| **V026** | ALTA | Diagrama | No fluxo, o conector em degrau **riscava o nome do elo**, e `VOCÊ ESTÁ AQUI` caía sobre ele. | Conector fixado 148 px abaixo do topo do nó; rótulo ao lado do número. |
| **V027** | MÉDIA | Composição | A captura **encostava no título**. | Caixa da captura descida para `Y_CAB + 252`, em largura cheia. |
| **V028** | MÉDIA | Composição | Páginas de prova com **~280 px de vazio no rodapé** — liam como inacabadas. | Bloco centrado no óptico. |
| **V029** | BAIXA | Componente | O quadrado marcador aparecia em listas de sequência, onde **o número já é o marcador** — lia como bullet. | Marcador só onde há estado de fato (conferido / não conferido). |

**Divergência estrutural resolvida na raiz.** `script.md` era escrito à mão e
passou a mentir no instante em que uma cena mudou de arquétipo — o verificador
acusou. Agora `script.md` e `storyboard.md` são **gerados de `cenas.py`**: os
dois saem do mesmo dado que produz os quadros, ou nenhum sai.

**Nova verificação em `verificar.py`:** falha se um arquétipo se repetir três
cenas seguidas (a prova é exceção declarada). É a regra de design virando portão
executável, em vez de intenção num documento.

### Ciclo 5 — sobreposições, sincronia da prova e ilustração

Achados trazidos por quem assistiu ao arquivo, mais o que a medição confirmou.

| ID | Sev. | Categoria | Problema | Correção |
|---|---|---|---|---|
| **V030** | **CRÍTICA** | **REGRESSÃO** · Sincronia | **As cinco questões saíram de sincronia com a voz** — o gabarito aparecia fora do instante em que a resposta é dita. Causa: o arquétipo `quiz` foi renomeado para `prova` no redesign, e `render.py` ancorava o corte da revelação em `if cena["tipo"] == "quiz"`. A condição nunca mais foi verdadeira; as provas caíram na distribuição genérica por peso. **Falhou em silêncio** porque nada obrigava os dois nomes a concordarem. | A condição passou a olhar o **dado** (`if d_fala_b:` — existe segunda narração, logo existe pausa), não o nome do tipo. Renomear arquétipo não quebra mais nada. Guarda permanente em `montar_tempos`: se o corte não cair no instante da resposta, **o build para**. Reverificado: **0 ms de desvio nas cinco**. |
| **V031** | ALTA | Composição · sistemático | **Rótulos de estado sobrepondo texto e filete** em `nota` e `condicoes`. Medido: o trilho tem 168 px e os rótulos vão de 100 a 330 (`ERRO COMUM` 164, `SE INTERESTADUAL OU MT` 330, `INFORMADO PELA ÁREA` 295). A coluna foi dimensionada para numerais e recebeu palavras. | Rótulo sai do trilho e vira **sobrancelha acima do título**, no campo — que é também a forma editorial correta. |
| **V032** | ALTA | Composição | **Entradas do checklist sobrepostas.** O pintor descartava o `y` devolvido por `entrada()` e avançava por valor fixo; item que quebrava em duas linhas passava por cima do seguinte. Ficou visível quando o painel ilustrado estreitou a coluna. | Usar o `y` devolvido. Auditoria de altura em todas as 9 listas: nenhuma estoura a área útil. |
| **V033** | MÉDIA | Composição | O filete do estado **cruzava o rótulo** `ATENÇÃO` ao meio. | Recuado para 24 px abaixo do retorno da sobrancelha. |
| **V034** | ALTA | Direção de arte | **Páginas brancas e sem vida**, e fadiga de texto — a crítica que motivou este ciclo. | **12 ilustrações flat originais** (`ilustracoes.py`) + painel de cor em 13 cenas. Texto do checklist de conferência encurtado: a narração carrega o detalhe. |

**Sobre as referências de banco de imagens:** foram lidas como direção, não
usadas como asset. Vetor licenciado de terceiro não entra num vídeo comercial
sem verificação de licença — a regra é do próprio repositório. As doze
ilustrações são desenhadas em código, na paleta, e do domínio real do
procedimento.

### Defeitos aceitos, com justificativa

| Situação | Por que não foi "corrigido" |
|---|---|
| Coluna MOTORISTA aparece mascarada exatamente no passo que ensina a preenchê-la (S013, foco 5) | Alternativa seria inventar dado sintético dentro de uma captura real — e aí a tela deixaria de ser a tela do sistema. O rótulo do campo carrega o significado. LGPD acima de estética. |
| A versão de celular tem faixas da identidade acima e abaixo do vídeo | O conteúdo é uma planilha larga. Encher um quadro de retrato exigiria recortar colunas — que é o conteúdo — ou recompor as 41 cenas num layout vertical próprio. **O master 16:9 continua sendo o entregável primário**; o quadrado é conveniência para assistir em retrato. Está dito no `README.md`. |
| Dados de exemplo de 2022 num POP de 2025 | É a captura real. Substituir seria falsificar evidência. Registrado em `pop-audit.md` P2-2. |
| LRA de 2,6 LU (faixa dinâmica estreita) | Natureza de narração de voz única normalizada. Ampliar exigiria interpretação dramática que não cabe em treinamento operacional. |
| Plano de 12,0 s na 5ª questão | Tempo de leitura da resposta + justificativa, com narração correndo. Encurtar prejudicaria a compreensão. |

---

## 4. Revisão pelas cinco perspectivas

### 4.1 Colaborador novo — *"eu consigo repetir?"*

Percorri o vídeo perguntando, a cada etapa, se conseguiria executar sem ajuda.

- **Consigo.** As cinco colunas de lançamento aparecem uma a uma, com o nome do
  campo sobre a coluna real. O checklist de seis pontos dá o critério de pronto.
- **Ponto que quase falhou:** no primeiro corte, a rota era ensinada como "não
  preencha" e pronto. Faltava *de onde ela vem*. Corrigido: S014 ganhou um
  segundo foco em ORIGEM + DESTINO, então o aluno entende o mecanismo, não só a
  proibição.
- **O que ainda exige apoio:** a primeira ligação real. O vídeo ensina o que
  registrar, não como conduzir a conversa — e o POP também não.

### 4.2 Operador experiente — *"está certo?"*

- Ordem das etapas confere com o documento.
- A ambiguidade ligar × registrar (P1-7) **não foi escondida atrás de uma
  escolha minha**: o vídeo mostra as duas exigências e diz que o POP não define
  precedência. Um operador experiente reconhece o próprio dilema ali.
- A exceção de Sorriso está completa: as três coisas que não se faz e a única
  que se faz.

### 4.3 Instrutor — *"dá para ensinar com isso?"*

- Estrutura OBSERVE → FAÇA → CONFIRA presente em cada etapa.
- O quiz mede sequência, localização, decisão, registro e exceção — cinco
  dimensões distintas, sem pergunta trivial.
- **Falta, e é limitação real:** não há pausa de prática guiada com espaço para
  o aluno executar junto. Um instrutor conduzindo turma vai querer pausar
  manualmente após S023 e S032.

### 4.4 RH — *"posso distribuir?"*

- **Sim.** Nenhum dado pessoal circula: 16 faixas mascaradas, relatório em
  `mascarar-relatorio.md`, verificação visual imagem a imagem registrada.
- Legendas em `.srt` separado no master (permitem ligar/desligar) e **queimadas**
  na versão de celular, onde o player costuma não ter controle de legenda.
- Contraste medido; nenhuma informação depende só de cor (ícone + palavra
  sempre acompanham).
- Duração de 11 minutos cabe num intervalo de onboarding.

### 4.5 Auditor do POP — *"é fiel?"*

- 27 de 27 elementos normativos presentes; ordem preservada; nada inventado.
- **Código e revisão do POP aparecem no rodapé de todos os quadros** — um frame
  capturado fora de contexto ainda diz de qual norma veio.
- As quatro lacunas do documento são declaradas em tela (S040), não maquiadas.
- **Ressalva que o auditor deve registrar:** o documento não tem aprovador nem
  data de vigência. O vídeo treina sobre uma norma que ninguém assinou. Isso é
  problema do POP, não do treinamento — mas é o treinamento que o torna visível.

---

## 5. O que precisa de decisão humana

Nenhum destes é corrigível com os recursos desta produção.

1. **Preencher `Data`, `Elaborado por`, `Analisado por` e `Aprovado por` no POP.**
   Vale para os 11 documentos. Enquanto estiver vazio, o vídeo continuará
   dizendo em tela que a norma não tem aprovador — o que é o comportamento
   correto, e desconfortável de propósito.

2. **Resolver a ambiguidade ligar × registrar** (P1-7). O POP manda ligar e
   recomenda mensagem, sem dizer qual prevalece. Uma frase no POP resolve.

3. **Documentar como se solicita a OCI nas cargas da Adicer** (P1-2) e **o canal
   de envio em Sorriso** (P1-4).

4. **Corrigir o defeito de ingestão que perdeu o passo 2.16** em
   `scripts/geracao/ingerir-pops.ts`. **Os outros 10 POPs não foram auditados
   contra os `.pptx`** — o mesmo tipo de perda pode estar neles, e a IARA lê
   dessa base. É o item de maior consequência desta lista.

5. **Corrigir o rótulo de sistema "GW"** deste POP no índice (P1-8).

6. **Regravar a narração com voz humana**, se a área de Educação Corporativa
   julgar necessário. A voz neural é natural para padrão de mercado, mas é
   sintética; o roteiro está marcado por cena e a troca não exige reeditar nada.

7. **Trilha musical.** Não há biblioteca licenciada no projeto. O espaço está
   reservado no mix.

---

## 6. Checklist de "pronto"

| | Item | |
|---|---|---|
| ✔ | POP auditado antes do roteiro (P0/P1/P2) | `pop-audit.md` |
| ✔ | Roteiro validado contra o `.pptx`, não contra a base derivada | `pop-analysis.md` |
| ✔ | Storyboard validado antes do render | 145 quadros, folha de contato |
| ✔ | Identidade visual definida, com contraste **medido** | `style-guide.md` |
| ✔ | Dados sensíveis removidos e **conferidos visualmente** | `mascarar-relatorio.md` |
| ✔ | Capturas reais, nenhuma interface recriada | — |
| ✔ | Narração neural pt-BR, voz canônica do projeto | `Voz.ts` |
| ✔ | Áudio limpo: −16,0 LUFS, pico −1,49, sem clipping | `qa.py` |
| ✔ | Legendas sincronizadas (mediana −60 ms), sem sobreposição | `qa.py` |
| ✔ | Motion consistente; 1 plano acima de 11 s, justificado | `tempos.json` |
| ✔ | Todas as etapas representadas (27/27) | §1 |
| ✔ | Três exceções representadas | S025–S027 |
| ✔ | Três erros comuns, todos derivados do POP | S015, S020, S028 |
| ✔ | Quiz criado, com rastreio ao POP | `quiz.md` |
| ✔ | Render validado por medição no arquivo | `qa.py` → APROVADO |
| ✔ | Quadros revisados visualmente, em três ciclos | §3 |
| ✔ | Fidelidade ao POP validada | §1 |
| ⚠ | Música adequada | **ausente** — sem biblioteca licenciada |
| ⚠ | Aprovador do POP | **ausente no documento de origem** |
