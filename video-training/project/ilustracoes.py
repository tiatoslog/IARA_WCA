"""
ilustracoes.py — ilustrações flat originais, desenhadas em código.

POR QUE DESENHADAS, E NÃO BAIXADAS
----------------------------------
As referências de estilo trazidas para o projeto são vetores licenciados de
banco de imagens. Não entram: a regra do repositório manda verificar uso
comercial antes de qualquer asset novo, e o vídeo é material comercial da casa.
O que entra é o PRINCÍPIO — flat de verdade — aplicado a formas desenhadas aqui:
sem licença de terceiro, na paleta do produto, e específicas deste domínio.

O QUE "FLAT" SIGNIFICA AQUI, COMO REGRA
---------------------------------------
1. **Só forma preenchida.** Sem gradiente, sem sombra, sem brilho, sem contorno
   duplo. Uma silhueta ou nada.
2. **Três cores por ilustração, no máximo**, todas da paleta. Profundidade vem
   de sobreposição e de valor, nunca de sombra.
3. **Campo de cor primeiro.** Cada ilustração se apoia num bloco de `AGUA` ou
   `TURQUESA` que ocupa área generosa — é ele que tira a página do branco.
4. **Geometria, não desenho.** Retângulo, círculo, polígono. Se precisa de
   curva livre para funcionar, o conceito está errado.
5. **Assunto real.** Envelope, planilha, telefone, calendário, documento,
   caminhão, pasta. O mundo do procedimento — nunca metáfora genérica de
   "equipe colaborando".

Coordenadas normalizadas: cada função desenha em `(0,0)-(1,1)` e é escalada
para a caixa recebida. Assim a mesma ilustração serve a um selo de 180 px e a
um painel de 700 px sem redesenho.
"""

from __future__ import annotations

import math

from PIL import Image, ImageDraw

import identidade as ID

# Papéis de cor dentro de uma ilustração. Nomes por função, não por tom —
# trocar a paleta não deve exigir reler cada desenho.
FUNDO = ID.AGUA
BASE = ID.PETROLEO
DESTAQUE = ID.TURQUESA
CLARO = ID.BRANCO
NEUTRO = (198, 214, 213)


class Tela:
    """Desenho em coordenadas 0..1, escalado para a caixa."""

    def __init__(self, d: ImageDraw.ImageDraw, caixa):
        self.d = d
        self.x0, self.y0, self.x1, self.y1 = caixa
        self.w = self.x1 - self.x0
        self.h = self.y1 - self.y0
        self.u = min(self.w, self.h)          # unidade quadrada, centrada
        self.ox = self.x0 + (self.w - self.u) / 2
        self.oy = self.y0 + (self.h - self.u) / 2

    def p(self, x, y):
        return (self.ox + x * self.u, self.oy + y * self.u)

    def ret(self, x, y, w, h, cor, raio=0):
        a, b = self.p(x, y)
        c, e = self.p(x + w, y + h)
        if raio:
            self.d.rounded_rectangle([a, b, c, e], radius=raio * self.u, fill=cor)
        else:
            self.d.rectangle([a, b, c, e], fill=cor)

    def elipse(self, x, y, w, h, cor):
        a, b = self.p(x, y)
        c, e = self.p(x + w, y + h)
        self.d.ellipse([a, b, c, e], fill=cor)

    def poli(self, pontos, cor):
        self.d.polygon([self.p(*q) for q in pontos], fill=cor)

    def linha(self, pontos, cor, esp=0.012):
        self.d.line([self.p(*q) for q in pontos], fill=cor,
                    width=max(2, int(esp * self.u)), joint="curve")


# ---------------------------------------------------------------------------
# O CAMPO DE COR — o que tira a página do branco
# ---------------------------------------------------------------------------

def campo(t: Tela, forma="circulo", cor=FUNDO):
    if forma == "circulo":
        t.elipse(0.02, 0.06, 0.96, 0.88, cor)
    elif forma == "bloco":
        t.ret(0.0, 0.08, 1.0, 0.84, cor, raio=0.05)
    elif forma == "meio":
        t.ret(0.0, 0.30, 1.0, 0.62, cor, raio=0.04)


# ---------------------------------------------------------------------------
# AS ILUSTRAÇÕES
# ---------------------------------------------------------------------------

