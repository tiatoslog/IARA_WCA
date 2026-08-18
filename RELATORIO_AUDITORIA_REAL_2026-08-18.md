# IARA — RELATÓRIO DE AUDITORIA REAL

**Alvo:** https://iara.up.railway.app (produção)
**Data:** 18/08/2026
**Sessão:** autenticada como Daiane, via Chrome real
**Método:** uso pela interface, como operadora. Código só foi lido depois, para
achar causa provável.

> **Aviso de escopo.** Três blocos do roteiro não puderam ser executados, e a
> razão é ela própria um achado: **automações não puderam ser testadas porque
> não existem** (seção 8), **execução em máquina não pôde ser testada porque
> nenhum computador está conectado**, e **cognição não pôde ser medida a fundo
> porque nenhum provedor de raciocínio responde**. O que segue é o que foi de
> fato observado na tela.

---

## 1. Resumo executivo

| | |
|---|---|
| Total de problemas | **28** |
| P0 — bloqueador | **3** |
| P1 — crítico | **4** |
| P2 — alto | **9** |
| P3 — médio | **8** |
| P4 — baixo | **4** |

> **Estado das correções (Fase 1 aplicada em 18/08/2026).** P0-01 e P0-02 estão
> **corrigidos e verificados** — ver a seção 14 no fim deste documento. P0-03 é
> operacional (ligar a máquina), não de código. Os demais permanecem abertos.

### Principal risco

**A IARA afirma capacidades que não possui.** Quando a nuvem cai, ela responde
que "continua com o que é local: clima, hora, infraestrutura, histórico e
busca". Três dessas cinco falham quando pedidas. Isso não é uma falha de
disponibilidade — é o produto **quebrando o seu próprio invariante declarado**
("a IARA não mente sobre o que fez"), na frente do operador, de forma repetível.

### Principal problema de UX

O produto tem **duas metades desconectadas**: 75% da tela é uma entidade 3D
bonita que não comunica nada acionável, e 25% é um chat que responde erro. Não
existe nenhuma superfície onde o operador veja *o que a IARA pode fazer por
ele*. A pergunta mais básica de um usuário novo — "o que você consegue fazer?"
— é justamente uma das que falham.

### Principal problema cognitivo

A cadeia de raciocínio não faz failover de verdade. `/saude` declara a cadeia
`groq → gemini → anthropic`. Na prática o operador recebe, para a mesma classe
de pedido, ora o **JSON cru de erro 404 da Groq**, ora a mensagem de cota da
Anthropic. Gemini nunca aparece. O usuário não consegue formar modelo mental do
que está quebrado.

### Principal problema de arquitetura percebida

Quatro nomes para dois conceitos ("dispositivo", "mão", "Automação",
"computador" — e "braço"/"agente" na documentação), sendo que **"Automação" é o
nome do programa executor**, não de uma rotina. Um operador que queira "criar
uma automação" cai numa página de download de programa.

---

## 2. SCORE DA IARA

| Área | Nota |
| ------------------- | ---: |
| Clareza | 3 |
| UX | 4 |
| UI | 7 |
| Navegação | 4 |
| Conversação | 2 |
| Cognição | 1 |
| Memória/contexto | 2 |
| Execução de ações | 0 |
| Feedback | 3 |
| Dispositivos | 6 |
| Automações | 0 |
| Segurança percebida | 5 |
| Confiabilidade | 2 |
| Consistência | 3 |

**Clareza (3)** — a tela não diz o que o produto faz. O maior elemento visual é
uma pedra abstrata sem legenda. Ponto positivo isolado: o painel de perfil
explica-se muito bem.

**UX (4)** — há trabalho de qualidade real aqui (pareamento em 3 passos, texto
honesto no perfil), mas afogado por descoberta ruim: três domínios atrás de um
ícone sem rótulo.

**UI (7)** — a nota mais alta, e merecida. Tipografia, espaçamento, paleta
grafite e a entidade 3D estão acima da média de mercado. Perde pontos por um
menu semitransparente ilegível e pela área morta.

**Navegação (4)** — aplicação de página única sem rotas: voltar/avançar do
navegador não navegam entre seções, não há link direto para nada.

**Conversação (2)** — de 13 pedidos observados, 3 responderam de forma útil.

**Cognição (1)** — o painel técnico da própria IARA mostra as cinco capacidades
em **0** e a resposta marcada como **"via falha"**. Ela sabe que falhou. O 1 é
por manter a honestidade na recusa em vez de alucinar.

