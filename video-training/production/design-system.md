# design-system.md — IARA LEARNING STUDIO

Sistema visual proprietário para treinamento operacional. Não é um tema aplicado
a slides: é uma linguagem derivada do assunto, com regras que o código impõe.

Implementação: `project/identidade.py` (tokens e primitivas) e
`project/pintores.py` (composições). **Se este documento e o código divergirem,
o código está certo** — é ele que pinta o quadro.

---

## 1. A tese

> **O treinamento tem a forma daquilo que ele ensina.**

O procedimento é sobre manter um registro correto: uma planilha de linhas, cada
uma com um código, campos preenchidos e um estado. Então o sistema não é feito
de cartões — é feito de **entradas de registro**.

```
 [código]  │  [conteúdo do campo]                        [estado]
 ──────────┴────────────────────────────────────────────────────
```

Uma entrada serve para passo, exceção, erro, item de conferência e alternativa
de prova. O mesmo objeto, o tempo todo, porque é o mesmo objeto no trabalho real.

**Por que isso importa:** um retângulo com sombra e bullets é o que qualquer
gerador de apresentação produz. Uma tabela tipográfica com trilho de metadados
é o que um sistema de informação produz. A diferença não é decorativa — a
primeira versão deste treinamento era exatamente a primeira coisa.

---

## 2. As três decisões que carregam a identidade

### 2.1 O trilho

O conteúdo **não começa na margem**. Entre a margem esquerda e o texto há uma
coluna de **168 px** onde vivem código de seção, numeral, contador e marcador.

```
│←132→│←── 168 ──→│←──────────── 1488 ────────────→│←132→│
│     │  TRILHO   │           CAMPO                │     │
       ^ metadado   ^ o que se lê
```

Essa assimetria é o que faz o quadro ler como página editorial em vez de slide
centralizado. É também funcional: o olho aprende que o número está sempre no
mesmo lugar, e para de procurar.

### 2.2 Duas vozes tipográficas

| Voz | Fonte | O que fala |
|---|---|---|
| **Máquina** | **Bahnschrift** — grotesca condensada, a letra do desenho técnico | código, numeral, rótulo, contador: `IT-ADMLUFT-001`, `REV.02`, `184957`, `PASSO 07 / 16` |
| **Humana** | **Segoe UI**, do Light ao Black | a instrução, o título, a frase que explica |

Não é decoração: **quem fala muda, a letra muda.** O documento fala em código; a
instrutora fala em prosa. Bahnschrift também é subject-appropriate — é a
tipografia de sinalização industrial e desenho de engenharia, que é o mundo de
onde o procedimento vem.

> Inter é a fonte do produto IARA OS, mas não existe como arquivo nesta máquina
> (`environment.md`). Segoe UI tem **seis pesos** instalados — Light, Semilight,
> Regular, Semibold, Bold, Black — e é esse alcance que permite o contraste
> editorial entre um display Light de 168 px e um rótulo Bold de 25 px.

### 2.3 O degrau — a assinatura

```
   ──────────┐
             │
             └──────────
```

Uma régua que desce um nível. É a forma de **um processo que avança** e a de uma
**rota origem → destino**.

A mesma forma é: a marca, o ornamento de seção, o conector de todos os
diagramas e a abertura de cada saída de decisão. **Logo e vocabulário de
diagrama são o mesmo objeto** — é isso que faz o sistema parecer desenhado, e
não montado.

`ID.degrau(d, x, y, larg, alt, cor, esp, fracao)` — `fracao` desenha só uma
parte, para o traço se construir em cena.

---

## 3. Marca

```
   ▔▔▔┐
      └▁▁

   IARA
   L E A R N I N G   S T U D I O
```

- **Abertura:** degrau 96×40, `IARA` em Segoe UI Light 168, descritor em
  Bahnschrift 30 com entreletra +13.
- **Cabeçalho (compacta):** degrau 30×14, `IARA` Semibold 26, descritor
  Bahnschrift 19. Ocupa 340 px de largura.
- **Regra:** o descritor é **sempre turquesa**; `IARA` é sempre a cor de maior
  contraste do fundo. Nunca inverter.

A marca **se constrói** na abertura: o degrau desenha, o nome entra, a faixa de
metadados fecha. Três tempos, porque uma marca que aparece pronta é um logotipo
colado; uma que se desenha é um sistema se ligando.

---

## 4. Cor

Contraste **medido** (WCAG 2.1), nunca estimado.

### Estrutura

