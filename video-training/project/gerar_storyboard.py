"""
gerar_storyboard.py — escreve `production/storyboard.md` a partir da linha do
tempo REAL, não da intenção.

Existe por um motivo específico: um storyboard escrito à mão descreve o que se
pretendia montar, e passa a mentir no instante em que uma cena muda. Este é
derivado dos mesmos dados que produzem os quadros, então ou está certo ou o
vídeo também está errado.

    python project/gerar_storyboard.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import render
from cenas import CENAS, por_id

RAIZ = Path(__file__).resolve().parents[1]

DESCRICAO_TIPO = {
    "abertura": "Fundo abissal. A marca constrói-se: degrau, nome, faixa de metadados.",
    "secao": "Fundo abissal, numeral gigante em Bahnschrift sangrando à direita.",
    "declaracao": "Uma frase em Segoe UI Light, muito espaço negativo, degrau de remate.",
    "registro": "Lista de entradas — código no trilho, filete, conteúdo no campo.",
    "nota": "Nota marginal: filete vertical no trilho, rótulo técnico, texto no campo.",
    "tela": "Captura real em largura cheia, véu, marcas de canto e anotação abaixo.",
    "fluxo": "Elos em degraus descendentes; o conector é a forma da marca.",
    "gatilho": "Declaração + registro: OCI recebida → degrau → liberado.",
    "decisao": "Duas saídas, cada uma aberta por um degrau.",
    "linha_tempo": "Eixo horizontal com marcos; percurso do documento abaixo.",
    "contraste": "Duas colunas separadas por filete vertical, numeradas.",
    "excecao": "Entradas NÃO/FAZ, em coral e verde, sem caixa.",
    "condicoes": "Regras empilhadas: rótulo técnico, régua de cor, frase grande.",
    "conferencia": "Entradas com estado — quadrado marcado quando conferido.",
    "mapa": "Grade tipográfica de seis, com filete acima de cada um.",
    "prova": "Pergunta em título; alternativas como entradas; revelação em verde.",
    "lacunas": "Entradas de lacuna + remate âmbar.",
    "encerramento": "Fundo abissal, fecho e próximo da trilha.",
}

TRANSICAO = {
    "etapa": "Cortina petróleo, 700 ms",
}


def mmss(s: float) -> str:
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


def main() -> None:
    linha = render.montar_tempos()
    total = linha[-1]["fim"]
    itens = render.legendas(linha)

    L = [
        "# storyboard.md — plano a plano",
        "",
        "> **Gerado por `project/gerar_storyboard.py` a partir da linha do tempo real.**",
        "> Não editar à mão: este arquivo é derivado dos mesmos dados que produzem",
        "> os quadros, e reescrevê-lo manualmente o desconecta do vídeo.",
        "",
        f"**{len(linha)} cenas · {sum(len(c['planos']) for c in linha)} planos · "
        f"{mmss(total)} · 1920×1080 · 30 fps**",
        "",
        "Os quadros de referência de cada plano estão em `production/storyboard/`,",
        "numerados na mesma ordem desta tabela.",
        "",
        "Convenções: **PLANO** é um quadro estático composto; a troca entre planos",
        "é uma mesclagem de 450 ms (700 ms ao entrar em cena de etapa). O trilho de",
        "progresso avança continuamente em todos os quadros que têm rodapé.",
        "",
        "---",
        "",
    ]

    n_plano = 0
    for cena in linha:
        c = por_id(cena["id"])
        L.append(f"## {cena['id']} · {mmss(cena['inicio'])} → {mmss(cena['fim'])} "
                 f"({cena['duracao']:.1f} s)")
        L.append("")
        L.append(f"| | |")
        L.append(f"|---|---|")
        L.append(f"| **SCENE_ID** | `{cena['id']}` |")
        L.append(f"| **DURAÇÃO** | {cena['duracao']:.1f} s "
                 f"({cena['d_fala']:.1f} s de narração"
                 + (f" + 3,0 s de pausa + {cena['d_fala_b']:.1f} s de resposta"
                    if cena['d_fala_b'] else "") + ") |")
        L.append(f"| **TIPO** | `{cena['tipo']}` |")
        L.append(f"| **VISUAL** | {DESCRICAO_TIPO.get(cena['tipo'], '—')} |")
        if c.get("etapa"):
            L.append(f"| **BARRA** | {c['etapa']}"
                     + (f" · {c['passo']}" if c.get("passo") else "") + " |")
        L.append(f"| **PLANOS** | {len(cena['planos'])} |")
        L.append(f"| **TRANSIÇÃO DE ENTRADA** | "
                 f"{TRANSICAO.get(cena['tipo'], 'Mesclagem 450 ms')} |")
        if c.get("arquivo"):
            L.append(f"| **CAPTURA** | `assets/screenshots/{c['arquivo']}` "
                     f"(mascarada — ver `mascarar-relatorio.md`) |")
        if c.get("aviso"):
            L.append(f"| **AVISO EM TELA** | {c['aviso']} |")
        if c.get("lacuna"):
            L.append(f"| **CARTÃO DE LACUNA** | {c['lacuna']} |")
        L.append(f"| **POP_REF** | {cena['pop'] or '— (cena didática, não afirma procedimento)'} |")
        L.append("")

        if cena["narracao"]:
            L.append("**NARRAÇÃO**")
            L.append("")
            L.append(f"> {cena['narracao']}")
            L.append("")
        if cena["narracao_resposta"]:
            L.append("**NARRAÇÃO (revelação)**")
            L.append("")
            L.append(f"> {cena['narracao_resposta']}")
            L.append("")

        # Planos, com o que cada um acrescenta.
        L.append("| # | Entra em | Dura | Quadro | O que este plano acrescenta |")
        L.append("|---|---|---|---|---|")
        focos = c.get("focos") or []
        for j, p in enumerate(cena["planos"]):
            n_plano += 1
            sufixo = "" if len(cena["planos"]) == 1 else f"-{j + 1}"
            arq = f"`{n_plano:03d}_{cena['id']}{sufixo}.png`"
            if cena["tipo"] == "captura" and j < len(focos):
                acrescenta = f"foco em **{focos[j][4]}**"
            elif cena["tipo"] == "captura":
                acrescenta = "linha de apoio"
            elif cena["tipo"] == "quiz":
                n_alt = len(c["alternativas"])
                acrescenta = ("pergunta, sem alternativas" if j == 0
                              else (f"alternativa {chr(64 + j)}" if j <= n_alt
                                    else "**revelação da resposta + justificativa**"))
            elif cena["tipo"] == "cartao":
                linhas_c = c.get("linhas", [])
                acrescenta = ("título" if j == 0
                              else f"linha: “{linhas_c[j - 1]}”" if j - 1 < len(linhas_c)
                              else "—")
            elif cena["tipo"] == "checklist":
                its = c["itens"]
                acrescenta = ("lista vazia" if j == 0
                              else f"marca: “{its[j - 1]}”" if j - 1 < len(its)
                              else "moldura de conclusão")
            else:
                acrescenta = f"etapa {j + 1} da montagem"
            L.append(f"| {j + 1} | {mmss(p['inicio'])} | {p['fim'] - p['inicio']:.1f} s "
                     f"| {arq} | {acrescenta} |")
        L.append("")

        legs = [i for i in itens if i["cena"] == cena["id"]]
        if legs:
            L.append(f"**LEGENDAS** ({len(legs)}): "
                     + " · ".join(f"`{mmss(i['inicio'])}`" for i in legs))
            L.append("")
        L.append("---")
        L.append("")

    (RAIZ / "production/storyboard.md").write_text("\n".join(L), encoding="utf8")
    escrever_script(linha)
    print(f"storyboard.md: {len(linha)} cenas, {n_plano} planos")
    print("script.md: derivado de cenas.py")


BLOCOS = {
    "S001": "BLOCO 0 — ABERTURA E CONTRATO",
    "S006": "BLOCO 1 — ETAPA 1 · RECEBIMENTO DA OCI",
    "S011": "BLOCO 2 — ETAPA 2 · PLANILHA E AGENDAMENTO",
    "S024": "BLOCO 3 — AS TRÊS EXCEÇÕES",
    "S029": "BLOCO 4 — ETAPA 3 · ENVIO DE DOCUMENTOS",
    "S032": "BLOCO 5 — VERIFICAÇÃO E FIXAÇÃO",
    "S034": "BLOCO 6 — AVALIAÇÃO",
    "S040": "BLOCO 7 — ENCERRAMENTO",
}


def escrever_script(linha) -> None:
    """`script.md`, derivado da mesma fonte que o vídeo.

    Era escrito à mão e passou a mentir no instante em que uma cena mudou de
    arquétipo — o verificador acusou a divergência entre roteiro e dados.
    Gerar resolve na raiz: os dois saem do mesmo lugar, ou nenhum sai.
    """
    S = [
        "# script.md — roteiro",
        "",
        "> **Gerado por `project/gerar_storyboard.py`.** Não editar à mão: a",
        "> narração e a estrutura vivem em `project/cenas.py`, e é de lá que saem",
        "> tanto este documento quanto os quadros do vídeo.",
        "",
        f"**{len(linha)} cenas · {mmss(linha[-1]['fim'])} · 1920×1080 · 30 fps**",
        "",
        "A tela resume, a voz explica, o sistema demonstra — o texto em tela nunca",
        "repete a narração. Duração é **medida do áudio**, nunca arbitrada aqui.",
        "",
        "**Procedência.** `POP_REF` aponta para a REV.02 do documento.",
        "`PROCEDÊNCIA` marca o que **não está** no documento e foi informado pela",
        "área responsável — vai para a tela com rótulo próprio, nunca como texto",
        "normativo.",
        "",
        "---",
        "",
    ]
    for cena in linha:
        c = por_id(cena["id"])
        if cena["id"] in BLOCOS:
            S += [f"# {BLOCOS[cena['id']]}", ""]
        S += [f"### {cena['id']} · {mmss(cena['inicio'])} → {mmss(cena['fim'])}", ""]
        S.append(f"- **DURAÇÃO** {cena['duracao']:.1f} s")
        S.append(f"- **ARQUÉTIPO** `{cena['tipo']}` — "
                 f"{DESCRICAO_TIPO.get(cena['tipo'], '—')}")
        S.append(f"- **PLANOS** {len(cena['planos'])}")
        if c.get("etapa"):
            S.append(f"- **BARRA** {c['etapa']}"
                     + (f" · {c['passo']}" if c.get("passo") else ""))
        if c.get("arquivo"):
            S.append(f"- **CAPTURA** `{c['arquivo']}` — mascarada")
        if c.get("aviso"):
            S.append(f"- **AVISO EM TELA** {c['aviso']}")
        if c.get("procedencia"):
            S.append(f"- **PROCEDÊNCIA** {c['procedencia']}")
        if c.get("lacuna"):
            S.append(f"- **LACUNA EM TELA** {c['lacuna']}")
        S.append(f"- **POP_REF** {cena['pop'] or '— (cena didática)'}")
        S.append("")
        if cena["narracao"]:
            S += ["**NARRAÇÃO**", "", f"> {cena['narracao']}", ""]
        if cena["narracao_resposta"]:
            S += ["**NARRAÇÃO — revelação**", "", f"> {cena['narracao_resposta']}", ""]
        S += ["---", ""]

    (RAIZ / "production/script.md").write_text("\n".join(S), encoding="utf8")


if __name__ == "__main__":
    main()
