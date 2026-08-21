"""
render.py — monta o vídeo: tempos, quadros, legendas, mixagem.

    python project/render.py --preview     # 1 quadro por plano, rápido, para QA visual
    python project/render.py               # master 1080p + legendas
    python project/render.py --celular     # corte 9:16 com legenda queimada

MODELO DE TEMPO — a duração NÃO é arbitrada no roteiro; ela é medida.
Cada cena dura `respiro_entrada + narração + respiro_saída`. O roteiro traz
durações-alvo para dimensionar o conteúdo; quem manda é o áudio. É por isso que
trocar a voz sintética por locução humana não exige reeditar nada: os cortes,
as legendas e o trilho de progresso são recalculados a partir dos novos áudios.
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))

import identidade as ID
import pintores
from cenas import CENAS

RAIZ = Path(__file__).resolve().parents[1]
AUDIO = RAIZ / "assets/audio"
RENDER = RAIZ / "render"
PREVIEW = RAIZ / "preview"
LEGENDAS = RAIZ / "subtitles"

RESPIRO_ENTRADA = 0.35
RESPIRO_SAIDA = 0.65
PAUSA_PENSAR = 3.0          # quiz: tempo para o aluno responder antes da revelação
TRANSICAO = 0.45
TRANSICAO_ETAPA = 0.70
TAXA_AUDIO = 48000

# Cenas de fundo escuro — o rodapé inverte de cor nelas.
ESCUROS = {"abertura", "secao", "encerramento"}


# ---------------------------------------------------------------------------
# FERRAMENTAS
# ---------------------------------------------------------------------------

def _ffbin(nome: str) -> str:
    achado = shutil.which(nome)
    if achado:
        return achado
    candidato = (Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
                 / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
                 / "ffmpeg-9.0-full_build/bin" / f"{nome}.exe")
    if candidato.exists():
        return str(candidato)
    raise SystemExit(f"{nome} não encontrado. Instale com: winget install Gyan.FFmpeg")


FFMPEG = _ffbin("ffmpeg")
FFPROBE = _ffbin("ffprobe")


def duracao(caminho: Path) -> float:
    saida = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(caminho)],
        capture_output=True, text=True, check=True)
    return float(saida.stdout.strip())


# --- Fala, já limpa -------------------------------------------------------
#
# O TTS do Edge devolve ~0,4 s de silêncio na cabeça e outro tanto na cauda de
# cada arquivo. Somados aos respiros, davam 2,05 s de ar morto entre TODAS as
# cenas (medido no render anterior com `silencedetect`) — e, pior, jogavam cada
# legenda ~0,4 s à frente da voz, porque o tempo era contado a partir do início
# do arquivo e não do início da fala.
#
# Aparar na origem conserta ritmo e sincronia de uma vez só.

LIMIAR_SILENCIO = 0.006      # ~-44 dBFS
GUARDA = 0.06                # deixa um respiro mínimo, senão a fala "estala"

_pcm: dict[str, np.ndarray] = {}


def fala(cena_id: str) -> np.ndarray:
    """PCM mono 48k da narração, sem o silêncio de fábrica do TTS."""
    if cena_id in _pcm:
        return _pcm[cena_id]
    mp3 = AUDIO / f"{cena_id}.mp3"
    if not mp3.exists():
        _pcm[cena_id] = np.zeros(0, dtype=np.float32)
        return _pcm[cena_id]

    bruto = subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(mp3), "-f", "s16le", "-ac", "1",
         "-ar", str(TAXA_AUDIO), "-"],
        capture_output=True, check=True).stdout
    x = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0

    forte = np.abs(x) > LIMIAR_SILENCIO
    if forte.any():
        g = int(GUARDA * TAXA_AUDIO)
        ini = max(0, int(np.argmax(forte)) - g)
        fim = min(len(x), len(x) - int(np.argmax(forte[::-1])) + g)
        x = x[ini:fim]
    _pcm[cena_id] = x
    return x


def dur_fala(cena_id: str) -> float:
    return len(fala(cena_id)) / TAXA_AUDIO


# ---------------------------------------------------------------------------
# LINHA DO TEMPO
# ---------------------------------------------------------------------------

def montar_tempos() -> list[dict]:
    """Uma entrada por cena, com os planos já posicionados no tempo absoluto."""
    linha, t = [], 0.0

    for cena in CENAS:
        planos = pintores.planos_de(cena)

        d_fala = dur_fala(cena["id"])
        d_fala_b = dur_fala(cena["id"] + "b")

        if cena.get("duracao_fixa"):
            total = cena["duracao_fixa"]
        elif d_fala_b:
            total = RESPIRO_ENTRADA + d_fala + PAUSA_PENSAR + d_fala_b + RESPIRO_SAIDA
        else:
            total = RESPIRO_ENTRADA + d_fala + RESPIRO_SAIDA

        # Distribuição dos planos dentro da cena.
        # A condição olha para o DADO, não para o nome do arquétipo.
        #
        # Antes era `if cena["tipo"] == "quiz"`. O arquétipo foi renomeado para
        # `prova` no redesign e esta linha ficou para trás — por um render
        # inteiro as cinco questões caíram na distribuição genérica por peso, e
        # o gabarito deixou de aparecer no instante em que a voz o diz.
        # Falhou em silêncio porque nada obrigava os dois nomes a concordarem.
        #
        # `d_fala_b` é o fato real: existe uma segunda narração, logo existe uma
        # pausa de reflexão, logo o corte tem de cair onde ela termina. Renomear
        # o arquétipo não quebra mais nada.
        if d_fala_b:
            # Os planos da pergunta acompanham a leitura das alternativas; o
            # último corte cai EXATAMENTE onde a resposta começa a ser dita.
            # Revelar antes entrega o gabarito; revelar depois deixa o aluno
            # ouvindo a resposta sem ver qual é.
            fim_pergunta = RESPIRO_ENTRADA + d_fala + PAUSA_PENSAR
            n_perg = len(planos) - 1
            pesos_p = [p[1] for p in planos[:n_perg]]
            soma_p = sum(pesos_p) or 1
            acc, cortes = 0.0, []
            for w in pesos_p[:-1]:
                acc += w / soma_p * fim_pergunta
                cortes.append(acc)
            cortes.append(fim_pergunta)
        else:
            pesos = [p[1] for p in planos]
            soma = sum(pesos)
            acc, cortes = 0.0, []
            for w in pesos[:-1]:
                acc += w / soma * total
                cortes.append(acc)

        limites = [0.0] + cortes + [total]

        # Guarda permanente: onde há revelação, o último corte TEM de cair no
        # instante em que a resposta começa a ser dita. Este defeito já passou
        # despercebido por um render inteiro; agora ele para o build.
        if d_fala_b:
            esperado = RESPIRO_ENTRADA + d_fala + PAUSA_PENSAR
            if abs(limites[-2] - esperado) > 0.01:
                raise SystemExit(
                    f"{cena['id']}: a revelação cai em {limites[-2]:.2f}s, mas a "
                    f"resposta começa em {esperado:.2f}s — o gabarito apareceria "
                    f"fora de sincronia com a voz.")
        entrada = {
            "id": cena["id"], "tipo": cena["tipo"], "inicio": t, "fim": t + total,
            "duracao": total, "pop": cena.get("pop", ""),
            "narracao": cena.get("narracao", ""),
            "narracao_resposta": cena.get("narracao_resposta", ""),
            "d_fala": d_fala, "d_fala_b": d_fala_b,
            "planos": [
                {"imagem": planos[i][0], "inicio": t + limites[i], "fim": t + limites[i + 1]}
                for i in range(len(planos))
            ],
        }
        linha.append(entrada)
        t += total

    return linha


# ---------------------------------------------------------------------------
# LEGENDAS
# ---------------------------------------------------------------------------

MAX_LEGENDA = 84          # duas linhas de ~42 — o padrão de legendagem
MIN_FRAGMENTO = 24        # abaixo disso vira lampejo, não legenda
MIN_SEGUNDOS = 1.0        # tempo mínimo em tela para uma linha ser lida


def segmentar(texto: str, maximo=MAX_LEGENDA) -> list[str]:
    """Quebra por sentença; sentença longa quebra na pontuação interna.

    Nunca no meio de uma ideia — legenda cortada ao meio é pior que legenda
    longa. Os dois-pontos entram na lista de cortes porque a medição do
    primeiro render encontrou uma legenda de 109 caracteres que era uma frase
    única separada só por `:` — longa demais para caber em duas linhas e,
    na versão de celular, longa demais para caber na tela.
    """
    import re
    frases = re.split(r"(?<=[.!?])\s+", texto.strip())
    saida = []
    for f in frases:
        if len(f) <= maximo:
            saida.append(f)
            continue
        partes, atual = re.split(r"(?<=[,;:—])\s+", f), ""
        for p in partes:
            if len(atual) + len(p) + 1 <= maximo:
                atual = f"{atual} {p}".strip()
            else:
                if atual:
                    saida.append(atual)
                atual = p
        # Último recurso: parte sem pontuação que ainda estoura. Quebra em
        # palavra, que é feio, mas menos ruim que texto saindo da tela.
        while len(atual) > maximo:
            corte = atual.rfind(" ", 0, maximo)
            corte = corte if corte > 0 else maximo
            saida.append(atual[:corte])
            atual = atual[corte:].strip()
        if atual:
            saida.append(atual)

    # Funde fragmentos curtos no vizinho: "Bom trabalho." sozinho por 0,7 s
    # pisca em vez de ser lido.
    fundido: list[str] = []
    for s in saida:
        if fundido and (len(s) < MIN_FRAGMENTO
                        and len(fundido[-1]) + len(s) + 1 <= maximo):
            fundido[-1] = f"{fundido[-1]} {s}"
        else:
            fundido.append(s)
    return [s for s in fundido if s]


def legendas(linha) -> list[dict]:
    """Distribui as legendas dentro da fala, proporcional ao nº de caracteres.

    É aproximação, não alinhamento forçado: a voz neural tem ritmo regular e o
    erro fica bem abaixo do limiar perceptível para leitura.
    """
    itens = []
    for cena in linha:
        blocos = []
        if cena["narracao"]:
            blocos.append((cena["inicio"] + RESPIRO_ENTRADA, cena["d_fala"], cena["narracao"]))
        if cena["narracao_resposta"]:
            ini = cena["inicio"] + RESPIRO_ENTRADA + cena["d_fala"] + PAUSA_PENSAR
            blocos.append((ini, cena["d_fala_b"], cena["narracao_resposta"]))

        for ini, dur, txt in blocos:
            segs = segmentar(txt)
            for s, d in zip(segs, _repartir(segs, dur)):
                itens.append({"inicio": ini, "fim": ini + d, "texto": s,
                              "cena": cena["id"]})
                ini += d

    itens.sort(key=lambda x: x["inicio"])
    return itens


def _repartir(segs: list[str], dur: float) -> list[float]:
    """Reparte a duração da fala entre os segmentos, proporcional ao texto, com
    PISO de `MIN_SEGUNDOS` por segmento.

    Enchimento por níveis: quem está abaixo do piso sobe para o piso, e o que
    falta sai proporcionalmente de quem sobrou folga — repetindo até estabilizar.
    A soma é preservada, então o bloco continua terminando quando a fala termina.

    A primeira versão disto deslocava vizinhos e deixou uma legenda a 80 car/s
    (medido); repartir com piso é correto por construção, não por conserto.
    """
    n = len(segs)
    if n == 0:
        return []
    if dur <= n * MIN_SEGUNDOS:
        return [dur / n] * n          # bloco curto: divide igual, sem piso

    pesos = [max(len(s), 1) for s in segs]
    d = [dur * p / sum(pesos) for p in pesos]

    for _ in range(n):
        deficit = sum(MIN_SEGUNDOS - x for x in d if x < MIN_SEGUNDOS)
        if deficit <= 1e-9:
            break
        folga = [max(0.0, x - MIN_SEGUNDOS) for x in d]
        total_folga = sum(folga)
        if total_folga <= 1e-9:
            return [dur / n] * n
        d = [MIN_SEGUNDOS if x < MIN_SEGUNDOS
             else x - deficit * f / total_folga
             for x, f in zip(d, folga)]
    return d


def escrever_ass(itens, destino: Path, larg: int, alt: int, margem_v: int):
    """Legenda em ASS, para o corte de celular.

    Por que não `subtitles=...:force_style` sobre o SRT: sem `PlayResX/Y`
    declarados, o libass adota uma resolução de referência própria e escala o
    corpo por cima dela. Na prática, o primeiro teste saiu com letras de ~110 px
    cobrindo o quadro inteiro, e `MarginV` não deslocou nada. Declarar a
    resolução de referência é o que torna corpo e margem previsíveis.
    """
    def carimbo(s):
        h, r = divmod(max(s, 0), 3600)
        m, r = divmod(r, 60)
        seg, cs = divmod(r, 1)
        return f"{int(h)}:{int(m):02}:{int(seg):02}.{int(cs * 100):02}"

    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {larg}
PlayResY: {alt}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Iara,Segoe UI,44,&H00FFFFFF,&H00FFFFFF,&HDC231E1B,&HDC231E1B,-1,0,0,0,100,100,0,0,3,14,0,2,64,64,{margem_v},1

[Events]
Format: Layer, Start, End, Style, MarginL, MarginR, MarginV, Effect, Text
"""
    linhas = [cab]
    for it in itens:
        txt = it["texto"].replace("\n", r"\N")
        linhas.append(f"Dialogue: 0,{carimbo(it['inicio'])},{carimbo(it['fim'])},"
                      f"Iara,0,0,0,,{txt}")
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text("\n".join(linhas) + "\n", encoding="utf8")


