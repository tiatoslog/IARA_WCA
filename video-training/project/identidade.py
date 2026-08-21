"""
identidade.py — sistema visual do IARA LEARNING STUDIO.

A TESE, em uma frase: **o treinamento tem a forma daquilo que ele ensina.**

O procedimento é sobre manter um registro correto — uma planilha de linhas, cada
uma com um código, campos preenchidos e um estado. Então o sistema visual não é
feito de cartões: é feito de **entradas de registro**. Uma entrada é um marcador
no trilho, um filete, um campo de conteúdo e um estado. O mesmo objeto serve para
passo, exceção, erro, item de conferência e alternativa de prova.

Isso resolve, de uma vez, o que estava genérico na primeira versão: cartão
retangular repetido é o que qualquer gerador de slide produz; um registro
tipográfico com trilho de metadados é o que um sistema de informação produz.

TRÊS DECISÕES QUE CARREGAM A IDENTIDADE

1. **O trilho.** O conteúdo não começa na margem. Entre a margem e o texto há
   uma coluna de 168 px onde vivem código de seção, numeral e marcador. A
   assimetria é o que faz o quadro ler como página editorial e não como slide.

2. **Duas vozes tipográficas.** `Bahnschrift` — grotesca condensada, a letra de
   desenho técnico — para tudo que é código, numeral e rótulo: a VOZ DA MÁQUINA
   (`IT-ADMLUFT-001`, `REV.02`, `184957`, `PASSO 07`). `Segoe UI Light` para a
   instrução: a VOZ HUMANA. Não é decoração: quem fala muda, a letra muda.

3. **O degrau.** A marca é uma régua que desce um nível — dois segmentos
   horizontais unidos por um vertical. É a forma de um processo que avança e é
   a forma de uma rota origem→destino. A MESMA forma é o conector de todos os
   diagramas do treinamento. Logo e vocabulário de diagrama são o mesmo objeto.

REGRAS DE COR — medidas, não estimadas (WCAG 2.1)

  `TURQUESA` (#14A79C) é **marcador, régua e preenchimento. Nunca texto sobre
  claro** — dá 2,78:1. Texto sobre turquesa é `ABISSAL` (5,55:1), nunca branco
  (2,98:1). Para texto em tom de água sobre claro existe `TURQUESA_TEXTO`
  (4,65:1). Cor sem função semântica não entra.
"""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---------------------------------------------------------------------------
# QUADRO E GRADE
# ---------------------------------------------------------------------------

L, A, FPS = 1920, 1080, 30

MARGEM_E = 132
MARGEM_D = 132
TOPO = 116
BASE = 104

TRILHO = 168                       # coluna de metadados, à esquerda do conteúdo
CONT_X = MARGEM_E + TRILHO         # 300 — onde o conteúdo começa
CONT_L = L - MARGEM_D - CONT_X     # 1488
LINHA_BASE = 8                     # tudo é múltiplo disto

Y_CAB = 96                         # filete do cabeçalho
Y_ROD = A - BASE                   # filete do rodapé

# ---------------------------------------------------------------------------
# COR
# ---------------------------------------------------------------------------

ABISSAL = (4, 34, 42)              # estrutural: aberturas e seções
PETROLEO = (11, 61, 73)            # principal
TURQUESA = (20, 167, 156)          # destaque — marcador/régua/preenchimento
TURQUESA_TEXTO = (14, 125, 116)    # o mesmo tom, escurecido até passar em AA
TURQUESA_CLARO = (127, 208, 202)
AGUA = (232, 243, 241)             # fundo de apoio
PAPEL = (246, 247, 246)
BRANCO = (255, 255, 255)
GRAFITE = (20, 24, 27)
CINZA = (105, 115, 124)
FILETE = (206, 213, 214)

AMBAR = (138, 90, 0)               # atenção / prazo / exceção
CORAL = (168, 68, 44)              # erro / bloqueio
VERDE = (47, 107, 82)              # correto / concluído

AMBAR_AGUA = (245, 232, 206)
CORAL_AGUA = (245, 224, 216)
VERDE_AGUA = (216, 234, 226)

# Sobre fundo escuro
CLARO_1 = (232, 243, 241)
CLARO_2 = (146, 178, 184)
CLARO_3 = (96, 133, 141)

