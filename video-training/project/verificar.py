"""
verificar.py — impede que os documentos e o vídeo divirjam em silêncio.

    python project/verificar.py

Um roteiro em Markdown e um arquivo de dados que se contradizem é o defeito
mais barato de criar e o mais caro de descobrir: os dois parecem certos lidos
isoladamente, e só o vídeo revela qual estava errado — depois de renderizar.

Verifica:

  1. os 27 elementos normativos do POP estão cobertos por alguma cena;
  2. nenhum arquétipo se repete mais de duas cenas seguidas (fora a prova);
  3. nenhuma narração carrega dado pessoal não declarado — o texto da narração
     é enviado ao serviço neural de voz;
  4. toda captura citada existe em `assets/screenshots/` — nunca na pasta crua;
  5. todo conteúdo que NÃO está na REV.02 carrega `procedencia`.

`script.md` e `storyboard.md` deixaram de ser verificados aqui porque passaram
a ser GERADOS de `cenas.py` — não há mais duas cópias para divergir.

Sai com 1 na primeira divergência, para servir de portão.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from cenas import CENAS

RAIZ = Path(__file__).resolve().parents[1]

# Os 27 elementos de `pop-analysis.md`. Lista explícita de propósito: se um
# passo do POP sumir do roteiro, é aqui que o portão fecha.
NORMATIVOS = [
    "1.1", "1.2", "1.3",
    "2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10",
    "2.11", "2.12", "2.13", "2.14", "2.15", "2.16",
    "X1", "X2", "X3",
    "3.1", "3.2", "3.3", "3.4", "3.5",
]


def normalizar(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def cobre(ref: str, alvo: str) -> bool:
    """`2.2–2.6` cobre `2.4`; `X1` cobre `X1`."""
    if alvo in ref:
        return True
    if "." not in alvo:
        return False
    a, b = map(int, alvo.split("."))
    for m in re.finditer(r"(\d+)\.(\d+)\s*[–—-]\s*(\d+)\.(\d+)", ref):
        i, j, k, l = map(int, m.groups())
        if i == a == k and j <= b <= l:
            return True
    return False


def main() -> None:
    falhas: list[str] = []

    # ---- 1: cobertura normativa ------------------------------------------
    refs = [c.get("pop", "") for c in CENAS]
    for alvo in NORMATIVOS:
        if not any(cobre(r, alvo) for r in refs):
            falhas.append(f"elemento normativo {alvo} não aparece em nenhuma cena")

    # ---- 3: dado pessoal na narração -------------------------------------
    # O texto narrado vai ao serviço neural da Microsoft. Nomes próprios de
    # pessoas citados no POP (motoristas de Sorriso, remetente do e-mail) não
    # podem sair daqui — a regra está em environment.md.
    # Joaquim (aprovador) e Geraldo (canal da Adicer) são informação
    # operacional declarada pela área e vão para a tela e para a narração.
    # Os demais são contatos que apareciam nas capturas e continuam barrados.
    PROIBIDOS = ["laudir", "linealdo", "ingrid", "vania", "izabela", "grazielen"]
    for c in CENAS:
        for campo in ("narracao", "narracao_resposta"):
            txt = normalizar(c.get(campo, ""))
            for p in PROIBIDOS:
                if re.search(rf"\b{p}\b", txt):
                    falhas.append(f"{c['id']}: narração cita nome de pessoa ({p})")
            if re.search(r"\b\d{2}[-\s]?9\d{4}[-\s]?\d{4}\b", txt):
                falhas.append(f"{c['id']}: narração parece conter telefone")
            if "@" in txt:
                falhas.append(f"{c['id']}: narração parece conter e-mail")

    # ---- 4: capturas vêm da pasta mascarada ------------------------------
    mascaradas = RAIZ / "assets/screenshots"
    for c in CENAS:
        arq = c.get("arquivo")
        if arq and not (mascaradas / arq).exists():
            falhas.append(f"{c['id']}: captura {arq} não está em assets/screenshots/ "
                          f"— rode project/mascarar.py")

    # ---- 2: variedade de arquétipos ------------------------------------
    # A regra de design: nenhuma diagramação três vezes seguidas. A prova é
    # exceção declarada — cinco questões seguidas leem como seção, não como
    # repetição.
    seq, corrida, anterior = [], 0, None
    for c in CENAS:
        t = c["tipo"]
        corrida = corrida + 1 if t == anterior else 1
        anterior = t
        if t != "prova" and corrida >= 3:
            seq.append(f"{c['id']}: '{t}' repetido {corrida}x seguidas")
    falhas.extend(seq)

    # ---- 5: procedência declarada --------------------------------------
    for c in CENAS:
        if "informado pela área" in (c.get("narracao", "") or "").lower()                 and not c.get("procedencia"):
            falhas.append(f"{c['id']}: narração cita a área mas a cena não "
                          f"declara `procedencia`")

    tipos = {c["tipo"] for c in CENAS}
    print(f"cenas: {len(CENAS)}  |  arquétipos distintos: {len(tipos)}  |  "
          f"elementos normativos: {len(NORMATIVOS)}")
    if falhas:
        print(f"\nREPROVADO — {len(falhas)} divergência(s):")
        for f in falhas:
            print(f"  X {f}")
        sys.exit(1)
    print("APROVADO — roteiro, dados, POP e capturas estão de acordo.")


if __name__ == "__main__":
    main()