def escrever_srt(itens, destino: Path):
    def carimbo(s):
        h, r = divmod(s, 3600)
        m, r = divmod(r, 60)
        seg, ms = divmod(r, 1)
        return f"{int(h):02}:{int(m):02}:{int(seg):02},{int(ms * 1000):03}"

    destino.parent.mkdir(parents=True, exist_ok=True)
    linhas = []
    for i, it in enumerate(itens, 1):
        linhas.append(str(i))
        linhas.append(f"{carimbo(it['inicio'])} --> {carimbo(it['fim'])}")
        linhas.append(it["texto"])
        linhas.append("")
    destino.write_text("\n".join(linhas), encoding="utf8")


# ---------------------------------------------------------------------------
# ÁUDIO
# ---------------------------------------------------------------------------

def _marcador(freq=104.0, dur=0.5, nivel=0.055) -> np.ndarray:
    """Sound design gerado por síntese — sem licença de terceiro envolvida.

    Um toque grave curto, a -28 dBFS. Marca a virada de etapa, que é onde o
    aluno precisa saber que o assunto mudou. Nada além disso: efeito que não
    ensina é ruído com orçamento.
    """
    n = int(TAXA_AUDIO * dur)
    t = np.arange(n) / TAXA_AUDIO
    env = np.exp(-t * 7.5)
    onda = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2 * t)
    return (onda * env * nivel).astype(np.float32)