def envelope(t: Tela):
    """A OCI que chega por e-mail."""
    campo(t)
    t.ret(0.16, 0.34, 0.68, 0.44, CLARO, raio=0.02)
    t.poli([(0.16, 0.34), (0.50, 0.60), (0.84, 0.34)], NEUTRO)
    t.poli([(0.16, 0.34), (0.50, 0.60), (0.84, 0.34)], BASE)
    # etiqueta da OCI, saindo por cima
    t.ret(0.30, 0.20, 0.40, 0.17, DESTAQUE, raio=0.02)
    t.ret(0.35, 0.253, 0.12, 0.026, ID.ABISSAL)
    t.ret(0.49, 0.253, 0.16, 0.026, ID.ABISSAL)
    t.ret(0.35, 0.30, 0.22, 0.022, ID.ABISSAL)


def planilha(t: Tela):
    """A planilha de controle — o objeto central do procedimento."""
    campo(t, "bloco")
    t.ret(0.10, 0.18, 0.80, 0.64, CLARO, raio=0.02)
    t.ret(0.10, 0.18, 0.80, 0.10, BASE, raio=0.02)
    t.ret(0.10, 0.24, 0.80, 0.04, BASE)
    for c in range(4):
        t.ret(0.145 + c * 0.19, 0.205, 0.13, 0.028, CLARO)
    for r in range(4):
        y = 0.34 + r * 0.115
        for c in range(4):
            preenchida = r * 4 + c < 9
            t.ret(0.145 + c * 0.19, y, 0.13, 0.05,
                  DESTAQUE if (r == 0 and c == 0) else (NEUTRO if preenchida else (236, 241, 240)),
                  raio=0.006)


def pastas(t: Tela):
    """O caminho de rede — onde a planilha vive."""
    campo(t, "circulo")
    for i, (dx, dy, cor) in enumerate([(0.0, 0.0, NEUTRO), (0.05, 0.07, BASE)]):
        t.poli([(0.14 + dx, 0.30 + dy), (0.40 + dx, 0.30 + dy), (0.46 + dx, 0.38 + dy),
                (0.80 + dx, 0.38 + dy), (0.80 + dx, 0.70 + dy), (0.14 + dx, 0.70 + dy)], cor)
    t.ret(0.24, 0.50, 0.42, 0.035, DESTAQUE)
    t.ret(0.24, 0.565, 0.30, 0.035, (120, 168, 172))


def telefone(t: Tela):
    """O agendamento — a ligação para posto, central e motorista."""
    campo(t)
    t.ret(0.34, 0.16, 0.32, 0.62, BASE, raio=0.05)
    t.ret(0.375, 0.225, 0.25, 0.44, CLARO, raio=0.01)
    t.ret(0.455, 0.185, 0.09, 0.018, DESTAQUE, raio=0.01)
    t.elipse(0.472, 0.695, 0.056, 0.056, NEUTRO)
    # três marcas de contato feito
    for i in range(3):
        t.ret(0.405, 0.265 + i * 0.09, 0.19, 0.025, NEUTRO)
        t.ret(0.405, 0.305 + i * 0.09, 0.12, 0.02, (222, 232, 231))
    t.elipse(0.60, 0.24, 0.20, 0.20, DESTAQUE)
    _visto(t, 0.645, 0.295, 0.11, ID.ABISSAL)


def calendario(t: Tela):
    """O prazo — sempre até um dia antes da coleta."""
    campo(t, "bloco")
    t.ret(0.14, 0.22, 0.72, 0.60, CLARO, raio=0.03)
    t.ret(0.14, 0.22, 0.72, 0.14, BASE, raio=0.03)
    t.ret(0.14, 0.30, 0.72, 0.06, BASE)
    t.ret(0.26, 0.155, 0.055, 0.13, BASE, raio=0.02)
    t.ret(0.685, 0.155, 0.055, 0.13, BASE, raio=0.02)
    for r in range(3):
        for c in range(5):
            x, y = 0.195 + c * 0.128, 0.42 + r * 0.125
            marcado = (r == 1 and c == 2)
            hoje = (r == 1 and c == 3)
            if marcado:
                t.ret(x - 0.014, y - 0.016, 0.10, 0.09, ID.AMBAR, raio=0.02)
            elif hoje:
                t.ret(x - 0.014, y - 0.016, 0.10, 0.09, DESTAQUE, raio=0.02)
            else:
                t.ret(x, y, 0.072, 0.058, NEUTRO, raio=0.012)


def documento(t: Tela):
    """O documento assinado — Autentique e SMBOT."""
    campo(t)
    t.ret(0.24, 0.16, 0.52, 0.68, CLARO, raio=0.02)
    for i in range(5):
        t.ret(0.30, 0.25 + i * 0.075, 0.40 - (0.14 if i == 4 else 0), 0.028, NEUTRO)
    t.ret(0.30, 0.63, 0.24, 0.022, BASE)
    t.elipse(0.545, 0.575, 0.235, 0.235, DESTAQUE)
    _visto(t, 0.60, 0.645, 0.13, ID.ABISSAL)