| Token | Hex | Papel | Contraste |
|---|---|---|---|
| `ABISSAL` | `#04222A` | aberturas, seções, encerramento | branco sobre ele: **16,57:1** |
| `PETROLEO` | `#0B3D49` | principal, texto de ênfase | **11,00:1** sobre papel |
| `TURQUESA` | `#14A79C` | **marcador, régua, preenchimento** | 5,55:1 sobre abissal |
| `TURQUESA_TEXTO` | `#0E7D74` | turquesa quando precisa ser texto | **4,65:1** sobre papel |
| `AGUA` | `#E8F3F1` | fundo de apoio | — |
| `PAPEL` | `#F6F7F6` | fundo principal | — |
| `GRAFITE` | `#14181B` | texto | **16,62:1** |
| `CINZA` | `#69737C` | informação secundária | **4,50:1** |
| `FILETE` | `#CED5D6` | divisórias | — |

### Estado — semântico, nunca decorativo

| Token | Hex | Significa | Contraste |
|---|---|---|---|
| `VERDE` | `#2F6B52` | correto · concluído · confira | **5,84:1** |
| `AMBAR` | `#8A5A00` | atenção · prazo · exceção | **5,52:1** |
| `CORAL` | `#A8442C` | erro · bloqueio · não faça | **5,54:1** |

### As três regras de cor

1. **`TURQUESA` nunca é texto sobre claro.** Dá 2,78:1. É marcador, régua e
   preenchimento. Para texto em tom de água existe `TURQUESA_TEXTO`.
2. **Texto sobre turquesa é `ABISSAL`** (5,55:1), **nunca branco** (2,98:1).
3. **Cor sem função semântica não entra.** Um elemento sem estado é cinza.

**Dupla codificação:** nenhuma informação depende só de cor. Todo estado carrega
rótulo textual em Bahnschrift (`ATENÇÃO`, `ERRO COMUM`, `CONFIRA`,
`O POP NÃO DEFINE`, `INFORMADO PELA ÁREA`) além do tom.

---

## 5. Escala tipográfica

Cada degrau tem papel declarado. **Não existe tamanho avulso** — se um tamanho
não está na escala, não pode ser usado.

| Degrau | Fonte / corpo | Entreletra | Onde |
|---|---|---|---|
| `monumento` | Light 168 | −4 | `IARA` na abertura |
| `numeral` | Bahnschrift 300 | 0 | numeral de seção, sangrando à direita |
| `declaracao` | Light 96 | −2 | a frase que para o olho |
| `titulo` | Semilight 76 | −1 | título de cena |
| `numero_gr` | Bahnschrift 132 | 0 | dado grande |
| `entrada` | Semilight 44 | 0 | linha de registro |
| `entrada_forte` | Semibold 44 | 0 | linha de registro em destaque |
| `legenda` | Semibold 40 | 0 | legenda queimada |
| `corpo` | Regular 34 | 0 | texto de apoio |
| `apoio` | Regular 29 | 0 | nota, observação |
| `rotulo` | Bahnschrift 25 | **+5** | RÓTULO TÉCNICO, caixa alta |
| `codigo` | Bahnschrift 22 | **+3** | metadado de cabeçalho e rodapé |

O contraste entre **Light 168** e **Bahnschrift 25 com entreletra +5** é o que
produz a sensação editorial. Um sistema com três tamanhos parecidos parece
tabela; um com salto de 7× parece revista.

---

## 6. Grade

```
1920 × 1080

margem esquerda   132        topo    116
margem direita    132        base    104
trilho            168        linha de base   8

filete de cabeçalho   y =   96
filete de rodapé      y =  976
campo                 x = 300 → 1788   (1488 de largura)
```

Tudo é múltiplo de 8. O centro **óptico** de um bloco fica 6 % acima do
geométrico (`ID.centrar`) — um bloco centrado na matemática parece caído.

### Cabeçalho e rodapé: filetes, não barras

A barra sólida da versão anterior era metade do que fazia o quadro ler como
apresentação. Aqui há um **filete de 1 px** e metadados em Bahnschrift.

**O rodapé acumula duas funções e nenhuma é decorativa:** o mesmo filete que
fecha a página carrega o avanço, em turquesa, com a porcentagem à direita. Uma
barra de progresso separada seria mais um objeto de dashboard.

---

## 7. Componentes

| # | Componente | Regra |
|---|---|---|
| 1 | **Entrada de registro** | código no trilho, filete embaixo, conteúdo no campo. Sem retângulo. |
| 2 | **Marcador de estado** | quadrado 24×24, preenchido quando conferido. **Só aparece quando há estado de fato** — numa sequência o número já é o marcador. |
| 3 | **Nota marginal** | filete vertical no trilho + rótulo técnico + texto no campo. Substitui a caixa colorida cheia. |
| 4 | **Nota de rodapé** | filete + rótulo + uma linha. Usada por `lacuna` e `procedencia`. |
| 5 | **Marcas de canto** | foco na captura por cantos, não moldura fechada — a moldura fecha a informação, os cantos apontam. |
| 6 | **Véu** | escurece só a captura, nunca o quadro: o título é a explicação do que olhar. |
| 7 | **Degrau** | conector universal de diagrama. |
| 8 | **Numeral de seção** | Bahnschrift 300 em `#0C343E`, sangrando pela margem direita. |