def montar_audio(linha, destino: Path) -> float:
    total_n = int(np.ceil(linha[-1]["fim"] * TAXA_AUDIO)) + TAXA_AUDIO
    trilha = np.zeros(total_n, dtype=np.float32)

    def por(sinal, t):
        i = int(t * TAXA_AUDIO)
        fim = min(i + len(sinal), total_n)
        trilha[i:fim] += sinal[: fim - i]

    for cena in linha:
        v = fala(cena["id"])
        if len(v):
            por(v, cena["inicio"] + RESPIRO_ENTRADA)
        vb = fala(cena["id"] + "b")
        if len(vb):
            por(vb, cena["inicio"] + RESPIRO_ENTRADA + cena["d_fala"] + PAUSA_PENSAR)
        if cena["tipo"] == "abertura":
            # Marcador longo, de propósito. Medido no render anterior: a
            # abertura tinha 4,4 s de silêncio absoluto — um cartão mudo é
            # início sem gancho, e o espectador decide ali se continua. Uma
            # nota grave sustentada preenche o cartão sem virar "trilha".
            por(_marcador(freq=98.0, dur=1.9, nivel=0.05), cena["inicio"] + 0.05)
            por(_marcador(freq=147.0, dur=1.5, nivel=0.028), cena["inicio"] + 0.9)
        elif cena["tipo"] in ("etapa", "encerramento"):
            por(_marcador(), cena["inicio"] + 0.05)

    pico = float(np.max(np.abs(trilha))) or 1.0
    if pico > 0.708:                      # -3 dBFS
        trilha *= 0.708 / pico

    destino.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destino), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAXA_AUDIO)
        w.writeframes((np.clip(trilha, -1, 1) * 32767).astype("<i2").tobytes())
    return len(trilha) / TAXA_AUDIO


