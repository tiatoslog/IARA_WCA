"""
mascarar.py — remove dado pessoal das capturas do POP antes de qualquer render.

Este script é o PORTÃO da produção: nada entra em `assets/screenshots/` sem
passar por aqui, e o renderizador só lê de lá. A cópia crua em
`public/procedimentos/` nunca é aberta pelo pipeline de vídeo.

Motivo, em uma frase: o vídeo é material de RH e circula para quem não tem —
nem precisa ter — acesso à agenda de contatos da operação. Ver `pop-audit.md` P0-1.

REGRA DE DECISÃO, aplicada campo a campo:

  MASCARA   telefone, e-mail, nome de pessoa usado como CONTATO.
  PRESERVA  cabeçalho de coluna, nome de cidade/central, número de OCI,
            assunto do e-mail, datas, e qualquer coisa que o aluno precise
            RECONHECER na tela.

A distinção não é estética. O objetivo do passo 2.10 é "saber onde encontrar o
contato", não decorá-lo — então a ESTRUTURA da tabela é o conteúdo didático, e
o CONTEÚDO das células é o dado a proteger.

As coordenadas não foram estimadas no olho: a grade de cada planilha foi
detectada por perfil de pixel (linhas escuras contínuas), e as faixas de texto
do e-mail por perfil de linha. Ver `mascarar-relatorio.md`, gerado por este script.

    python project/mascarar.py
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
ORIGEM = RAIZ / "iara-os/apps/web/public/procedimentos/IT-ADMLUFT-001"
DESTINO = Path(__file__).resolve().parents[1] / "assets/screenshots"

# Tokens do style-guide. Tarja em tinta-fraca: legível como "aqui havia dado",
# sem imitar censura de documento vazado.
TARJA = (91, 98, 107)
TARJA_TXT = (255, 255, 255)
LINHA = (211, 214, 219)


def fonte(tam: int) -> ImageFont.FreeTypeFont:
    for nome in ("segoeuib.ttf", "segoeui.ttf", "arialbd.ttf"):
        caminho = Path("C:/Windows/Fonts") / nome
        if caminho.exists():
            return ImageFont.truetype(str(caminho), tam)
    return ImageFont.load_default()


@dataclass
class Faixa:
    """Um retângulo a mascarar, com a justificativa junto — nunca separada."""

    x0: int
    y0: int
    x1: int
    y1: int
    motivo: str
    rotulo: str = ""


@dataclass
class Alvo:
    arquivo: str
    descricao: str
    faixas: list[Faixa] = field(default_factory=list)
    preservado: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# MANIFESTO — o que é mascarado, onde, e por quê.
# --------------------------------------------------------------------------

ALVOS: list[Alvo] = [
    Alvo(
        arquivo="42a3607a3cf2.png",
        descricao="Planilha CONTATOS LUFT — postos e centrais",
        preservado=[
            "cabeçalho das colunas (é o conteúdo didático do passo 2.10)",
            "coluna CENTRAL — nomes de cidade não são dado pessoal",
        ],
        faixas=[
            # Grade detectada: verticais em 256, 405, 540, 737, 932, 1088.
            # Banda de cabeçalho azul termina em y=18; borda até y=20.
            Faixa(257, 21, 405, 438, "nome de contato do posto", "CONTATO"),
            Faixa(406, 21, 540, 438, "telefone do posto", "TELEFONE"),
            Faixa(541, 21, 737, 438, "nome do motorista", "MOTORISTA"),
            Faixa(738, 21, 932, 438, "telefone do motorista", "TELEFONE"),
            Faixa(933, 21, 1088, 438, "nome do contato da central", "CONTATO"),
            Faixa(1089, 21, 1259, 438, "telefone da central", "TELEFONE"),
        ],
    ),
    Alvo(
        arquivo="b6e615e3f096.png",
        descricao="E-mail de recebimento da OCI",
        preservado=[
            "linha Assunto — descreve origem e destino da carga (passo 1.1)",
            "as duas linhas OCI 184957 / 184958 — é o que o aluno precisa reconhecer",
            "corpo da mensagem e data de envio",
            "razão social no rodapé — pessoa jurídica",
        ],
        faixas=[
            # Faixas de texto detectadas por perfil de linha.
            # x0 medido: o rótulo "De:" termina em x=22 e "Para:" em x=34
            # (perfil de coluna das faixas de texto). Mascarar a partir de 24/36
            # preserva o rótulo do campo e não deixa escapar a primeira letra.
            Faixa(24, 26, 380, 42, "remetente: nome + e-mail", "REMETENTE"),
            Faixa(36, 60, 1270, 78, "destinatários: nomes + e-mails", "DESTINATÁRIOS"),
            Faixa(2, 78, 180, 94, "continuação dos destinatários", ""),
            Faixa(2, 127, 125, 142, "saudação nominal", ""),
            Faixa(2, 356, 150, 372, "assinatura: nome da remetente", ""),
            # Marca d'água de Windows não ativado (P2-2).
            Faixa(975, 352, 1284, 398, "marca d'água Ativar o Windows", ""),
        ],
    ),
    Alvo(
        arquivo="242b460e7efd.png",
        descricao="Planilha de controle de OCIs — linha de lançamento",
        preservado=[
            "OCI, ORIGEM, DESTINO, U.F., DATA REC. — os campos que o aluno preenche",
            "coluna ROTA — objeto do passo 2.7",
        ],
        faixas=[
            # Verticais detectadas: ... 781, 887 delimitam MOTORISTA.
            # Cabeçalho duplo termina em y=61.
            Faixa(782, 62, 887, 225, "primeiro nome de motorista", "MOTORISTA"),
        ],
    ),
    Alvo(
        arquivo="e93c9a811c0e.png",
        descricao="Bloco AGENDAMENTO — postos, central e TAC",
        preservado=[
            "colunas DATA e HORA — o que o passo manda registrar",
            "cabeçalhos POSTOS / CENTRAL / TAC",
        ],
        faixas=[
            # Verticais: 62,126,199,263,327,397,461,525. CONTAT = 126..199 e 327..397.
            Faixa(127, 81, 199, 224, "nome do contato do posto", "CONTATO"),
            Faixa(328, 81, 397, 224, "nome do contato da central", "CONTATO"),
        ],
    ),
    Alvo(
        arquivo="c55adba2c23c.png",
        descricao="Colunas DATA COLETA e DATA DESCARGA",
        preservado=[
            "DATA REC. OCI, DATA COLETA, DATA DESCARGA — objeto dos passos 2.14/2.15",
        ],
        faixas=[
            # Verticais: 1, 96, 253, 355. MOTORISTA = 96..253.
            Faixa(97, 68, 253, 252, "nome de motorista", "MOTORISTA"),
        ],
    ),
    # Sem dado pessoal — copiadas sem alteração, mas passam pelo portão.
    Alvo(arquivo="1c66b4f5a0c3.png", descricao="Caminho de rede da planilha"),
    Alvo(arquivo="294247ef05fb.png", descricao="Lista de arquivos — planilha de contatos"),
    Alvo(arquivo="d5c9b293e917.png", descricao="Trilha de pastas CtrFrete"),
]


def aplicar(alvo: Alvo) -> dict:
    origem = ORIGEM / alvo.arquivo
    im = Image.open(origem).convert("RGB")
    d = ImageDraw.Draw(im)

    for f in alvo.faixas:
        x1 = min(f.x1, im.width)
        y1 = min(f.y1, im.height)
        d.rectangle([f.x0, f.y0, x1, y1], fill=TARJA)
        if f.rotulo:
            larg = x1 - f.x0
            alt = y1 - f.y0
            tam = max(9, min(13, larg // 8))
            ft = fonte(tam)
            cx = f.x0 + larg / 2
            # Rótulo repetido, para a tarja continuar legível quando o quadro
            # mostra só um trecho da coluna. A cada 68 px, não 34: no primeiro
            # render a repetição densa virava uma parede cinza de "CONTATO /
            # TELEFONE" que chamava mais atenção que a tabela — a máscara
            # passava a ser o assunto do quadro, que é o oposto do objetivo.
            passo = 68
            n = max(1, int(alt // passo))
            for i in range(n):
                cy = f.y0 + passo / 2 + i * passo
                if cy > y1 - 6:
                    break
                d.text((cx, cy), f.rotulo, font=ft, fill=TARJA_TXT, anchor="mm")

    DESTINO.mkdir(parents=True, exist_ok=True)
    saida = DESTINO / alvo.arquivo
    im.save(saida)

    return {
        "arquivo": alvo.arquivo,
        "descricao": alvo.descricao,
        "dimensoes": f"{im.width}×{im.height}",
        "faixas": len(alvo.faixas),
        "sha256_origem": hashlib.sha256(origem.read_bytes()).hexdigest()[:16],
        "sha256_saida": hashlib.sha256(saida.read_bytes()).hexdigest()[:16],
        "motivos": [f.motivo for f in alvo.faixas],
        "preservado": alvo.preservado,
    }


def main() -> None:
    relatorio = [aplicar(a) for a in ALVOS]

    total = sum(r["faixas"] for r in relatorio)
    destino_md = Path(__file__).resolve().parents[1] / "production/mascarar-relatorio.md"

    linhas = [
        "# mascarar-relatorio.md — o que foi removido das capturas",
        "",
        "> Gerado por `project/mascarar.py`. Não editar à mão.",
        "",
        f"**{len(relatorio)} capturas processadas · {total} faixas mascaradas.**",
        "",
        "O renderizador lê **apenas** de `assets/screenshots/`. A cópia crua em",
        "`public/procedimentos/` não é aberta pelo pipeline de vídeo.",
        "",
    ]
    for r in relatorio:
        linhas.append(f"## `{r['arquivo']}` — {r['descricao']}")
        linhas.append("")
        linhas.append(f"- Dimensões: {r['dimensoes']}")
        linhas.append(f"- SHA-256 origem: `{r['sha256_origem']}` → saída: `{r['sha256_saida']}`")
        if r["motivos"]:
            linhas.append("- **Mascarado:**")
            for m in r["motivos"]:
                linhas.append(f"  - {m}")
        else:
            linhas.append("- **Mascarado:** nada — a captura não contém dado pessoal")
        if r["preservado"]:
            linhas.append("- **Preservado deliberadamente:**")
            for p in r["preservado"]:
                linhas.append(f"  - {p}")
        linhas.append("")

    destino_md.write_text("\n".join(linhas), encoding="utf8")

    (Path(__file__).resolve().parents[1] / "assets/screenshots/manifesto.json").write_text(
        json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf8"
    )

    print(f"{len(relatorio)} capturas, {total} faixas mascaradas -> assets/screenshots/")


if __name__ == "__main__":
    main()