---

## 8. Arquétipos de página

Dezoito, e a regra que os justifica: **nenhum se repete mais de duas cenas
seguidas** (a prova é exceção declarada — cinco questões leem como seção).
`project/verificar.py` falha se a regra for violada.

`abertura` · `secao` · `declaracao` · `registro` · `nota` · `tela` · `fluxo` ·
`gatilho` · `decisao` · `linha_tempo` · `contraste` · `excecao` · `condicoes` ·
`conferencia` · `mapa` · `prova` · `lacunas` · `encerramento`

Um cartão configurável teria sido mais barato de escrever e teria produzido
exatamente o problema que este redesign veio resolver.

---

## 8-B. Ilustração — o campo de cor

Implementação: `project/ilustracoes.py`.

**Por que desenhadas, e não baixadas.** As referências de estilo trazidas para o
projeto são vetores licenciados de banco de imagens. Não entram: a regra do
repositório manda verificar uso comercial antes de qualquer asset novo, e este
é material comercial da casa. O que entra é o **princípio**, aplicado a formas
desenhadas em código — sem licença de terceiro, na paleta, e do domínio real.

### As cinco regras do flat aqui

1. **Só forma preenchida.** Sem gradiente, sem sombra, sem brilho, sem contorno
   duplo. Uma silhueta ou nada.
2. **Três cores por ilustração, no máximo**, todas da paleta. Profundidade vem
   de sobreposição e de valor — nunca de sombra.
3. **Campo de cor primeiro.** Cada ilustração se apoia num bloco que ocupa área
   generosa. É ele que tira a página do branco.
4. **Geometria, não desenho.** Retângulo, círculo, polígono. Se precisa de curva
   livre para funcionar, o conceito está errado.
5. **Assunto real.** Envelope, planilha, telefone, calendário, documento,
   caminhão, pasta, rota. O mundo do procedimento — **nunca** metáfora genérica
   de "equipe colaborando".

### O painel

Nas páginas de texto, os 752 px à direita viram um **painel de cor** com a
ilustração dentro, tingido pelo estado da cena (âmbar para atenção, coral para
erro, verde para conferência, água para o resto). O campo de texto encolhe para
956 px e para de se espalhar.

Isso responde ao que a primeira versão do redesign errou: **páginas corretas,
brancas e sem vida.** Quase metade do quadro passa a ser cor, e o objeto que
aparece nela é do próprio procedimento.

### Catálogo

`envelope` · `planilha` · `pastas` · `telefone` · `calendario` · `documento` ·
`caminhao` · `rota` · `cadeia` · `alerta` · `bloqueio` · `visto`

Coordenadas normalizadas `(0,0)-(1,1)`: a mesma ilustração serve a um selo de
180 px e a um painel de 520 px sem redesenho.

---

## 9. Movimento

O movimento **explica**; não existe animação sem função.

| Transição | Duração | O que ensina |
|---|---|---|
| Troca de plano | 450 ms | uma informação nova entrou |
| Entrada de seção | 700 ms | o assunto mudou |
| Construção do degrau | por plano | o processo avança |
| Revelação de entrada | por plano | o texto chega quando a voz chega |
| Avanço do rodapé | contínuo | quanto falta |

**Revelação progressiva é a regra, não o efeito.** Cada linha de uma lista entra
no plano em que a narração chega nela. Foi essa mudança que eliminou as quinze
telas paradas de 12 a 22 segundos da primeira montagem.

Nada acelera, nada gira, nada pulsa. O que se move é informação entrando.

---

## 10. Proibido

holograma · robô · circuito · cérebro digital · partícula · neon · glow ·
gradiente · interface futurista · avatar · sombra pesada · canto muito
arredondado · ícone dentro de círculo · três cartões iguais · seta entre caixas ·
imagem de banco · blob · texto centralizado sem motivo · animação decorativa ·
vermelho saturado · cor sem função.

> A tecnologia está no sistema. Não na estética.

---

## 11. Reuso em outros POPs

Nada aqui é específico do IT-ADMLUFT-001. Para produzir outro procedimento:

1. `arquivos/procedimentos/` recebe o `.pptx`;
2. `project/mascarar.py` ganha o manifesto das novas capturas;
3. `project/cenas.py` recebe as cenas, escolhendo entre os 18 arquétipos;
4. o resto — identidade, grade, tipografia, movimento, legendas, QA — não muda.

O sistema foi desenhado para a trilha inteira, não para um vídeo.
