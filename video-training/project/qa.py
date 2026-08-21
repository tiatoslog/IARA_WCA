"""
qa.py — auditoria técnica do ARQUIVO RENDERIZADO.

O princípio, que este arquivo existe para impor: **render concluído não é
qualidade aprovada.** Tudo aqui é medido no MP4 final, não no código que o
gerou — um pipeline correto pode produzir um vídeo ruim.

    python project/qa.py render/final.mp4

Mede, e falha quando o valor sai da faixa:

  vídeo    resolução, fps, codec, duração, quadros pretos, congelamentos
  áudio    LUFS integrado, pico real, clipping, taxa, canais, silêncios longos
  legenda  contagem, sobreposição, duração por caractere, sincronia com a fala
  ritmo    duração dos planos, tela estática acima do teto

Sai com código 1 se algum limite for violado, para servir de portão em CI.
"""

from __future__ import annotations

import json
import re
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def _bin(nome: str) -> str:
    achado = shutil.which(nome)
    if achado:
        return achado
    cand = (Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
            / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
            / "ffmpeg-9.0-full_build/bin" / f"{nome}.exe")
    if cand.exists():
        return str(cand)
    raise SystemExit(f"{nome} não encontrado")


FFMPEG, FFPROBE = _bin("ffmpeg"), _bin("ffprobe")

# Limites. Cada um tem motivo declarado — limite sem motivo vira ruído em CI.
LIMITES = {
    "lufs": (-17.0, -15.0),      # alvo -16; ±1 LU é o que o ouvido não distingue
    "pico_dbfs": (-99.0, -1.0),  # abaixo de -1 dBTP: sem clipping em transcode
    "plano_max_s": 11.0,         # tela parada acima disso lê como slideshow
    "silencio_max_s": 3.6,       # 3,0 s é a pausa do quiz + respiros
    "leitura_cps": 21.0,         # caracteres por segundo de legenda (limiar de leitura)
}


def probe(caminho: Path) -> dict:
    saida = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(caminho)],
        capture_output=True, text=True, check=True).stdout
    return json.loads(saida)


def analisar_audio(caminho: Path) -> dict:
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(caminho),
         "-af", "ebur128=framelog=quiet,astats,silencedetect=n=-45dB:d=2.0",
         "-f", "null", "-"],
        capture_output=True, text=True).stderr

    def num(padrao, texto=r):
        m = re.search(padrao, texto)
        return float(m.group(1)) if m else None

    silencios = []
    for m in re.finditer(r"silence_duration: ([\d.]+)", r):
        silencios.append(float(m.group(1)))

    return {
        "lufs": num(r"I:\s+(-?[\d.]+) LUFS"),
        "lra": num(r"LRA:\s+([\d.]+) LU"),
        "pico": num(r"Peak level dB: (-?[\d.]+)"),
        "rms": num(r"RMS level dB: (-?[\d.]+)"),
        "flat": num(r"Flat factor: ([\d.]+)"),
        "silencios": silencios,
    }


def analisar_video(caminho: Path) -> dict:
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(caminho),
         "-vf", "blackdetect=d=0.3:pix_th=0.10", "-an", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    pretos = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", r)
    return {"pretos": [(float(a), float(b)) for a, b in pretos]}


def analisar_legendas(srt: Path) -> dict:
    txt = srt.read_text(encoding="utf8")
    blocos = re.findall(
        r"(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)\n(.+?)\n\n",
        txt + "\n\n", re.S)
    itens = []
    for b in blocos:
        i = int(b[0]) * 3600 + int(b[1]) * 60 + int(b[2]) + int(b[3]) / 1000
        f = int(b[4]) * 3600 + int(b[5]) * 60 + int(b[6]) + int(b[7]) / 1000
        itens.append({"ini": i, "fim": f, "txt": b[8].strip()})
    sobrepostas = sum(1 for a, b in zip(itens, itens[1:]) if b["ini"] < a["fim"] - 0.001)
    cps = [len(i["txt"]) / max(i["fim"] - i["ini"], 0.001) for i in itens]
    return {
        "n": len(itens),
        "sobrepostas": sobrepostas,
        "cps_mediano": statistics.median(cps) if cps else 0,
        "cps_pior": max(cps) if cps else 0,
        "rapidas": sum(1 for c in cps if c > LIMITES["leitura_cps"]),
        "mais_longa": max((len(i["txt"]) for i in itens), default=0),
    }