# ---------------------------------------------------------------------------
# QUADROS
# ---------------------------------------------------------------------------

class Compositor:
    """Cache (plano × legenda) → quadro pronto. O loop só copia e desenha o
    trilho de progresso, que é a única coisa que muda a cada quadro."""

    def __init__(self, linha, itens_legenda, queimar: bool):
        self.linha = linha
        self.legendas = itens_legenda
        self.queimar = queimar
        self.total = linha[-1]["fim"]
        self.cache: dict[tuple[int, int], Image.Image] = {}
        self.planos = []
        for c_i, cena in enumerate(linha):
            for p in cena["planos"]:
                self.planos.append({**p, "cena": c_i, "tipo": cena["tipo"]})

    def _legenda_em(self, t) -> int:
        for i, it in enumerate(self.legendas):
            if it["inicio"] <= t < it["fim"]:
                return i
        return -1

    def _composto(self, ip: int, il: int) -> Image.Image:
        chave = (ip, il)
        if chave in self.cache:
            return self.cache[chave]
        im = self.planos[ip]["imagem"].copy()
        if self.queimar and il >= 0:
            ID.barra_legenda(im, self.legendas[il]["texto"])
        # Teto baixo de propósito: os 145 planos já ocupam ~900 MB, e o acesso
        # é sequencial — só dois ou três compostos ficam vivos por vez. Um
        # cache grande aqui dobraria a memória sem ganhar acerto nenhum.
        if len(self.cache) > 40:
            self.cache.clear()
        self.cache[chave] = im
        return im

    def _indice_plano(self, t) -> int:
        lo, hi = 0, len(self.planos) - 1
        while lo < hi:
            meio = (lo + hi + 1) // 2
            if self.planos[meio]["inicio"] <= t:
                lo = meio
            else:
                hi = meio - 1
        return lo

    def quadro(self, t: float) -> Image.Image:
        ip = self._indice_plano(t)
        il = self._legenda_em(t)
        im = self._composto(ip, il)

        p = self.planos[ip]
        trans = TRANSICAO_ETAPA if p["tipo"] == "secao" else TRANSICAO
        if ip > 0 and t - p["inicio"] < trans:
            alfa = ID.suavizar((t - p["inicio"]) / trans)
            anterior = self._composto(ip - 1, self._legenda_em(max(0.0, p["inicio"] - 0.01)))
            im = Image.blend(anterior, im, alfa)
        else:
            im = im.copy()

        # O rodapé é desenhado AQUI, por quadro, porque carrega o avanço — que
        # muda a cada frame. Gravá-lo no plano congelaria o progresso.
        ID.rodape(im, t / self.total, escuro=p["tipo"] in ESCUROS)
        return im