ESTADOS = {
    "observe":  (TURQUESA_TEXTO, AGUA, "OBSERVE"),
    "faca":     (PETROLEO, AGUA, "AGORA É SUA VEZ"),
    "confira":  (VERDE, VERDE_AGUA, "CONFIRA"),
    "atencao":  (AMBAR, AMBAR_AGUA, "ATENÇÃO"),
    "erro":     (CORAL, CORAL_AGUA, "ERRO COMUM"),
    "pratica":  (VERDE, VERDE_AGUA, "BOA PRÁTICA"),
    "lacuna":   (CINZA, PAPEL, "O POP NÃO DEFINE"),
    "area":     (TURQUESA_TEXTO, AGUA, "INFORMADO PELA ÁREA"),
    "neutro":   (PETROLEO, PAPEL, ""),
}

# ---------------------------------------------------------------------------
# TIPOGRAFIA — duas vozes
# ---------------------------------------------------------------------------

FONTES = Path("C:/Windows/Fonts")
_ARQ = {
    # voz humana — a instrução
    "light": "segoeuil.ttf",
    "semilight": "segoeuisl.ttf",
    "regular": "segoeui.ttf",
    "semibold": "seguisb.ttf",
    "bold": "segoeuib.ttf",
    "black": "seguibl.ttf",
    # voz da máquina — código, numeral, rótulo
    "tec": "bahnschrift.ttf",
}


@lru_cache(maxsize=512)
def fonte(peso: str, tamanho: int) -> ImageFont.FreeTypeFont:
    caminho = FONTES / _ARQ.get(peso, "segoeui.ttf")
    if caminho.exists():
        return ImageFont.truetype(str(caminho), tamanho)
    return ImageFont.load_default()


# Escala tipográfica. Cada degrau tem papel declarado — não há tamanho avulso.
ESCALA = {
    "monumento": ("light", 168, -4),     # abertura
    "numeral": ("tec", 300, 0),          # numeral de seção
    "titulo": ("semilight", 76, -1),     # título de cena
    "declaracao": ("light", 96, -2),     # frase única em tela
    "entrada": ("semilight", 44, 0),     # linha de registro
    "entrada_forte": ("semibold", 44, 0),
    "corpo": ("regular", 34, 0),
    "apoio": ("regular", 29, 0),
    "rotulo": ("tec", 25, 5),            # RÓTULO TÉCNICO, caixa alta
    "codigo": ("tec", 22, 3),            # metadado de cabeçalho/rodapé
    "numero_gr": ("tec", 132, 0),        # número grande de dado
    "legenda": ("semibold", 40, 0),
}


def _spec(nome: str):
    peso, tam, tr = ESCALA[nome]
    return fonte(peso, tam), tr


def texto(d: ImageDraw.ImageDraw, xy, txt: str, estilo: str, cor,
          ancora="la", tam=None, tracking=None, peso=None):
    """Desenha com um degrau da escala. `tam`/`peso` só para exceção declarada."""
    p, t, tr = ESCALA[estilo]
    f = fonte(peso or p, tam or t)
    tr = tracking if tracking is not None else tr
    if tr == 0:
        d.text(xy, txt, font=f, fill=cor, anchor=ancora)
        return
    larg = sum(d.textlength(c, font=f) + tr for c in txt) - tr
    x, y = xy
    if ancora[0] == "m":
        x -= larg / 2
    elif ancora[0] == "r":
        x -= larg
    for c in txt:
        d.text((x, y), c, font=f, fill=cor, anchor="l" + ancora[1])
        x += d.textlength(c, font=f) + tr


def largura(txt: str, estilo: str, tam=None, tracking=None, peso=None) -> float:
    p, t, tr = ESCALA[estilo]
    f = fonte(peso or p, tam or t)
    tr = tracking if tracking is not None else tr
    d = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    if tr == 0:
        return d.textlength(txt, font=f)
    return sum(d.textlength(c, font=f) + tr for c in txt) - tr


def quebrar(txt: str, estilo: str, larg_max: float, tam=None, peso=None) -> list[str]:
    palavras, linhas, atual = txt.split(), [], ""
    for p in palavras:
        teste = f"{atual} {p}".strip()
        if largura(teste, estilo, tam, peso=peso) <= larg_max:
            atual = teste
        else:
            if atual:
                linhas.append(atual)
            atual = p
    if atual:
        linhas.append(atual)
    return linhas