**Memória/contexto (2)** — não foi possível medir: os testes de memória ("qual
computador eu mencionei?") caem no erro de cota. O 2 vem de um acerto real: no
pedido ambíguo "faz isso", ela referenciou corretamente os dois pedidos
pendentes anteriores.

**Execução de ações (0)** — zero computadores conectados. Nada pode ser
executado. O painel Automação afirma isso explicitamente.

**Feedback (3)** — os estados de erro existem, mas dois erros diferentes
descrevem a mesma causa, e um deles despeja JSON de API.

**Dispositivos (6)** — a área mais bem resolvida do produto. Perde por um
indicador verde que mente.

**Automações (0)** — a funcionalidade não existe no produto.

**Segurança percebida (5)** — bom: erro de login não revela se o e-mail existe.
Ruim: `/saude` é público e expõe modo, provedores e contagem de dispositivos; e
o operador comum recebe o nome do fornecedor e a URL do console de billing.

**Confiabilidade (2)** — a mesma condição produz mensagens diferentes; a
entidade 3D ficou invisível em 3 carregamentos e visível nos seguintes.

**Consistência (3)** — nomenclatura fragmentada e um rótulo de botão que não
corresponde ao painel que abre.

---

## 3. PROBLEMAS ENCONTRADOS

### [P0-01] Nenhum provedor de raciocínio funciona — quase todo pedido falha

**Severidade:** P0
**Tela:** Conversa

**Como reproduzir:** enviar "O que você consegue fazer?", "quantas cargas
coletamos ontem?" ou "como está a infraestrutura?".

**Esperado:** resposta útil, ou failover silencioso para o próximo provedor.

**Observado:** erro. Ora `groq respondeu 404: {"error":{"message":"The model
llama-3.3-70b-versatile does not exist or you do not have access to it."...}}`,
ora a mensagem de cota esgotada da Anthropic.

**Impacto:** o produto não responde a nenhuma pergunta de negócio. É a causa
direta da percepção de que "a IARA não serve para nada".

**Evidência:** transcript da operadora (13 turnos); meu teste de
"infraestrutura"; painel técnico marcando `RESPOSTA: via falha (1313 ms)` e as
cinco capacidades em 0.

**Causa provável:** `servidor/nucleo/ClienteCompativelOpenAI.ts:111` fixa
`modeloPadrao: 'llama-3.3-70b-versatile'`. Esse modelo foi descomissionado pela
Groq — daí o 404. Com a Groq morta no primeiro elo e a Anthropic sem crédito, a
cadeia fica sem saída viável; o Gemini não aparece em nenhuma resposta
observada.

**Recomendação:** (1) atualizar `GROQ_MODELO` para um modelo vivo e tratar 404
de modelo como *elo morto* — descer imediatamente na cadeia em vez de devolver
o erro; (2) uma sonda de arranque que valide cada elo e registre no `/saude`
qual está realmente utilizável, não apenas configurado.

---

### [P0-02] A mensagem de degradação promete cinco capacidades; três não existem

**Severidade:** P0
**Tela:** Conversa

**Como reproduzir:** com a nuvem indisponível, pedir qualquer uma das cinco que
ela mesma lista.

**Esperado:** se ela diz que faz infraestrutura, histórico e busca localmente,
esses três funcionam.

**Observado:**

| Prometido na mensagem | Resultado medido |
|---|---|
| clima | ✅ funcionou (resposta rica e honesta) |
| hora | ✅ funcionou |
| infraestrutura | ❌ devolveu a própria mensagem de cota |
| histórico | ❌ devolveu a própria mensagem de cota |
| busca | ❌ devolveu a própria mensagem de cota |

**Impacto:** é o problema mais grave do produto. Não é indisponibilidade — é
**afirmação falsa repetível**. O operador pede exatamente o que lhe foi
oferecido, uma frase antes, e leva a mesma recusa. Depois disso ele não tem
razão para acreditar em nenhuma outra afirmação da IARA.

**Evidência:** "me mostre o histórico da nossa conversa" e "busque na internet
o preço atual do diesel S10" (operadora) e "como está a infraestrutura?"
(auditoria) — os três devolveram texto idêntico ao da promessa.

**Causa provável — confirmada na investigação posterior, e não é a óbvia.** As
receitas **existem**: `RECEITAS` no `Planejador` tem `infraestrutura`, `busca` e
`incidente`. O que faltava era a **âncora** — nenhuma reconhecia a frase que a
própria mensagem anunciava:

- a âncora `infraestrutura` casa "quantas centrais", "frota ativa" — **não casa
  a palavra "infraestrutura"**. Foi deliberadamente estreitada num conserto
  anterior (a palavra `frota` solta capturava tudo) e a palavra literal nunca
  entrou;
- a âncora `busca` exigia o substantivo exato "busca na internet". A operadora
  escreveu "**busque** na internet" — e em português o radical de *buscar* troca
  `c` por `qu` antes de `e`, então nem um `busc\w*` resolveria. Errou pela
  conjugação;
- "histórico" na mensagem significa **histórico de incidentes**. A operadora leu
  "histórico da nossa conversa", pediu isso, e não havia receita para isso.

Somado a isso, a lista de cinco estava escrita **à mão em dois arquivos**
(`Kernel.mensagemHumanaDeFalha` e `DiagnosticoProvedores.resumirProvedores`),
nenhum ligado às receitas — então ninguém percebeu a divergência.

**Recomendação:** uma fonte única, com um exemplo de frase por capacidade, e um
teste que exija que cada exemplo chegue de fato à receita. Rótulos que digam o
que a receita faz ("histórico de incidentes", não "histórico").

---

### [P0-03] Não há execução possível: nenhum computador conectado

**Severidade:** P0
**Tela:** Automação da IARA / Dispositivos

**Como reproduzir:** abrir o menu do nome → Automação.

**Esperado:** pelo menos uma máquina disponível para a IARA agir.

**Observado:** "**Nenhum computador conectado agora**". O único dispositivo,
"Homeoffice", está **desligado desde 16 de agosto**. `/saude` confirma:
`dispositivos: 0`, `maos_no_motor: false`.

**Impacto:** somado ao P0-01, fecha o quadro: sem raciocínio e sem mãos, o
produto não tem nenhuma função executável. A recusa em "abra o bloco de notas"
é honesta, mas o desfecho para o operador é o mesmo — nada acontece.

**Evidência:** painel Automação; `/saude`.

**Recomendação:** a tela inicial precisa dizer isso **antes** do operador
tentar. Hoje ele só descobre depois de pedir e falhar.

---

### [P1-01] Erro cru de API do fornecedor exibido ao operador

**Severidade:** P1
**Tela:** Conversa

**Observado:** `Não consegui concluir esse pedido: groq respondeu 404:
{"error":{"message":"The model llama-3.3-70b-versatile does not exist or you do
not have access to it.","type":"invalid_request_error","code":"model_not_found"}}`

**Impacto:** JSON de API na cara de uma analista operacional. Vaza fornecedor,
nome de modelo e estrutura interna; não informa nada acionável.

**Recomendação:** nenhuma resposta de fornecedor deve chegar à superfície. Erro
técnico vai para o jornal; o operador recebe uma frase única e estável.

---

### [P3-08] Ponto verde ambíguo ao lado do ícone de dispositivos

**Severidade:** P3 *(rebaixado de P1 — ver correção abaixo)*
**Tela:** Barra superior

> **CORREÇÃO DE UM ERRO DESTA AUDITORIA.** A primeira versão deste relatório
> afirmou que o ponto verde dizia "Computadores conectados" com zero conectados,
> e o classificou como P1 e como *maior risco do produto*. **Estava errado.** A
> leitura veio da árvore de acessibilidade, onde o rótulo "Computadores
> conectados" pertence ao ícone das MÃOS, um botão vizinho. O ponto verde é um
> `<span>` separado (`PainelConversa.tsx:428-431`) cujo `title` é "barramento
> aberto": ele reporta a sessão WebSocket, que estava de fato aberta. Verde
> estava correto. O ícone das mãos, por sua vez, exibe a contagem só quando há
> máquina ligada — e não exibia nenhuma, que é o comportamento certo. **Os dois
> indicadores estavam dizendo a verdade.**

**O que resta de problema real:** um ponto colorido sem legenda, encostado no
ícone de dispositivos, cuja única explicação é um `title` que diz "barramento
aberto". "Barramento" é vocabulário de engenharia. Um operador lê um ponto verde
adjacente ao ícone de máquinas como "as máquinas estão bem" — foi o que esta
auditoria fez, com acesso ao código-fonte.

**Recomendação:** rotular em português de operação ("conexão com a IARA: ativa")
e afastar do ícone de dispositivos, ou fundir os dois num indicador só.

---

### [P1-03] A mesma falha produz duas mensagens diferentes

**Severidade:** P1
**Tela:** Conversa

**Observado:** "oi IARA" → erro 404 da Groq. "oi" (logo depois) → mensagem de
cota da Anthropic. Mesma condição, dois relatos incompatíveis.

**Impacto:** impede diagnóstico até por quem administra. A operadora não sabe
se o problema é crédito, modelo ou rede.

---

### [P1-04] Menu de perfil semitransparente — item "Dispositivos" ilegível

**Severidade:** P1
**Tela:** Menu do nome (topo)

**Como reproduzir:** clicar em "Boas-vindas, Daiane" com mensagens no chat
atrás do menu.

**Observado:** o menu não tem fundo opaco. O texto das mensagens atravessa. O
item **"Dispositivos" fica ilegível**; "Meu perfil", "Automação" e "Sair"
sobrevivem. Verificado em dois instantes distintos — é estado estável, não
frame de animação.

**Impacto:** o caminho principal para parear máquina fica escondido à vista.

**Recomendação:** fundo opaco e `z-index` acima da lista de mensagens.

---

### [P1-05] A entidade 3D — 75% da tela — ficou invisível em 3 carregamentos

**Severidade:** P1
**Tela:** Projeção "presença"

**Como reproduzir:** intermitente. Em janela de 1568px de largura, três
carregamentos seguidos renderizaram **preto absoluto**; após redimensionar para
1427px passou a renderizar, e voltou a funcionar em 1568px depois.

**Observado:** `<canvas>` presente (1425×798), **zero erros de console**, todas
as requisições 200. Não é crash — é repaint que não acontece.

**Impacto:** o elemento de identidade do produto — e a maior parte da tela —
some. O operador vê um vazio preto.

**Causa provável:** frameloop sob demanda que não dispara repaint no primeiro
quadro em certas larguras/aspectos.

**Recomendação:** forçar um quadro no `resize` e no `mount`.

---

### [P2-01] Não existe criação de automações

**Severidade:** P2 · **Tela:** todo o produto

**Observado:** não há em lugar nenhum criar, editar, excluir, agendar ou ver
histórico de automação. O que se chama "Automação" é **o programa executor**
("A Automação é o que dá mãos à IARA num computador").

**Impacto:** a jornada inteira da seção 8 do roteiro não existe. E o nome
colide: quem procurar "automação" acha um instalador.

**Recomendação:** renomear o programa (ex.: "Braço" ou "Executor da IARA") e
liberar a palavra "Automação" — ou assumir que o produto não tem automações e
tirar a palavra do rótulo do botão.

---

### [P2-02] Rótulo do botão promete três domínios; painel entrega um

**Severidade:** P2 · **Tela:** barra superior

**Observado:** botão com rótulo acessível "Perfil, dispositivos e automação"
abre um painel intitulado "**Onde a IARA tem mãos**", só com dispositivos.

---

### [P2-03] Painel técnico com internos expostos ao operador comum

**Severidade:** P2 · **Tela:** ícone de controles (canto inferior esquerdo)

**Observado:** um ícone sem rótulo visível abre `INTENÇÃO: indeterminado
(texto, confiança 0.35)`, `CAPACIDADE: rota plano_cognitivo`, `RESPOSTA: via
falha (1313 ms)`.

**Impacto:** vocabulário de engenharia para uma analista operacional. Útil para
depurar, ruído para operar.

---

### [P2-04] "Sair" duplicado e em posição de máximo destaque

**Severidade:** P2 · **Tela:** global

**Observado:** "Sair" existe como botão flutuante no **canto superior
esquerdo** — a posição mais nobre da tela, sozinho sobre o vazio — e de novo
dentro do menu do nome.

**Impacto:** a ação mais destrutiva e menos frequente ocupa o lugar de maior
prioridade visual.

---

### [P2-05] Nome do fornecedor e console de billing expostos ao operador

**Severidade:** P2 · **Tela:** Conversa

**Observado:** "Avise quem administra a IARA para recarregar em
console.anthropic.com."

**Impacto:** vaza a pilha e transfere um problema administrativo para quem não
pode resolvê-lo.

---

### [P2-06] `/saude` é público e sem autenticação

**Severidade:** P2

**Observado:** sem sessão, `GET /saude` devolve `modo`, `autenticacao`,
`dispositivos`, `maos_no_motor` e a lista de provedores.

---

### [P2-07] Login sem "criar conta" e sem "esqueci a senha"

**Severidade:** P2 · **Tela:** Login

**Observado:** a tela tem exatamente e-mail, senha e "Entrar". Quem esquecer a
senha não tem caminho de recuperação pela interface.

---

### [P2-08] "Desconectar" sem confirmação aparente ao lado do dispositivo

**Severidade:** P2 · **Tela:** Dispositivos

**Observação:** o botão fica imediatamente à direita da linha da máquina. **Não
executei** para não desconectar a máquina real da operadora — fica registrado
como não verificado.

---

### [P2-09] 404 cru do framework, sem identidade e sem saída

**Severidade:** P2 · **Tela:** qualquer rota inexistente (`/painel`)

**Observado:** "404 — This page could not be found.", em inglês, sem
navegação de volta.

---

### [P3-01] Cinco ícones sem rótulo visível na barra do chat
Microfone, vigília, mudo, interromper e anexar. Têm rótulo acessível — mas
visualmente o operador precisa adivinhar. "Vigília do chamado ei IARA" é
impossível de inferir do ícone.

### [P3-02] Erro de login persiste após limpar os campos
"E-mail ou senha não conferem." continua visível depois de esvaziar os campos.

### [P3-03] Botão "?" inerte
O "?" ao lado de "Onde a IARA tem mãos" não produziu nada visível.

### [P3-04] Instalar o app é prosa, não botão
"procure o ícone de instalação na barra de endereço" — manda caçar uma
affordance do navegador em vez de oferecer a ação.

### [P3-05] Campo de função trunca o conteúdo
"Analista Operacional e desenvolvedora de softw…" sem meio de ver o texto todo.

### [P3-06] Página única sem rotas
Voltar/avançar do navegador não navegam entre seções; nada é linkável.

### [P3-07] Painel técnico cortado embaixo
"ÚLTIMO TURNO / rota / latência" fica cortado no rodapé.

### [P4-01] "Percebe, decide e executa." é a única explicação do produto
Três verbos abstratos não dizem a um usuário novo o que ele ganha.

### [P4-02] Ponto verde sem legenda
Nenhum texto ou tooltip visível explica o que a cor significa.

### [P4-03] Vazio visual permanente
Mesmo com a entidade renderizando, a área central não carrega nenhuma
informação acionável.

### [P4-04] "Boas-vindas, Daiane" não parece clicável
É o acesso a perfil/dispositivos/automação/sair, sem nenhuma marca de menu.

---

## 4. PROBLEMAS POR DOMÍNIO

**UI** — P1-04, P1-05, P3-05, P3-07, P4-03
**UX** — P2-02, P2-04, P2-07, P3-01, P3-03, P3-04, P4-01, P4-04
**Cognição** — P0-01, P0-02, P1-03, P2-03
**Memória** — não mensurável (bloqueada por P0-01)
**Conversação** — P0-02, P1-01, P1-03
**Automação** — P2-01 (a funcionalidade não existe)
**Dispositivos** — P1-02, P2-08
**Braço/Automação (programa)** — P0-03, P2-01
**Navegação** — P2-09, P3-06
**Segurança** — P2-05, P2-06, P2-07
**Performance percebida** — P1-05
**Arquitetura percebida** — P2-01, P2-02

---

## 5. CONTRADIÇÕES

1. **Configurado contra utilizável.** `/saude` respondia `ok: true` e
   `raciocinio: ["groq","gemini","anthropic"]` no exato momento em que a
   operadora recebia erro em todo pedido. De fora, o deploy parecia saudável.

2. **A promessa contra a entrega.** "continuo com o que é local: clima, hora,
   infraestrutura, histórico e busca" — e então recusa infraestrutura,
   histórico e busca com essa mesma frase.

3. **O rótulo contra o painel.** Botão: "Perfil, dispositivos e automação".
   Painel: "Onde a IARA tem mãos", só dispositivos.

4. **Um nome, dois significados.** "Automação" é o programa executor no menu e
   no painel; mas é também a palavra que qualquer operador usaria para uma
   rotina — que não existe.

5. **Quatro nomes para a mesma coisa.** "dispositivo", "mão", "computador",
   "aparelho" na interface; "braço" e "agente" no código e na documentação.

6. **Duas causas para a mesma falha.** 404 de modelo inexistente vs. cota
   esgotada, alternando entre turnos consecutivos.

---

## 6. JORNADAS QUEBRADAS

**Perguntar qualquer coisa de negócio**
pergunta → roteamento → provedor → ❌ **quebra no provedor** → erro.

**Usar o modo degradado como oferecido**
falha da nuvem → IARA oferece 5 capacidades → operador pede uma → ❌ **quebra na
oferta**: 3 das 5 devolvem a própria mensagem de recusa.

**Executar algo numa máquina**
pedido → ❌ **quebra antes de começar**: nenhum computador conectado. A recusa é
honesta, mas o operador só descobre depois de pedir.

**Criar uma automação**
❌ **a jornada não existe**. E o nome leva a um instalador.

**Descobrir o que a IARA faz**
usuário novo → "O que você consegue fazer?" → ❌ **quebra**: erro de cota.

**Parear um computador** ✅
menu → Dispositivos → Parear → 3 passos → código/QR → nome. **Funciona e está
bem feito** — o único atrito é achar a entrada (menu semitransparente).

**Recuperar a senha**
❌ **não existe caminho** na interface.

---

## 7. PROBLEMAS DE CARGA COGNITIVA

- **Ações escondidas:** perfil, dispositivos, automação e sair vivem atrás do
  nome do usuário, sem marca de menu, num painel semitransparente.
- **Termos técnicos:** `plano_cognitivo`, `confiança 0.35`, `via falha`,
  `model_not_found`, `console.anthropic.com` — todos visíveis ao operador.
- **Estados difíceis de interpretar:** um ponto verde sem legenda como único
  indicador global de saúde, e ele está errado.
- **Informação duplicada:** dois "Sair"; três telas falando de máquina
  (Dispositivos, Automação, assistente de pareamento).
- **Vazio informativo:** 75% da tela sem nada acionável, enquanto tudo que
  importa se espreme em 25%.

---

## 8. TOP 10 PROBLEMAS

1. **P0-02 — a IARA promete cinco capacidades e falha em três.** → Destrói a
   confiança de forma irreparável e viola o invariante do projeto. → **Máxima.**
   → Derivar a frase das capacidades que realmente rodam sem LLM.
2. **P0-01 — nenhum provedor de raciocínio responde.** → O produto não responde
   nada. → **Máxima.** → Corrigir `GROQ_MODELO` e tratar 404 de modelo como elo
   morto, descendo na cadeia.
3. **P0-03 — nenhuma máquina conectada.** → Nenhuma ação é executável. →
   **Máxima.** → Anunciar na tela inicial, antes da tentativa.
4. **P1-02 — indicador verde mentindo sobre conexão.** → Induz o operador a
   pedir o que não pode acontecer. → Alta. → Uma fonte única de verdade.
5. **P1-01 — JSON de API na cara do operador.** → Ruído e vazamento. → Alta. →
   Erro técnico só no jornal.
6. **P2-01 — automações não existem, e o nome está ocupado.** → A promessa
   central do produto não tem superfície. → Alta. → Renomear o programa.
7. **P1-04 — menu com "Dispositivos" ilegível.** → Esconde o caminho principal.
   → Alta. → Fundo opaco.
8. **P1-05 — 75% da tela em preto de forma intermitente.** → O produto parece
   quebrado ao abrir. → Alta. → Forçar quadro no mount/resize.
9. **P0-02/P4-01 — não há como descobrir o que a IARA faz.** → Usuário novo não
   embarca. → Alta. → Uma superfície de capacidades que não dependa da LLM.
10. **P2-07 — sem recuperação de senha.** → Trancamento permanente. → Média-alta.

---

## 9. PLANO DE ATAQUE

### FASE 1 — BLOQUEADORES
1. `GROQ_MODELO` para um modelo vivo; 404 de modelo = elo morto → desce na
   cadeia sem falar com o operador.
2. Sonda de arranque validando cada elo; `/saude` passa a distinguir
   *configurado* de *utilizável*.
3. A frase de degradação passa a ser gerada da lista real de capacidades sem
   LLM. **Se sobrar só clima e hora, ela diz duas.**
4. Indicador global de conexão ligado ao fato "sessão viva", não a "instalado".

### FASE 2 — EXPERIÊNCIA FUNDAMENTAL
5. Nenhum erro de fornecedor na superfície; uma frase estável por classe de
   falha.
6. Fundo opaco no menu de perfil.
7. Estado "sem mãos" anunciado na tela inicial, antes da tentativa.
8. Recuperação de senha no login.
9. Página 404 com identidade e caminho de volta.

### FASE 3 — INTELIGÊNCIA
10. Rotas determinísticas reais para histórico e infraestrutura, que não
    dependam do provedor.
11. Uma resposta para "o que você consegue fazer?" servida do catálogo de
    capacidades, sem LLM.
12. Reteste completo de memória e contexto — hoje impossível de medir.

### FASE 4 — ARQUITETURA DE UX
13. Renomear o programa executor; liberar a palavra "Automação".
14. Unificar as três telas de máquina em um só lugar.
15. Decidir o que ocupa os 75% centrais: ou vira superfície de trabalho, ou o
    chat cresce.
16. Um vocabulário só: escolher entre "dispositivo" e "computador" e usar em
    toda a interface, código e documentação.

### FASE 5 — POLIMENTO
17. Rótulos visíveis ou tooltips nos cinco ícones.
18. Marca de menu no nome do usuário.
19. Limpar o erro de login ao editar os campos.
20. "Sair" só no menu.
21. Ligar o botão "?".

---

## 10. REESTRUTURAÇÃO RECOMENDADA

A estrutura atual **está errada em um ponto e certa em outro**.

**Certa:** a decisão de que o nome da pessoa é a porta, e que máquina se resolve
em duas gavetas (quadro + programa). Isso está documentado no código com
justificativa e funciona.

**Errada:** a proporção. O produto dedica 75% da tela a uma entidade
contemplativa e 25% a tudo que é acionável — sem nenhuma superfície que
responda "o que eu posso fazer agora". Recomendo:

1. **Um centro de controle nos 75%** — capacidades disponíveis agora, máquinas
   e o que está impedido. Hoje o operador só descobre um impedimento
   fracassando. A entidade continua, menor, como estado — não como o objeto
   principal.
2. **Um vocabulário só**, aplicado em interface, código e documentação.
3. **Separar programa de rotina**: renomear o executor, e ou construir
   automações ou tirar a palavra do produto.
4. **Nada técnico na superfície do operador**; painel técnico atrás de um gesto
   deliberado e rotulado.

---

## 11. TESTES QUE FALHARAM

| Teste | Resultado | Evidência | Sev. |
|---|---|---|---|
| "O que você consegue fazer?" | erro de cota | transcript | P0 |
| "quantas cargas coletamos ontem?" | erro 404 Groq | transcript | P0 |
| "como está a infraestrutura?" | erro de cota | auditoria | P0 |
| "me mostre o histórico da conversa" | erro de cota | transcript | P0 |
| "busque o preço do diesel S10" | erro de cota | transcript | P0 |
| memória: "qual computador mencionei?" | erro de cota | transcript | — |
| Indicador de conexão | verde com 0 conectados | painel Automação | P1 |
| Menu de perfil legível | "Dispositivos" ilegível | zoom ×2 | P1 |
| Renderização da presença | preto em 3 cargas | 3 screenshots | P1 |
| Criar automação | funcionalidade inexistente | varredura da UI | P2 |
| Recuperar senha | caminho inexistente | tela de login | P2 |
| Rota inexistente | 404 cru em inglês | `/painel` | P2 |

## 12. TESTES QUE PASSARAM

| Teste | Resultado |
|---|---|
| Clima | ✅ Resposta rica **e epistemicamente honesta**: "É previsão de modelo numérico, não medição." Exemplar. |
| Hora | ✅ Correta, com dia da semana. |
| Pedido ambíguo "faz isso" | ✅ **O melhor momento do produto.** Pediu esclarecimento e referenciou corretamente os dois pedidos pendentes. Cognição real. |
| "abra o bloco de notas" | ✅ Recusa honesta, com causa e caminho: não inventou execução. |
| Erro de credencial | ✅ "E-mail ou senha não conferem." — não revela se o e-mail existe. |
| Validação de campo vazio | ✅ Validação nativa bloqueia o envio. |
| Jornada de pareamento | ✅ Três passos numerados, linguagem simples, QR + código, nome opcional com padrão sensato. |
| Painel de perfil | ✅ "A IARA não adivinha nada disto. O que estiver em branco aqui ela simplesmente não usa." Honestidade rara. |
| Persistência do histórico | ✅ Sobreviveu a múltiplos recarregamentos. |
| Layout estreito (≈767px) | ✅ Colapsa para o chat de forma limpa. |
| Rótulos acessíveis | ✅ Todos os 11 controles têm rótulo para leitor de tela. |
| Identidade visual | ✅ A entidade 3D, quando renderiza, é de qualidade acima da média. |

---

## 13. CONCLUSÃO

### A IARA está pronta para um usuário real?

**NÃO.**

Não por falta de acabamento — o acabamento é bom em vários pontos. Não está
pronta porque **não faz nada**. Das treze solicitações substantivas observadas,
três produziram resultado útil, e nenhuma delas tinha valor de negócio: clima,
hora e um pedido de esclarecimento.

### Qual é o maior problema atual?

**A IARA afirma capacidades que não tem.** Falhar por falta de crédito é
circunstancial e se resolve com um cartão. Dizer "continuo com histórico e
busca" e então recusar histórico e busca é um defeito de projeto, e é o que
converte "está fora do ar" em "não dá para confiar".

### Qual é o maior risco?

**A distância entre o que a IARA afirma de si e o que ela faz.** Não é um
componente — é o padrão. A mensagem de degradação promete cinco capacidades e
entrega duas. O `/saude` responde `ok: true` com a cadeia `groq → gemini →
anthropic` enquanto os três estão inutilizáveis. As âncoras não reconhecem as
frases que a própria interface anuncia.

Hoje o dano é contido porque nada executa. O risco aparece quando o raciocínio
voltar e as mãos forem reais: um sistema que já erra ao descrever as próprias
capacidades vai errar ao descrever as próprias **ações** — e aí a frase "pronto,
executei" tem o mesmo grau de confiabilidade que "continuo com histórico e
busca" tinha hoje.

*(A primeira versão deste relatório respondia "o ponto verde" aqui. Estava
errado — ver a correção em P3-08.)*

### Qual mudança mais melhoraria a experiência?

**Fazer a IARA dizer a verdade sobre si mesma, em tempo real.** Uma superfície
— nos 75% hoje vazios — que mostre o que ela consegue fazer *agora*, o que está
impedido e por quê. Isso resolve descoberta, resolve onboarding, resolve o
indicador que mente e resolve a mensagem de degradação, porque todos passam a
ler o mesmo fato.

### Qual é a prioridade absoluta para a próxima versão?

Nesta ordem, e nenhuma outra coisa antes:

1. **Um elo de raciocínio vivo** — corrigir `GROQ_MODELO` e fazer o failover
   funcionar de verdade.
2. **A frase de degradação derivada do que realmente funciona.**
3. **Um indicador de conexão que não minta.**

Os três somados são pequenos em código. Sem eles, nenhum trabalho de interface
tem efeito: o produto continua bonito e inútil.

---

*Auditoria conduzida pela interface de produção, em sessão autenticada.
Automações, execução em máquina e memória de longo prazo permanecem **não
verificadas** — bloqueadas pelos P0 acima, não por falta de tentativa.*

---

## 14. CORREÇÕES DA FASE 1 — aplicadas em 18/08/2026

### O que mudou

**1. A cadeia de raciocínio voltou a ter três cérebros** *(fecha P0-01, P1-01,
P1-03)*

`classificarFalhaProvedor` ganhou a classe `modelo_invalido`. O 404
`model_not_found` da Groq caía em `outra`, e `outra` não merece troca — de
propósito. Por isso a cadeia **desistia no primeiro elo** e despejava o JSON cru
na tela, com Gemini e Anthropic intactos logo atrás, nunca tentados. Carência de
60 min: nome de modelo está em configuração e não se conserta sozinho.

**2. A mensagem de degradação parou de mentir** *(fecha P0-02)*

Nova fonte única `CAPACIDADES_SEM_NUVEM` no `Planejador`, com um **exemplo de
frase por capacidade**. As duas cópias escritas à mão (`Kernel.ts`,
`DiagnosticoProvedores.ts`) agora leem dela. Rótulos passaram a dizer o que a
receita faz — "histórico de incidentes", não "histórico".

**3. A âncora de busca reconhece o verbo** *(fecha parte de P0-02)*

`busca na internet` exigia o substantivo exato. Agora `bus(?:c|qu)\w*` cobre a
conjugação — "busque", "busquei", "busquem" —, presa ao complemento ("na
internet/web", "no google") para não recriar o bug de palavra genérica que a
âncora `infraestrutura` já pagou com `frota`.

**4. `/saude` distingue configurado de utilizável** *(fecha P2-06 parcialmente,
e a contradição nº 1)*

Campo novo `raciocinio_falhas`, lido do registro que a cadeia já mantinha em
memória. **Não sonda e não vai à rede** — o endpoint continua sendo healthcheck
de host.

### Como foi verificado

| Prova | Resultado |
|---|---|
| Suíte completa (`npm run verificar`: GLSL + varredura de segredos + `tsc` + testes) | **1436/1436**, zero falhas |
| Teste-portão novo `capacidades-sem-nuvem.test.ts` | frase de gente → âncora → receita, para **cada** capacidade anunciada |
| Teste de integração da cadeia com o 404 literal da Groq | o segundo elo responde; `chamadas === 1` em ambos |
| **Mutação** da classificação (`modelo_invalido` → `outra`) | os dois testes **falham** — provam que detectam o defeito |
| `/saude` no motor local | `raciocinio_falhas` presente e servido |

### O que **não** foi verificado

- **Não houve prova de ponta a ponta na interface.** A tela exige login e esta
  auditoria não digita senha; a validação é de teste automatizado, não de uso.
- **Nada foi implantado.** As correções estão na árvore local. A produção em
  `iara.up.railway.app` continua com o defeito até um deploy.
- **`GROQ_MODELO` continua apontando para um modelo descomissionado.** A cadeia
  agora contorna o elo morto em vez de morrer com ele — mas o elo segue morto, e
  isso é configuração de ambiente (Railway), não código.

### Próximo passo imediato

Trocar `GROQ_MODELO` no ambiente de produção por um modelo vivo e implantar.
Sem isso, a Groq continua sendo um elo que a cadeia aprende a pular — melhor que
antes, mas ainda um terço do cérebro desligado.