def gerar_video(linha, itens_legenda, destino: Path, queimar=False,
                vertical=False, preview=False):
    comp = Compositor(linha, itens_legenda, queimar)
    total = comp.total
    n_quadros = int(total * ID.FPS)

    destino.parent.mkdir(parents=True, exist_ok=True)

    cmd = [FFMPEG, "-y", "-v", "error", "-stats",
           "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{ID.L}x{ID.A}", "-r", str(ID.FPS), "-i", "-",
           "-i", str(RENDER / "narracao.wav")]
    if vertical:
        # 1080×1080, NÃO 9:16.
        #
        # O primeiro corte vertical foi feito em 9:16 e ficou inutilizável: o
        # quadro 16:9 encaixotado ocupava 32% da altura e sobravam 1313 px de
        # tarja — no telefone, o texto saía MENOR do que se a pessoa assistisse
        # o master deitado, que é o oposto do objetivo. Recortar as laterais
        # para encher a tela também não serve: comeria as colunas da planilha,
        # que SÃO o conteúdo do treinamento.
        #
        # O quadrado é o formato de retrato que desperdiça menos aqui: o vídeo
        # entra em largura cheia e a faixa que sobra embaixo é usada — é onde a
        # legenda ganha lugar próprio, em vez de cobrir o cartão de lacuna,
        # como acontecia quando ela era queimada dentro do quadro 16:9.
        alt_video = round(1080 * ID.A / ID.L / 2) * 2      # 608
        topo = 110
        ass = LEGENDAS / "IT-ADMLUFT-001-celular.ass"
        # MarginV medido da base: 1080 - (110 + 608) = 362 px de faixa livre;
        # 150 põe a legenda no meio dela, sem encostar no vídeo nem na borda.
        escrever_ass(itens_legenda, ass, 1080, 1080, margem_v=150)
        caminho = ass.as_posix().replace(":", r"\:")
        cmd += ["-vf",
                f"scale=1080:{alt_video},"
                f"pad=1080:1080:0:{topo}:0x0E3A47,"
                f"ass='{caminho}'"]
    cmd += ["-c:v", "libx264", "-preset", "medium" if not preview else "veryfast",
            "-crf", "20" if not preview else "26", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k",
            # ORDEM IMPORTA, e custou uma regressão medida: com o `pan` DEPOIS
            # do `loudnorm`, o material saiu a -13,1 LUFS em vez de -16. O
            # R128 soma os canais, então duplicar o mono em L/R soma +3 dB
            # sobre o que o normalizador tinha acabado de medir. Estéreo
            # primeiro, normaliza o sinal final, e só então reamostra —
            # `loudnorm` trabalha a 192 kHz e, sem `aresample` ao fim, o mux
            # herdava 96 kHz, taxa que alguns players de LMS recusam.
            "-af", "pan=stereo|c0=c0|c1=c0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
            "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", "-shortest", str(destino)]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n_quadros):
        proc.stdin.write(comp.quadro(i / ID.FPS).tobytes())
        if i % 300 == 0:
            pct = 100 * i / n_quadros
            print(f"  quadro {i}/{n_quadros}  {pct:5.1f}%", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg falhou")


def gerar_storyboard(linha):
    """Um PNG por plano — é o que se valida ANTES de renderizar (§24)."""
    destino = RAIZ / "production/storyboard"
    destino.mkdir(parents=True, exist_ok=True)
    for antigo in destino.glob("*.png"):
        antigo.unlink()
    n = 0
    for cena in linha:
        for j, p in enumerate(cena["planos"]):
            n += 1
            im = p["imagem"].copy()
            ID.rodape(im, p["inicio"] / linha[-1]["fim"],
                      escuro=cena["tipo"] in ESCUROS)
            sufixo = "" if len(cena["planos"]) == 1 else f"-{j + 1}"
            im.resize((960, 540), Image.LANCZOS).save(
                destino / f"{n:03d}_{cena['id']}{sufixo}.png")
    print(f"storyboard: {n} quadros em production/storyboard/")
    return n


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--celular", action="store_true")
    ap.add_argument("--storyboard", action="store_true")
    args = ap.parse_args()

    print("montando linha do tempo...")
    linha = montar_tempos()
    total = linha[-1]["fim"]
    print(f"  {len(linha)} cenas, {sum(len(c['planos']) for c in linha)} planos, "
          f"{total:.1f}s = {int(total // 60)}min {int(total % 60):02d}s")

    itens = legendas(linha)
    escrever_srt(itens, LEGENDAS / "IT-ADMLUFT-001-pt-BR.srt")
    print(f"  {len(itens)} legendas")

    RENDER.mkdir(parents=True, exist_ok=True)
    (RENDER / "tempos.json").write_text(json.dumps(
        [{k: v for k, v in c.items() if k != "planos"} for c in linha],
        ensure_ascii=False, indent=2), encoding="utf8")

    if args.storyboard:
        gerar_storyboard(linha)
        return

    print("montando áudio...")
    d_audio = montar_audio(linha, RENDER / "narracao.wav")
    print(f"  trilha: {d_audio:.1f}s")

    if args.celular:
        # `queimar=False`: a legenda do corte vertical é gravada pelo ffmpeg,
        # NA FAIXA DE BAIXO. Queimá-la no quadro 16:9 a colocava por cima do
        # cartão de lacuna — defeito visto no primeiro corte de celular.
        print("render 4:5 para celular...")
        gerar_video(linha, itens, RENDER / "mobile.mp4", queimar=False, vertical=True)
    elif args.preview:
        print("render preview...")
        gerar_video(linha, itens, RENDER / "preview.mp4", preview=True)
    else:
        print("render master 1080p...")
        gerar_video(linha, itens, RENDER / "final.mp4")

    print("pronto.")


if __name__ == "__main__":
    main()
