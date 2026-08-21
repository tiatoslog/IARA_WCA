"""
pintores.py — as composições de página do IARA LEARNING STUDIO.

REGRA DE VARIEDADE, que este arquivo existe para cumprir: **nenhum arquétipo se
repete mais de duas vezes seguidas.** Uma sequência de páginas com a mesma
diagramação é o que faz um treinamento parecer apresentação, mesmo quando cada
página está bem resolvida isoladamente. Por isso há treze arquétipos, e não um
cartão configurável.

Os arquétipos, e o que cada um serve:

    abertura      identidade, uma vez
    secao         virada de etapa — numeral gigante, fundo abissal
    declaracao    UMA frase que precisa parar o olho
    registro      lista de entradas — substitui o cartão com bullets
    nota          atenção/erro/boa prática, como nota marginal, não caixa cheia
    tela          captura real com trilho de anotação
    fluxo         cadeia de processo, conectada por degraus
    decisao       bifurcação
    linha_tempo   prazo
    contraste     fluxo normal × exceção, divididos por filete
    conferencia   checklist como registro com estado
    mapa          síntese em grade tipográfica
    prova         questão
    lacunas       o que a norma não define
    encerramento  fecho

Um plano é um quadro estático composto; o movimento é a troca entre planos.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

import identidade as ID
import ilustracoes as IL

CAPTURAS = Path(__file__).resolve().parents[1] / "assets/screenshots"

# Ilustração padrão por estado, quando a cena não declara a sua.
ILUSTRA_ESTADO = {"atencao": "alerta", "erro": "bloqueio", "pratica": "visto",
                  "confira": "visto"}

CORES = {"turquesa": ID.TURQUESA, "verde": ID.VERDE, "coral": ID.CORAL,
         "ambar": ID.AMBAR, "petroleo": ID.PETROLEO}


def _abre(nome: str) -> Image.Image:
    return Image.open(CAPTURAS / nome).convert("RGB")


def _pagina(cena: dict, escuro=False) -> Image.Image:
    im = ID.quadro(ID.ABISSAL if escuro else ID.PAPEL)
    ID.cabecalho(im, cena.get("etapa", ""), cena.get("passo", ""), escuro=escuro)
    return im


# Largura do campo quando há painel ilustrado à direita.
PAINEL_X = 1168
CAMPO_ESTREITO = PAINEL_X - ID.MARGEM_E - 80

TOM_PAINEL = {
    "atencao": (245, 232, 206),
    "erro": (245, 224, 216),
    "pratica": (216, 234, 226),
    "confira": (216, 234, 226),
    "neutro": ID.AGUA,
    "observe": ID.AGUA,
    "faca": ID.AGUA,
    "lacuna": ID.AGUA,
    "area": ID.AGUA,
}


def _painel(im: Image.Image, ilustracao: str, estado="neutro"):
    """Painel de cor à direita, com a ilustração dentro.

    É o que responde à página branca e sem vida: em vez de texto flutuando
    sobre papel, quase metade do quadro passa a ser um campo de cor com um
    objeto do próprio procedimento dentro. O texto ganha um limite à direita e
    para de se espalhar.
    """
    d = ImageDraw.Draw(im)
    y0, y1 = ID.Y_CAB + 1, ID.Y_ROD - 1
    d.rectangle([PAINEL_X, y0, ID.L, y1], fill=TOM_PAINEL.get(estado, ID.AGUA))
    lado = min(520, y1 - y0 - 120)
    cx = PAINEL_X + (ID.L - PAINEL_X) / 2
    cy = (y0 + y1) / 2
    IL.desenhar(im, ilustracao,
                (cx - lado / 2, cy - lado / 2, cx + lado / 2, cy + lado / 2))


def _sobretitulo(d: ImageDraw.ImageDraw, y: float, txt: str, cor) -> float:
    """Rótulo ACIMA do título, no campo — nunca no trilho.

    O trilho tem 168 px e foi dimensionado para numerais. `ERRO COMUM` mede
    164, `INFORMADO PELA ÁREA` mede 295: postos ali, entravam por cima do
    filete e do texto. Sobrancelha acima da manchete também é a forma
    editorial correta — o rótulo qualifica o que vem depois.
    """
    ID.texto(d, (ID.MARGEM_E, y), txt.upper(), "rotulo", cor, "la")
    return y + 68


# ---------------------------------------------------------------------------
# IDENTIDADE
# ---------------------------------------------------------------------------

def abertura(cena):
    planos = []
    for k in (0, 1, 2):
        im = ID.quadro(ID.ABISSAL)
        d = ImageDraw.Draw(im)
        # A marca constrói-se: o degrau desenha, depois o nome, depois o registro.
        ID.degrau(d, ID.MARGEM_E, 286, 96, 40, ID.TURQUESA, 8,
                  fracao=1.0 if k >= 1 else 0.55)
        if k >= 1:
            ID.texto(d, (ID.MARGEM_E, 382), "IARA", "monumento", ID.CLARO_1, "la")
            ID.texto(d, (ID.MARGEM_E + 6, 592), "LEARNING STUDIO", "rotulo",
                     ID.TURQUESA, "la", tam=30, tracking=13)
        if k >= 2:
            d.line([(ID.MARGEM_E, 720), (ID.L - ID.MARGEM_D, 720)],
                   fill=(18, 62, 74), width=1)
            meta = [("PROCEDIMENTO", "IT-ADMLUFT-001"),
                    ("TÍTULO", "AGENDAMENTO DE COLETA"),
                    ("REVISÃO", "REV.02"),
                    ("APROVAÇÃO", "SR. JOAQUIM")]
            x = ID.MARGEM_E
            for rot, val in meta:
                ID.texto(d, (x, 760), rot, "codigo", ID.CLARO_3, "la")
                ID.texto(d, (x, 796), val, "rotulo", ID.CLARO_1, "la",
                         tam=28, tracking=2)
                x += max(ID.largura(val, "rotulo", 28, 2),
                         ID.largura(rot, "codigo")) + 92
        planos.append((im, 0.8 if k < 2 else 2.0))
    return planos


def secao(cena):
    planos = []
    for k in (0, 1):
        im = _pagina(cena, escuro=True)
        d = ImageDraw.Draw(im)
        ID.texto(d, (ID.L - ID.MARGEM_D + 30, 268), cena["numero"].zfill(2),
                 "numeral", (12, 52, 62), "ra")
        rot = cena.get("rotulo_etapa") or f"ETAPA {cena['numero'].zfill(2)}"
        ID.texto(d, (ID.MARGEM_E, 430), rot, "rotulo", ID.TURQUESA, "la")
        y = 492
        for ln in ID.quebrar(cena["titulo"].capitalize(), "declaracao", 1180):
            ID.texto(d, (ID.MARGEM_E, y), ln, "declaracao", ID.CLARO_1, "la")
            y += 124
        if k >= 1:
            ID.degrau(d, ID.MARGEM_E, y + 46, 260, 58, ID.TURQUESA, 5)
        planos.append((im, 0.7 if k == 0 else 1.6))
    return planos


def encerramento(cena):
    planos = []
    for k in (0, 1, 2):
        im = ID.quadro(ID.ABISSAL)
        d = ImageDraw.Draw(im)
        ID.marca(d, ID.MARGEM_E, ID.Y_CAB - 44, 1.0, ID.CLARO_1, ID.TURQUESA,
                 compacta=True)
        d.line([(ID.MARGEM_E, ID.Y_CAB), (ID.L - ID.MARGEM_D, ID.Y_CAB)],
               fill=(18, 62, 74), width=1)
        ID.texto(d, (ID.MARGEM_E, 330), "CONCLUÍDO", "rotulo", ID.TURQUESA, "la")
        ID.texto(d, (ID.MARGEM_E, 392), "Agendamento de coleta.", "declaracao",
                 ID.CLARO_1, "la")
        if k >= 1:
            d.line([(ID.MARGEM_E, 580), (ID.L - ID.MARGEM_D, 580)],
                   fill=(18, 62, 74), width=1)
            ID.texto(d, (ID.MARGEM_E, 616), "PRÓXIMO NA TRILHA", "codigo",
                     ID.CLARO_3, "la")
            ID.texto(d, (ID.MARGEM_E, 656), "IT-ADMLUFT-002", "rotulo",
                     ID.TURQUESA, "la", tam=44, tracking=2)
            ID.texto(d, (ID.MARGEM_E, 722), "Emissão de Ordem de Coleta",
                     "corpo", ID.CLARO_2, "la")
        if k >= 2:
            ID.texto(d, (ID.L - ID.MARGEM_D, 616), "APROVAÇÃO", "codigo",
                     ID.CLARO_3, "ra")
            ID.texto(d, (ID.L - ID.MARGEM_D, 656), "SR. JOAQUIM", "rotulo",
                     ID.CLARO_1, "ra", tam=44, tracking=2)
            ID.texto(d, (ID.L - ID.MARGEM_D, 726),
                     "Data de vigência não declarada no documento", "apoio",
                     ID.CLARO_3, "ra")
        planos.append((im, 1.0 if k < 2 else 1.4))
    return planos


# ---------------------------------------------------------------------------
# TIPOGRÁFICOS
# ---------------------------------------------------------------------------

def declaracao(cena):
    """Uma frase que precisa parar o olho. Nada mais na página."""
    frase = cena["frase"]
    apoio = cena.get("apoio", "")
    cor = CORES.get(cena.get("cor", "turquesa"), ID.TURQUESA)
    ilu = cena.get("ilustracao")
    larg = (CAMPO_ESTREITO if ilu else ID.L - ID.MARGEM_E - ID.MARGEM_D - 60)
    linhas = ID.quebrar(frase, "declaracao", larg)
    planos = []
    for k in (0, 1):
        im = _pagina(cena)
        if ilu:
            _painel(im, ilu, cena.get("tom", "neutro"))
        d = ImageDraw.Draw(im)
        alt = 62 + len(linhas) * 124 + 130
        y = ID.centrar(alt)
        ID.texto(d, (ID.MARGEM_E, y), cena.get("rotulo", "").upper(), "rotulo",
                 cor if cena.get("cor") else ID.TURQUESA_TEXTO, "la")
        y += 62
        for ln in linhas:
            ID.texto(d, (ID.MARGEM_E, y), ln, "declaracao", ID.GRAFITE, "la")
            y += 124
        if k >= 1:
            ID.degrau(d, ID.MARGEM_E, y + 22, 280, 56, cor, 5)
            if apoio:
                ID.texto(d, (ID.MARGEM_E, y + 128), apoio, "corpo", ID.CINZA, "la")
        planos.append((im, 0.9 if k == 0 else 1.7))
    return planos


def registro(cena):
    """Lista de entradas. O que antes era um cartão com bullets."""
    itens = cena["itens"]
    ilu = cena.get("ilustracao")
    xf = (PAINEL_X - 80) if ilu else None
    planos = []
    for k in range(len(itens) + 1):
        im = _pagina(cena)
        if ilu:
            _painel(im, ilu, cena.get("tom", "neutro"))
        y = ID.titulo_cena(im, cena["titulo"], cena.get("sobretitulo", ""))
        for i, it in enumerate(itens):
            cod = it.get("codigo") or f"{i + 1:02d}"
            y = ID.entrada(im, y, cod, it["texto"],
                           estado=it.get("estado", "neutro"),
                           apoio=it.get("apoio", ""),
                           apagada=i >= k, x_fim=xf)
        _procedencia(im, cena)
        planos.append((im, 0.5 if k == 0 else (1.0 if k < len(itens) else 1.5)))
    return planos


def _nota_rodape(im: Image.Image, txt: str, estado="lacuna"):
    """Nota marginal, presa ao rodapé. Filete + rótulo + texto, sem caixa.

    Rótulo ACIMA do texto, não ao lado. `O POP NÃO DEFINE` mede ~210 px em
    Bahnschrift 22 com entreletra +3, e o trilho tem 168 — no primeiro render
    o rótulo entrava por baixo da frase em todas as cenas com lacuna. Empilhar
    é o que cabe, e de quebra dá à nota a forma de verbete.
    """
    cor, _, rot = ID.ESTADOS[estado]
    d = ImageDraw.Draw(im)
    y = ID.Y_ROD - 122
    d.line([(ID.MARGEM_E, y), (ID.L - ID.MARGEM_D, y)], fill=ID.FILETE, width=1)
    ID.texto(d, (ID.MARGEM_E, y + 18), rot, "codigo", cor, "la")
    for i, ln in enumerate(ID.quebrar(txt, "apoio", ID.L - ID.MARGEM_E - ID.MARGEM_D)[:2]):
        ID.texto(d, (ID.MARGEM_E, y + 54 + i * 38), ln, "apoio", ID.CINZA, "la")


def _procedencia(im: Image.Image, cena: dict):
    """Uma nota de rodapé por cena, e a procedência tem prioridade sobre a lacuna.

    São coisas diferentes e não podem sair com a mesma cara: `lacuna` diz que a
    norma não define; `procedencia` diz que a resposta existe, veio da área e
    ainda não está no documento. Misturar as duas é como conteúdo não aprovado
    entra num POP parecendo texto normativo.
    """
    if cena.get("procedencia"):
        _nota_rodape(im, cena["procedencia"], "area")
    elif cena.get("lacuna"):
        _nota_rodape(im, cena["lacuna"], "lacuna")


def nota(cena):
    """ATENÇÃO / ERRO COMUM / BOA PRÁTICA.

    Nota marginal: rótulo no trilho, filete grosso à esquerda, texto no campo.
    A caixa colorida cheia da versão anterior gritava mais que o conteúdo e
    virava o tipo de bloco que qualquer template produz.
    """
    estado = cena["estado"]
    cor, _, rot = ID.ESTADOS[estado]
    linhas = cena.get("linhas", [])
    ilu = cena.get("ilustracao") or ILUSTRA_ESTADO.get(estado, "visto")
    planos = []
    for k in range(len(linhas) + 1):
        im = _pagina(cena)
        _painel(im, ilu, estado)
        d = ImageDraw.Draw(im)

        tit_l = ID.quebrar(cena["titulo"], "titulo", CAMPO_ESTREITO)
        corpo_l = [l for ln in linhas for l in ID.quebrar(ln, "corpo", CAMPO_ESTREITO)]
        alt = 68 + len(tit_l) * ID.altura_linha("titulo") + 22 + len(corpo_l) * 52
        y = ID.centrar(alt)

        y = _sobretitulo(d, y, rot, cor)
        # Filete curto SOB a sobrancelha — a 24 px do retorno, que cai abaixo
        # das descidas do rótulo. Antes ficava a 34 e cortava "ATENÇÃO" ao meio.
        d.rectangle([ID.MARGEM_E, y - 24, ID.MARGEM_E + 86, y - 20], fill=cor)
        for ln in tit_l:
            ID.texto(d, (ID.MARGEM_E, y), ln, "titulo", ID.GRAFITE, "la")
            y += ID.altura_linha("titulo")
        y += 22
        mostradas = 0
        for ln in linhas[:k]:
            for sub in ID.quebrar(ln, "corpo", CAMPO_ESTREITO):
                ID.texto(d, (ID.MARGEM_E, y), sub, "corpo", ID.CINZA, "la")
                y += 52
                mostradas += 1
        _procedencia(im, cena)
        planos.append((im, 0.9 if k == 0 else (1.0 if k < len(linhas) else 1.5)))
    return planos


def lacunas(cena):
    itens = cena["itens"]
    planos = []
    for k in range(1, len(itens) + 2):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, "O que este documento não define",
                           "limites da norma")
        for i, it in enumerate(itens):
            y = ID.entrada(im, y, "—", it, estado="lacuna", apagada=i >= k)
        if k > len(itens):
            ID.texto(d, (ID.MARGEM_E, y + 34), "NA DÚVIDA", "codigo", ID.AMBAR, "la")
            ID.texto(d, (ID.CONT_X, y + 24), "Pergunte ao responsável pela conta.",
                     "entrada_forte", ID.AMBAR, "la")
        planos.append((im, 1.0 if k <= len(itens) else 2.0))
    return planos


# ---------------------------------------------------------------------------
# DIAGRAMÁTICOS — o degrau é o conector de todos
# ---------------------------------------------------------------------------

def fluxo(cena):
    """Cadeia de processo. Os elos ficam em degraus descendentes, não em
    caixas com setas — a mesma forma da marca."""
    blocos = cena["blocos"]
    n = len(blocos)
    planos = []
    for k in range(1, n + 1):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y0 = ID.titulo_cena(im, cena["titulo"], cena.get("sobretitulo", "")) + 28
        passo_x = (ID.L - ID.MARGEM_E - ID.MARGEM_D - 380) / max(n - 1, 1)
        passo_y = 126
        # O conector corre SEMPRE 106 px abaixo do topo do nó — assim ele
        # sublinha o elo e desce para o próximo sem cruzar palavra nenhuma.
        # Na primeira montagem ele saía da altura do texto e riscava o nome.
        DESVIO = 148
        for i, b in enumerate(blocos):
            x = ID.MARGEM_E + i * passo_x
            y = y0 + i * passo_y
            aceso = i < k
            primeiro = i == 0
            cor = ID.TURQUESA if primeiro else (ID.PETROLEO if aceso else ID.FILETE)
            tinta = ID.GRAFITE if aceso else ID.FILETE
            if i < n - 1 and i + 1 < k:
                ID.degrau(d, x, y + DESVIO, passo_x, passo_y,
                          ID.TURQUESA if primeiro else (206, 213, 214), 3)
            ID.texto(d, (x, y), f"{i + 1:02d}", "rotulo",
                     cor if aceso else ID.FILETE, "la", tam=26)
            ID.texto(d, (x, y + 34), b, "entrada_forte", tinta, "la",
                     tam=58 if primeiro else 50)
            if primeiro and aceso:
                # O rótulo vai AO LADO do número, na mesma linha: abaixo do
                # nome ele caía sobre o conector, e sobre o nome ele o riscava.
                ID.texto(d, (x + 58, y + 2), "VOCÊ ESTÁ AQUI", "codigo",
                         ID.TURQUESA_TEXTO, "la")
                d.rectangle([x, y + DESVIO - 30, x + 96, y + DESVIO - 26],
                            fill=ID.TURQUESA)
        if cena.get("nota"):
            _nota_rodape(im, cena["nota"], "neutro")
        planos.append((im, 1.0 if k < n else 1.8))
    return planos


def gatilho(cena):
    planos = []
    for k in (0, 1, 2):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        alt = 420
        y = ID.centrar(alt)
        ID.texto(d, (ID.MARGEM_E, y), "GATILHO", "rotulo", ID.TURQUESA_TEXTO, "la")
        ID.texto(d, (ID.MARGEM_E, y + 58), "A numeração libera o agendamento.",
                 "declaracao", ID.GRAFITE, "la", tam=76)
        yb = y + 200
        d.line([(ID.MARGEM_E, yb), (ID.L - ID.MARGEM_D, yb)], fill=ID.FILETE, width=1)
        ID.texto(d, (ID.MARGEM_E, yb + 26), "RECEBIDO", "codigo", ID.CINZA, "la")
        ID.texto(d, (ID.MARGEM_E, yb + 60), "OCI 184957", "numero_gr", ID.GRAFITE,
                 "la", tam=96)
        if k >= 1:
            ID.degrau(d, ID.MARGEM_E + 640, yb + 74, 220, 56, ID.TURQUESA, 5)
        if k >= 2:
            ID.texto(d, (ID.MARGEM_E + 940, yb + 26), "LIBERADO", "codigo",
                     ID.VERDE, "la")
            ID.texto(d, (ID.MARGEM_E + 940, yb + 60), "Pode agendar",
                     "declaracao", ID.VERDE, "la", tam=76)
        planos.append((im, 0.9 if k < 2 else 1.7))
    return planos


def decisao(cena):
    planos = []
    for k in (0, 1, 2):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, cena["pergunta"], "decisão")
        y += 30
        for i, (rot, txt, cor) in enumerate(
                [("SIM", cena["sim"], ID.VERDE), ("NÃO", cena["nao"], ID.AMBAR)]):
            if i >= k:
                continue
            yy = y + i * 150
            ID.degrau(d, ID.MARGEM_E, yy, 150, 44, cor, 4)
            ID.texto(d, (ID.MARGEM_E + 190, yy - 22), rot, "rotulo", cor, "la",
                     tam=30, tracking=6)
            ID.texto(d, (ID.MARGEM_E + 190, yy + 20), txt, "entrada", ID.GRAFITE, "la")
        planos.append((im, 0.8 if k < 2 else 1.8))
    return planos


def linha_tempo(cena):
    marcos = cena["marcos"]
    cadeia = cena.get("cadeia", [])
    planos = []
    for k in range(1, len(marcos) + len(cadeia) + 1):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, cena["titulo"], cena.get("sobretitulo", ""))
        ty = y + 96
        x0, x1 = ID.MARGEM_E, ID.L - ID.MARGEM_D
        d.line([(x0, ty), (x1, ty)], fill=ID.FILETE, width=1)
        n = len(marcos)
        for i, (rot, txt, forte) in enumerate(marcos):
            mx = x0 + (x1 - x0) * i / (n - 1)
            visivel = i < k
            cor = (ID.AMBAR if forte else ID.PETROLEO) if visivel else ID.FILETE
            if visivel and i > 0:
                d.line([(x0 + (x1 - x0) * (i - 1) / (n - 1), ty), (mx, ty)],
                       fill=ID.AMBAR if forte else ID.FILETE, width=3)
            d.rectangle([mx - (5 if forte else 3), ty - (14 if forte else 9),
                         mx + (5 if forte else 3), ty + (14 if forte else 9)],
                        fill=cor)
            anc = "la" if i == 0 else ("ra" if i == n - 1 else "ma")
            ax = mx + (0 if i not in (0, n - 1) else (0 if i == 0 else 0))
            ID.texto(d, (ax, ty - 76), rot, "rotulo", cor, "la" if i == 0 else anc,
                     tam=30 if forte else 25)
            ID.texto(d, (ax, ty + 34), txt, "apoio", ID.CINZA if visivel else ID.FILETE,
                     "la" if i == 0 else anc)
        if cadeia:
            cy = ty + 190
            d.line([(x0, cy), (x1, cy)], fill=ID.FILETE, width=1)
            ID.texto(d, (x0, cy + 22), "PERCURSO DO DOCUMENTO", "codigo",
                     ID.CINZA, "la")
            mostrados = max(0, k - len(marcos))
            for i, p in enumerate(cadeia[:mostrados]):
                px = x0 + i * ((x1 - x0) / len(cadeia))
                ID.texto(d, (px, cy + 62), f"{i + 1:02d}", "codigo",
                         ID.TURQUESA_TEXTO, "la")
                ID.texto(d, (px, cy + 96), p, "entrada", ID.GRAFITE, "la", tam=38)
        _procedencia(im, cena)
        ult = k == len(marcos) + len(cadeia)
        planos.append((im, 1.0 if not ult else 1.7))
    return planos


def contraste(cena):
    """Fluxo normal × exceção. Divididos por filete vertical, sem caixas."""
    normal, exc = cena["normal"], cena["excecao"]
    planos = []
    for k in range(len(exc) + 1):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, cena["titulo"], cena.get("sobretitulo", "exceção declarada"))
        meio = ID.L / 2 + 40
        d.line([(meio, y + 4), (meio, ID.Y_ROD - 130)], fill=ID.FILETE, width=1)
        r_esq, r_dir = cena.get("rotulos", ("FLUXO NORMAL", "EXCEÇÃO"))
        for lado, (rot, seq, cor) in enumerate(
                [(r_esq, normal, ID.PETROLEO), (r_dir, exc, ID.AMBAR)]):
            cx = ID.MARGEM_E if lado == 0 else meio + 72
            ID.texto(d, (cx, y + 20), rot, "rotulo", cor, "la")
            vis = len(seq) if lado == 0 else k
            for i, b in enumerate(seq):
                yy = y + 92 + i * 104
                on = i < vis
                ID.texto(d, (cx, yy), f"{i + 1:02d}", "codigo",
                         cor if on else ID.FILETE, "la")
                ID.texto(d, (cx + 62, yy - 12), b, "entrada",
                         ID.GRAFITE if on else ID.FILETE, "la")
                if i < len(seq) - 1 and on:
                    d.line([(cx + 8, yy + 40), (cx + 8, yy + 78)],
                           fill=cor if on else ID.FILETE, width=2)
        _procedencia(im, cena)
        planos.append((im, 1.1 if k < len(exc) else 1.8))
    return planos


def excecao(cena):
    itens = [(t, False) for t in cena["nao"]] + [(t, True) for t in cena["sim"]]
    planos = []
    for k in range(1, len(itens) + 2):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, cena["titulo"], "exceção declarada")
        for i, (t, positivo) in enumerate(itens):
            cod = "FAZ" if positivo else "NÃO"
            y = ID.entrada(im, y, cod, t,
                           estado="pratica" if positivo else "erro",
                           apagada=i >= k)
        if k > len(itens):
            ID.texto(d, (ID.CONT_X, y + 8), cena["motivo"], "corpo", ID.CINZA, "la")
        _procedencia(im, cena)
        planos.append((im, 1.0 if k <= len(itens) else 1.6))
    return planos


def condicoes(cena):
    """Sempre / condicional / exceção — três regras com peso diferente."""
    regras = cena["regras"]
    planos = []
    for k in range(1, len(regras) + 1):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, cena["titulo"], "o que sai com o agendamento")
        # Rótulo ACIMA da frase, não ao lado: `SE INTERESTADUAL OU MT` mede
        # 330 px e entrava por cima de "CTE e MDFe" quando os dois dividiam a
        # mesma linha a partir de x=132 e x=300.
        for i, (quando, oque, cor_nome) in enumerate(regras):
            if i >= k:
                continue
            cor = CORES[cor_nome]
            yy = y + i * 166
            ID.texto(d, (ID.MARGEM_E, yy), quando, "rotulo", cor, "la")
            d.rectangle([ID.MARGEM_E, yy + 40, ID.MARGEM_E + 86, yy + 44], fill=cor)
            ID.texto(d, (ID.MARGEM_E, yy + 62), oque, "declaracao", ID.GRAFITE, "la",
                     tam=62)
        planos.append((im, 1.0 if k < len(regras) else 1.7))
    return planos


def conferencia(cena):
    itens = cena["itens"]
    ilu = cena.get("ilustracao")
    xf = (PAINEL_X - 80) if ilu else None
    planos = []
    for k in range(len(itens) + 1):
        im = _pagina(cena)
        if ilu:
            _painel(im, ilu, "confira")
        y = ID.titulo_cena(im, cena["titulo"], cena.get("sobretitulo", "conferência"))
        for i, it in enumerate(itens):
            # Usar o y DEVOLVIDO, não um avanço fixo. Item que quebra em duas
            # linhas — e com o painel ilustrado a coluna estreitou, então vários
            # quebram — passava por cima do seguinte.
            y = ID.entrada(im, y, f"{i + 1:02d}", it, estado="confira",
                           marcada=i < k, apagada=i >= k, x_fim=xf)
        planos.append((im, 0.6 if k == 0 else (1.0 if k < len(itens) else 1.8)))
    return planos


def mapa(cena):
    """Síntese: grade tipográfica de 6, sem caixas."""
    passos = cena["passos"]
    planos = []
    for k in range(1, len(passos) + 2):
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        y = ID.titulo_cena(im, "O caminho inteiro", "síntese")
        cols, larg = 3, (ID.L - ID.MARGEM_E - ID.MARGEM_D) / 3
        for i, p in enumerate(passos):
            if i >= k:
                continue
            cx = ID.MARGEM_E + (i % cols) * larg
            cy = y + (i // cols) * 190
            d.line([(cx, cy), (cx + larg - 56, cy)], fill=ID.FILETE, width=1)
            ID.texto(d, (cx, cy + 22), f"{i + 1:02d}", "codigo", ID.TURQUESA_TEXTO, "la")
            ID.texto(d, (cx, cy + 58), p, "entrada_forte", ID.GRAFITE, "la", tam=42)
        if k > len(passos):
            yy = y + 2 * 190 + 40
            d.line([(ID.MARGEM_E, yy), (ID.L - ID.MARGEM_D, yy)], fill=ID.AMBAR, width=2)
            ID.texto(d, (ID.MARGEM_E, yy + 22), "EXCEÇÕES", "codigo", ID.AMBAR, "la")
            ID.texto(d, (ID.CONT_X, yy + 18),
                     "motorista esporádico  ·  Adicer  ·  Sorriso", "corpo",
                     ID.GRAFITE, "la")
        planos.append((im, 0.9 if k <= len(passos) else 1.6))
    return planos


# ---------------------------------------------------------------------------
# CAPTURA REAL
# ---------------------------------------------------------------------------

def tela(cena):
    """A captura, com zoom pelo foco e trilho de anotação à esquerda."""
    img = _abre(cena["arquivo"])
    cor = CORES.get(cena.get("cor_foco", "turquesa"), ID.TURQUESA)
    planos = []

    bx0, by0 = ID.MARGEM_E, ID.Y_CAB + 252
    bx1, by1 = ID.L - ID.MARGEM_D, ID.Y_ROD - (250 if (cena.get("lacuna") or cena.get("procedencia")) else 170)
    bw, bh = bx1 - bx0, by1 - by0

    for i, f in enumerate(cena["focos"]):
        fx0, fx1, fy0, fy1, rotulo = f
        fy1 = img.height if fy1 is None else fy1
        fw, fh = max(fx1 - fx0, 1), max(fy1 - fy0, 1)

        esc_cabe = min(bw / img.width, bh / img.height)
        esc = max(esc_cabe, min(2.4, bh * 0.46 / fh, bw * 0.58 / fw))
        grande = img.resize((int(img.width * esc), int(img.height * esc)),
                            Image.LANCZOS)
        jl, ja = min(bw, grande.width), min(bh, grande.height)
        cx = max(0, min((fx0 + fx1) / 2 * esc - jl / 2, grande.width - jl))
        cy = max(0, min((fy0 + fy1) / 2 * esc - ja / 2, grande.height - ja))
        recorte = grande.crop((int(cx), int(cy), int(cx) + int(jl), int(cy) + int(ja)))

        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        # Título e passo no trilho, captura no campo — a mesma anatomia da entrada.
        ID.texto(d, (ID.MARGEM_E, ID.Y_CAB + 60), cena.get("sobretitulo", "tela real").upper(),
                 "rotulo", ID.TURQUESA_TEXTO, "la")
        for j, ln in enumerate(ID.quebrar(cena["titulo"], "titulo", ID.CONT_L)):
            ID.texto(d, (ID.MARGEM_E, ID.Y_CAB + 108 + j * 84), ln, "titulo",
                     ID.GRAFITE, "la")

        px = bx0 + (bw - recorte.width) // 2
        py = by0 + (bh - recorte.height) // 2
        ID.captura(im, recorte, (px, py, px + recorte.width, py + recorte.height))
        d = ImageDraw.Draw(im)

        jx0 = max(px, px + fx0 * esc - cx)
        jx1 = min(px + recorte.width, px + fx1 * esc - cx)
        jy0 = max(py, py + fy0 * esc - cy)
        jy1 = min(py + recorte.height, py + fy1 * esc - cy)
        ID.veu(im, 0.62, excecao=(jx0 - 4, jy0 - 4, jx1 + 4, jy1 + 4),
               regiao=(px, py, px + recorte.width, py + recorte.height))
        d = ImageDraw.Draw(im)
        ID.foco(d, (jx0 - 4, jy0 - 4, jx1 + 4, jy1 + 4), cor)

        if cena.get("riscar"):
            for k in range(-int(jy1 - jy0), int(jx1 - jx0), 30):
                d.line([(jx0 + k, jy1), (jx0 + k + (jy1 - jy0), jy0)], fill=cor, width=3)

        # A anotação vive ABAIXO da captura, não no trilho.
        #
        # No primeiro corte ela ficava na coluna de metadados, e a coluna tem
        # 168 px: o texto transbordava por cima da própria tela que deveria
        # explicar. Aqui o trilho fica com o contador — que é curto e cabe —
        # e a frase corre na largura do campo, onde há espaço para ela.
        ay = py + recorte.height + 34
        ID.texto(d, (ID.MARGEM_E, ay), f"{i + 1:02d} / {len(cena['focos']):02d}",
                 "codigo", cor, "la")
        d.line([(ID.MARGEM_E, ay - 20), (ID.MARGEM_E + 56, ay - 20)], fill=cor, width=3)
        for j, ln in enumerate(ID.quebrar(rotulo, "entrada", ID.CONT_L, tam=38)[:2]):
            ID.texto(d, (ID.CONT_X, ay - 8 + j * 46), ln, "entrada", ID.GRAFITE,
                     "la", tam=38)

        if cena.get("cursor_em") == i:
            ID.cursor(im, jx1 + 20, jy0 + (jy1 - jy0) * 0.6, clique=0.35)
        if cena.get("aviso"):
            ID.texto(d, (ID.L - ID.MARGEM_D, ID.Y_CAB + 60), cena["aviso"].upper(),
                     "codigo", ID.CINZA, "ra")
        _procedencia(im, cena)

        extras = cena.get("linhas_extra") or []
        if not extras:
            planos.append((im, 1.0))
            continue
        for e in range(len(extras) + 1):
            var = im.copy()
            dv = ImageDraw.Draw(var)
            for j, ln in enumerate(extras[:e]):
                ID.texto(dv, (ID.CONT_X, ay + 46 + j * 40), ln, "apoio",
                         ID.CINZA, "la")
            planos.append((var, 0.7 if e < len(extras) else 1.3))
    return planos


# ---------------------------------------------------------------------------
# AVALIAÇÃO
# ---------------------------------------------------------------------------

def prova(cena):
    n = len(cena["alternativas"])
    planos = []
    for fase in range(n + 2):
        revelar = fase == n + 1
        vis = n if revelar else fase
        im = _pagina(cena)
        d = ImageDraw.Draw(im)
        # Bloco centrado no óptico: com a pergunta presa ao topo sobravam ~280 px
        # de vazio no rodapé, e a página lia como inacabada em vez de arejada.
        perg_l = ID.quebrar(cena["pergunta"], "titulo", ID.L - ID.MARGEM_E - ID.MARGEM_D)
        alt = (56 + len(perg_l) * ID.altura_linha("titulo") + 44
               + n * (ID.altura_linha("entrada") + 50) + (60 if revelar else 0))
        y = ID.centrar(alt)
        ID.texto(d, (ID.MARGEM_E, y), f"PERGUNTA {cena['numero']:02d} / 05",
                 "rotulo", ID.TURQUESA_TEXTO, "la")
        y += 56
        for ln in perg_l:
            ID.texto(d, (ID.MARGEM_E, y), ln, "titulo", ID.GRAFITE, "la")
            y += ID.altura_linha("titulo")
        y += 44
        for i, alt in enumerate(cena["alternativas"]):
            certa = revelar and i == cena["correta"]
            if i >= vis:
                continue
            cor = ID.VERDE if certa else ID.CINZA
            ID.texto(d, (ID.MARGEM_E, y + 14), chr(65 + i), "rotulo", cor, "la", tam=30)
            if certa:
                d.rectangle([ID.MARGEM_E + 96, y + 12, ID.MARGEM_E + 120, y + 36],
                            fill=ID.VERDE)
            ID.texto(d, (ID.CONT_X, y), alt, "entrada_forte" if certa else "entrada",
                     ID.GRAFITE if certa else ID.CINZA, "la")
            yy = y + ID.altura_linha("entrada") + 20
            d.line([(ID.MARGEM_E, yy), (ID.L - ID.MARGEM_D, yy)],
                   fill=ID.VERDE if certa else ID.FILETE, width=2 if certa else 1)
            y = yy + 30
        if revelar:
            ID.texto(d, (ID.CONT_X, y + 12), cena["justificativa"], "corpo",
                     ID.CINZA, "la")
        peso = 1.5 if fase == 0 else (0.6 if fase < n else 1.9)
        planos.append((im, 1.0 if revelar else peso))
    return planos


PINTORES = {
    "abertura": abertura, "secao": secao, "encerramento": encerramento,
    "declaracao": declaracao, "registro": registro, "nota": nota,
    "lacunas": lacunas, "fluxo": fluxo, "gatilho": gatilho, "decisao": decisao,
    "linha_tempo": linha_tempo, "contraste": contraste, "excecao": excecao,
    "condicoes": condicoes, "conferencia": conferencia, "mapa": mapa,
    "tela": tela, "prova": prova,
}


def planos_de(cena: dict):
    return PINTORES[cena["tipo"]](cena)