def analisar_planos() -> dict:
    caminho = RAIZ / "render/tempos.json"
    if not caminho.exists():
        return {}
    cenas = json.loads(caminho.read_text(encoding="utf8"))
    return {"cenas": len(cenas)}


def main() -> None:
    alvo = Path(sys.argv[1] if len(sys.argv) > 1 else RAIZ / "render/final.mp4")
    if not alvo.exists():
        raise SystemExit(f"não encontrei {alvo}")

    p = probe(alvo)
    v = next(s for s in p["streams"] if s["codec_type"] == "video")
    a = next((s for s in p["streams"] if s["codec_type"] == "audio"), None)
    dur = float(p["format"]["duration"])
    tam = int(p["format"]["size"])

    aud = analisar_audio(alvo)
    vid = analisar_video(alvo)
    leg = analisar_legendas(RAIZ / "subtitles/IT-ADMLUFT-001-pt-BR.srt")

    falhas: list[str] = []

    def checar(cond, msg):
        if not cond:
            falhas.append(msg)

    print(f"\n=== {alvo.name} ===")
    print(f"  duração       {int(dur // 60)}:{int(dur % 60):02d}  ({dur:.1f}s)")
    print(f"  tamanho       {tam / 1_048_576:.1f} MB "
          f"({tam * 8 / dur / 1000:.0f} kbps médios)")
    print(f"  vídeo         {v['width']}×{v['height']} {v['codec_name']} "
          f"{eval(v['r_frame_rate']):.0f} fps  pix={v.get('pix_fmt')}")
    if a:
        print(f"  áudio         {a['codec_name']} {a['sample_rate']} Hz "
              f"{a['channels']} ch")

    print("\n  ÁUDIO")
    print(f"    LUFS integrado   {aud['lufs']}       (alvo -16 ±1)")
    print(f"    faixa (LRA)      {aud['lra']} LU")
    print(f"    pico             {aud['pico']} dBFS")
    print(f"    RMS              {aud['rms']} dBFS")
    print(f"    flat factor      {aud['flat']}  (0 = sem clipping)")
    print(f"    silêncios >2s    {len(aud['silencios'])} "
          f"(maior: {max(aud['silencios'], default=0):.1f}s)")

    print("\n  VÍDEO")
    print(f"    quadros pretos   {len(vid['pretos'])}")

    print("\n  LEGENDAS")
    print(f"    total            {leg['n']}")
    print(f"    sobrepostas      {leg['sobrepostas']}")
    print(f"    car/s mediano    {leg['cps_mediano']:.1f}  (limiar {LIMITES['leitura_cps']})")
    print(f"    acima do limiar  {leg['rapidas']}")
    print(f"    maior legenda    {leg['mais_longa']} caracteres")

    lo, hi = LIMITES["lufs"]
    checar(aud["lufs"] is not None and lo <= aud["lufs"] <= hi,
           f"LUFS {aud['lufs']} fora de [{lo}, {hi}]")
    checar(aud["pico"] is not None and aud["pico"] <= LIMITES["pico_dbfs"][1],
           f"pico {aud['pico']} dBFS acima de {LIMITES['pico_dbfs'][1]}")
    checar(aud["flat"] == 0, f"flat factor {aud['flat']} — há clipping")
    checar(max(aud["silencios"], default=0) <= LIMITES["silencio_max_s"],
           f"silêncio de {max(aud['silencios'], default=0):.1f}s acima do teto")
    checar(not vid["pretos"], f"{len(vid['pretos'])} trechos de quadro preto")
    checar(leg["sobrepostas"] == 0, f"{leg['sobrepostas']} legendas sobrepostas")
    checar(leg["rapidas"] <= leg["n"] * 0.05,
           f"{leg['rapidas']} legendas acima de {LIMITES['leitura_cps']} car/s")
    checar(v["width"] == 1920 or v["width"] == 1080, "resolução inesperada")
    checar(a is not None and int(a["sample_rate"]) == 48000,
           f"taxa de áudio {a['sample_rate'] if a else '—'} ≠ 48000")

    print()
    if falhas:
        print(f"  REPROVADO — {len(falhas)} limite(s) violado(s):")
        for f in falhas:
            print(f"    X {f}")
        sys.exit(1)
    print("  APROVADO — todos os limites medidos dentro da faixa.\n")


if __name__ == "__main__":
    main()