def caminhao(t: Tela):
    """A coleta — o que tudo isto existe para mover."""
    campo(t, "meio")
    t.ret(0.10, 0.38, 0.44, 0.28, BASE, raio=0.02)
    t.poli([(0.56, 0.46), (0.74, 0.46), (0.86, 0.56), (0.86, 0.66), (0.56, 0.66)], DESTAQUE)
    t.ret(0.60, 0.485, 0.13, 0.075, ID.AGUA, raio=0.01)
    t.ret(0.06, 0.655, 0.84, 0.025, BASE)
    for cx in (0.235, 0.735):
        t.elipse(cx - 0.055, 0.645, 0.11, 0.11, ID.ABISSAL)
        t.elipse(cx - 0.024, 0.676, 0.048, 0.048, ID.AGUA)
    t.ret(0.16, 0.44, 0.22, 0.03, (120, 168, 172))
    t.ret(0.16, 0.50, 0.14, 0.03, (120, 168, 172))


def rota(t: Tela):
    """Origem e destino — o que alimenta o campo rota."""
    campo(t, "circulo")
    t.linha([(0.20, 0.66), (0.40, 0.66), (0.40, 0.40), (0.78, 0.40)], BASE, 0.022)
    for (x, y, cor) in ((0.20, 0.66, DESTAQUE), (0.78, 0.40, ID.AMBAR)):
        t.elipse(x - 0.075, y - 0.075, 0.15, 0.15, cor)
        t.elipse(x - 0.030, y - 0.030, 0.06, 0.06, CLARO)
    t.ret(0.14, 0.755, 0.20, 0.028, (120, 168, 172))
    t.ret(0.66, 0.245, 0.20, 0.028, (120, 168, 172))


def alerta(t: Tela):
    """Ponto de atenção."""
    campo(t, "circulo", (245, 232, 206))
    t.poli([(0.50, 0.20), (0.86, 0.76), (0.14, 0.76)], ID.AMBAR)
    t.ret(0.474, 0.375, 0.052, 0.20, (245, 232, 206), raio=0.02)
    t.ret(0.474, 0.62, 0.052, 0.055, (245, 232, 206), raio=0.02)


def bloqueio(t: Tela):
    """Erro comum."""
    campo(t, "circulo", (245, 224, 216))
    t.elipse(0.16, 0.20, 0.68, 0.68, ID.CORAL)
    for s in (1, -1):
        t.d.line([t.p(0.50 - s * 0.15, 0.39), t.p(0.50 + s * 0.15, 0.69)],
                 fill=(245, 224, 216), width=max(3, int(0.05 * t.u)))


def visto(t: Tela):
    """Boa prática, conferido, concluído."""
    campo(t, "circulo", (216, 234, 226))
    t.elipse(0.16, 0.20, 0.68, 0.68, ID.VERDE)
    _visto(t, 0.34, 0.50, 0.32, (216, 234, 226))


def _visto(t: Tela, x, y, tam, cor):
    t.d.line([t.p(x, y), t.p(x + tam * 0.33, y + tam * 0.30),
              t.p(x + tam, y - tam * 0.34)],
             fill=cor, width=max(3, int(tam * 0.30 * t.u)), joint="curve")


def cadeia(t: Tela):
    """A cadeia operacional — agendamento, emissão, transporte."""
    campo(t, "meio")
    for i, cor in enumerate((DESTAQUE, BASE, NEUTRO)):
        x = 0.10 + i * 0.30
        t.ret(x, 0.40 - i * 0.0, 0.22, 0.22, cor, raio=0.02)
        if i < 2:
            t.ret(x + 0.235, 0.495, 0.045, 0.03, BASE)
    t.ret(0.10, 0.68, 0.22, 0.028, BASE)


ILUSTRACOES = {
    "envelope": envelope, "planilha": planilha, "pastas": pastas,
    "telefone": telefone, "calendario": calendario, "documento": documento,
    "caminhao": caminhao, "rota": rota, "alerta": alerta,
    "bloqueio": bloqueio, "visto": visto, "cadeia": cadeia,
}


def desenhar(im: Image.Image, nome: str, caixa):
    """Desenha `nome` dentro de `caixa` = (x0, y0, x1, y1)."""
    fn = ILUSTRACOES.get(nome)
    if fn is None:
        raise KeyError(f"ilustração desconhecida: {nome}")
    fn(Tela(ImageDraw.Draw(im), caixa))