def altura_linha(estilo: str, tam=None) -> int:
    _, t, _ = ESCALA[estilo]
    return int((tam or t) * 1.32 // LINHA_BASE * LINHA_BASE)


# ---------------------------------------------------------------------------
# MOVIMENTO
# ---------------------------------------------------------------------------

def suavizar(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 4 * t ** 3 if t < 0.5 else 1 - pow(-2 * t + 2, 3) / 2


def sair(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - pow(1 - t, 3)


# ---------------------------------------------------------------------------
# A MARCA — o degrau
# ---------------------------------------------------------------------------

def degrau(d: ImageDraw.ImageDraw, x, y, larg, alt, cor=TURQUESA, esp=6,
           fracao=1.0):
    """A assinatura gráfica: uma régua que desce um nível.

    É a forma de um processo que avança e a de uma rota origem→destino. Aparece
    como marca, como ornamento de seção e como CONECTOR de todos os diagramas —
    logo e vocabulário de diagrama são o mesmo objeto, de propósito.

    `fracao` desenha só uma parte, para o traço se construir em cena.
    """
    a = larg * 0.42                      # primeiro horizontal
    b = alt                              # vertical
    c = larg * 0.58                      # segundo horizontal
    total = a + b + c
    p = max(0.0, min(1.0, fracao)) * total

    if p <= 0:
        return
    d.line([(x, y), (x + min(p, a), y)], fill=cor, width=esp)
    if p <= a:
        return
    p2 = min(p - a, b)
    d.line([(x + a - esp / 2, y), (x + a - esp / 2, y + p2)], fill=cor, width=esp)
    if p - a <= b:
        return
    p3 = min(p - a - b, c)
    d.line([(x + a - esp, y + b), (x + a - esp + p3, y + b)], fill=cor, width=esp)


def marca(d: ImageDraw.ImageDraw, x, y, escala=1.0, cor_texto=BRANCO,
          cor_degrau=TURQUESA, compacta=False):
    """Assinatura. `compacta` é a versão de cabeçalho; a outra é de abertura."""
    if compacta:
        degrau(d, x, y - 4, 30 * escala, 14 * escala, cor_degrau, esp=4)
        texto(d, (x + 44 * escala, y + 3), "IARA", "rotulo", cor_texto, "lm",
              tam=int(26 * escala), tracking=3, peso="semibold")
        texto(d, (x + 44 * escala + largura("IARA", "rotulo", int(26 * escala), 3,
                                            "semibold") + 14, y + 4),
              "LEARNING STUDIO", "codigo", cor_degrau, "lm",
              tam=int(19 * escala), tracking=4)
        return
    degrau(d, x, y, 96 * escala, 40 * escala, cor_degrau, esp=int(8 * escala))
    texto(d, (x, y + 96 * escala), "IARA", "monumento", cor_texto, "la",
          tam=int(168 * escala))
    texto(d, (x + 6, y + 96 * escala + 210 * escala), "LEARNING STUDIO",
          "rotulo", cor_degrau, "la", tam=int(30 * escala), tracking=13)


# ---------------------------------------------------------------------------
# CROMO ESTRUTURAL — filetes, não barras
# ---------------------------------------------------------------------------

def quadro(fundo=PAPEL) -> Image.Image:
    return Image.new("RGB", (L, A), fundo)


def cabecalho(im: Image.Image, secao: str = "", posicao: str = "", escuro=False):
    """Filete + metadados. Sem barra sólida: a barra pesada era metade do que
    fazia o quadro anterior ler como slide de apresentação."""
    d = ImageDraw.Draw(im)
    cor_t = CLARO_2 if escuro else CINZA
    cor_f = (18, 62, 74) if escuro else FILETE
    marca(d, MARGEM_E, Y_CAB - 44, 1.0,
          CLARO_1 if escuro else GRAFITE, TURQUESA, compacta=True)
    d.line([(MARGEM_E, Y_CAB), (L - MARGEM_D, Y_CAB)], fill=cor_f, width=1)
    dir_txt = "  ·  ".join(x for x in (secao, posicao) if x)
    if dir_txt:
        texto(d, (L - MARGEM_D, Y_CAB - 40), dir_txt.upper(), "codigo", cor_t, "ra")


def rodape(im: Image.Image, progresso: float, escuro=False):
    """Filete de rodapé com o avanço embutido NO PRÓPRIO filete.

    Uma barra de progresso separada era mais um objeto de dashboard. Aqui o
    filete que fecha a página é o mesmo que diz o quanto falta — o elemento
    tem duas funções e nenhuma delas é decorativa.
    """
    d = ImageDraw.Draw(im)
    cor_t = CLARO_3 if escuro else CINZA
    cor_f = (18, 62, 74) if escuro else FILETE
    x0, x1 = MARGEM_E, L - MARGEM_D
    d.line([(x0, Y_ROD), (x1, Y_ROD)], fill=cor_f, width=1)
    if progresso > 0:
        d.line([(x0, Y_ROD), (x0 + (x1 - x0) * min(progresso, 1.0), Y_ROD)],
               fill=TURQUESA, width=3)
    texto(d, (x0, Y_ROD + 26), "IT-ADMLUFT-001 / REV.02", "codigo", cor_t, "la")
    texto(d, (x1, Y_ROD + 26), f"{int(round(progresso * 100)):02d} %", "codigo",
          cor_t, "ra")


def marcador_trilho(d: ImageDraw.ImageDraw, y: float, rotulo: str = "",
                    cor=TURQUESA, escuro=False):
    """O objeto que abre uma entrada de registro: barra curta no trilho."""
    d.rectangle([MARGEM_E, y - 2, MARGEM_E + 34, y + 2], fill=cor)
    if rotulo:
        texto(d, (MARGEM_E, y + 22), rotulo, "codigo",
              CLARO_3 if escuro else CINZA, "la")


# ---------------------------------------------------------------------------
# A ENTRADA DE REGISTRO — o componente que substitui o cartão
# ---------------------------------------------------------------------------

def area_util() -> tuple[int, int]:
    """Faixa vertical entre o filete do cabeçalho e o do rodapé."""
    return Y_CAB + 76, Y_ROD - 56


def centrar(altura_bloco: float, deslocamento: float = -0.06) -> float:
    """y inicial para um bloco ficar no centro ÓPTICO da faixa útil.

    O centro óptico fica um pouco acima do geométrico: um bloco centrado na
    matemática parece caído. `deslocamento` é a fração de subida.
    """
    topo, base = area_util()
    return topo + ((base - topo) - altura_bloco) / 2 + (base - topo) * deslocamento


def entrada(im: Image.Image, y: float, codigo: str, conteudo: str,
            estado: str = "neutro", apoio: str = "", forte=False,
            marcada=None, apagada=False, larg_cont=None, x_fim=None) -> float:
    """Uma linha de registro. Devolve o y da próxima.

    Anatomia:  [código no trilho] │ [conteúdo] ........... [estado]
                                  └ filete horizontal

    Não há retângulo. O que organiza é o filete e o alinhamento — que é como
    uma planilha organiza, e é sobre planilha que este treinamento fala.
    """
    cor, _, _ = ESTADOS.get(estado, ESTADOS["neutro"])
    d = ImageDraw.Draw(im)
    xf = x_fim or (L - MARGEM_D)
    lc = larg_cont or (xf - CONT_X)
    tinta = CINZA if apagada else GRAFITE

    if codigo:
        texto(d, (MARGEM_E, y + 14), codigo, "codigo",
              cor if not apagada else FILETE, "la")
    # O quadrado só aparece quando há ESTADO de fato — conferido ou não
    # conferido. Numa sequência, o número já é o marcador; acrescentar um
    # quadrado ali seria enfeite com cara de bullet.
    if marcada is not None and estado in ("confira", "erro", "atencao", "pratica"):
        cx = MARGEM_E + 104
        if marcada:
            d.rectangle([cx, y + 12, cx + 24, y + 36], fill=cor)
        else:
            d.rectangle([cx, y + 12, cx + 24, y + 36], outline=FILETE, width=2)

    linhas = quebrar(conteudo, "entrada_forte" if forte else "entrada", lc)
    yy = y
    for ln in linhas:
        texto(d, (CONT_X, yy), ln, "entrada_forte" if forte else "entrada", tinta, "la")
        yy += altura_linha("entrada")
    if apoio:
        for ln in quebrar(apoio, "apoio", lc):
            texto(d, (CONT_X, yy + 4), ln, "apoio", CINZA, "la")
            yy += altura_linha("apoio")
    yy += 20
    d.line([(MARGEM_E, yy), (xf, yy)], fill=FILETE, width=1)
    return yy + 28


# ---------------------------------------------------------------------------
# COMPOSIÇÕES DE PÁGINA
# ---------------------------------------------------------------------------

def titulo_cena(im: Image.Image, txt: str, sobretitulo: str = "",
                y=None, escuro=False) -> float:
    d = ImageDraw.Draw(im)
    y = y if y is not None else TOPO + 64
    if sobretitulo:
        texto(d, (MARGEM_E, y), sobretitulo.upper(), "rotulo",
              TURQUESA if escuro else TURQUESA_TEXTO, "la")
        y += 52
    for ln in quebrar(txt, "titulo", L - MARGEM_E - MARGEM_D):
        texto(d, (MARGEM_E, y), ln, "titulo", CLARO_1 if escuro else GRAFITE, "la")
        y += altura_linha("titulo")
    return y + 40


def sombra(im: Image.Image, caixa, raio=20, alfa=30):
    x0, y0, x1, y1 = caixa
    camada = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    d.rectangle([x0 + 2, y0 + 8, x1 + 2, y1 + 10], fill=(6, 30, 36, alfa))
    camada = camada.filter(ImageFilter.GaussianBlur(raio))
    im.paste(Image.alpha_composite(im.convert("RGBA"), camada).convert("RGB"), (0, 0))


def veu(im: Image.Image, opacidade=0.62, excecao=None, regiao=None):
    camada = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    d.rectangle(regiao or (0, 0, im.width, im.height),
                fill=(4, 34, 42, int(255 * opacidade)))
    if excecao:
        d.rectangle(excecao, fill=(0, 0, 0, 0))
    im.paste(Image.alpha_composite(im.convert("RGBA"), camada).convert("RGB"), (0, 0))


def foco(d: ImageDraw.ImageDraw, caixa, cor=TURQUESA, esp=3):
    """Marca de foco em cantos, não moldura fechada — a moldura completa
    fecha a informação; os cantos apontam e deixam respirar."""
    x0, y0, x1, y1 = caixa
    b = min(46, (x1 - x0) / 2.4, (y1 - y0) / 2.4)
    for (cx, sx) in ((x0, 1), (x1, -1)):
        for (cy, sy) in ((y0, 1), (y1, -1)):
            d.line([(cx, cy), (cx + sx * b, cy)], fill=cor, width=esp)
            d.line([(cx, cy), (cx, cy + sy * b)], fill=cor, width=esp)


def cursor(im: Image.Image, x: float, y: float, clique=0.0):
    camada = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    if clique > 0:
        r = 42 * sair(clique)
        d.ellipse([x - r, y - r, x + r, y + r],
                  outline=(20, 167, 156, int(220 * (1 - clique))), width=4)
    e = 1.5
    seta = [(x, y), (x, y + 31 * e), (x + 8 * e, y + 24 * e), (x + 14 * e, y + 37 * e),
            (x + 20 * e, y + 34 * e), (x + 14 * e, y + 21 * e), (x + 24 * e, y + 20 * e)]
    d.polygon([(px + 2, py + 3) for px, py in seta], fill=(4, 34, 42, 120))
    d.polygon(seta, fill=(255, 255, 255, 255))
    d.line(seta + [seta[0]], fill=(4, 34, 42, 255), width=3, joint="curve")
    im.paste(Image.alpha_composite(im.convert("RGBA"), camada).convert("RGB"), (0, 0))


def captura(im: Image.Image, img: Image.Image, caixa):
    """A tela real, assentada sem moldura pesada: filete de 1 px e sombra rasa.
    A captura é evidência; não precisa de moldura para se anunciar."""
    x0, y0, x1, y1 = caixa
    sombra(im, (x0, y0, x1, y1), raio=22, alfa=26)
    d = ImageDraw.Draw(im)
    d.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], outline=FILETE, width=1)
    im.paste(img, (int(x0), int(y0)))


def barra_legenda(im: Image.Image, txt: str):
    if not txt:
        return
    d = ImageDraw.Draw(im)
    linhas = quebrar(txt, "legenda", L - 2 * MARGEM_E - 120)[:2]
    alt = len(linhas) * 52 + 28
    lg = max(largura(l, "legenda") for l in linhas) + 64
    x0, y0 = (L - lg) / 2, Y_ROD - alt - 34
    camada = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(camada).rectangle([x0, y0, x0 + lg, y0 + alt],
                                     fill=(4, 34, 42, 214))
    im.paste(Image.alpha_composite(im.convert("RGBA"), camada).convert("RGB"), (0, 0))
    d = ImageDraw.Draw(im)
    for i, ln in enumerate(linhas):
        texto(d, (L / 2, y0 + 14 + i * 52 + 26), ln, "legenda", BRANCO, "mm")
