import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from PIL import Image, ImageDraw
import identidade as ID

out = Path(__file__).parents[1] / "preview"

# 1. Abertura
im = ID.quadro(ID.PETROLEO)
d = ImageDraw.Draw(im)
ID.texto(d, (ID.L/2, ID.A/2 - 70), "IARA LEARNING STUDIO", "bold", 92, ID.SUPERFICIE, "mm", entreletra=4)
d.rectangle([ID.L/2-150, ID.A/2+6, ID.L/2+150, ID.A/2+10], fill=ID.ACENTO)
ID.texto(d, (ID.L/2, ID.A/2 + 62), "TREINAMENTO OPERACIONAL", "semilight", 38, (168,196,205), "mm", entreletra=6)
ID.texto(d, (ID.L/2, ID.A/2 + 150), "IT-ADMLUFT-001  ·  AGENDAMENTO DE COLETA  ·  REV.:02", "regular", 27, (120,158,170), "mm")
im.save(out/"prova-01-abertura.png")

# 2. Faixa de etapa
im = ID.quadro()
ID.faixa_etapa(im, "2", "PREENCHIMENTO DA PLANILHA E AGENDAMENTO")
im.save(out/"prova-02-etapa.png")

# 3. Cartao de atencao + rodape lacuna
im = ID.quadro()
ID.barra_marca(im, "ETAPA 2", "PASSO 16 / 16")
x0,y0,x1,y1 = ID.area_conteudo()
ID.cartao(im, "atencao", "Sempre até 1 dia antes da coleta",
          ["A OCI é enviada para assinatura pelo Autentique.",
           "Assinada, o link vai ao motorista e ao posto pelo SMBOT."],
          caixa=(x0, y0, x1, y1-150))
ID.rodape_lacuna(im, "Como operar o Autentique e o SMBOT é assunto da IT-ADMLUFT-002")
ID.rodape(im, 0.94)
im.save(out/"prova-03-atencao.png")

# 4. Captura com veu + foco + cursor
im = ID.quadro()
ID.barra_marca(im, "ETAPA 2", "PASSO 02 / 16")
d = ImageDraw.Draw(im)
ID.texto(d, (ID.MARGEM, ID.ALT_BARRA + 44), "Lance o número da OCI", "bold", 58, ID.TINTA, "la")
cap = Image.open(out.parent/"assets/screenshots/242b460e7efd.png")
px, py, esc = ID.captura(im, cap, caixa_destino=(ID.MARGEM, ID.ALT_BARRA+150, ID.L-ID.MARGEM, ID.A-ID.ALT_RODAPE-130))
# coluna OCI = x 290..352 na captura
fx0, fx1 = px + 290*esc, px + 352*esc
fy0, fy1 = py + 0*esc, py + cap.height*esc
ID.veu(im, 0.55, excecao=(fx0-8, fy0-8, fx1+8, fy1+8))
d = ImageDraw.Draw(im)
ID.foco(d, (fx0-8, fy0-8, fx1+8, fy1+8))
ID.texto(d, ((fx0+fx1)/2, fy0-34), "Nº DA OCI", "bold", 26, ID.ACENTO, "mm", entreletra=2)
ID.cursor(im, fx1+30, fy0+90, clique=0.45)
ID.barra_legenda(im, "Lance a OCI preenchendo cinco campos, nesta ordem.")
ID.rodape(im, 0.22)
im.save(out/"prova-04-captura.png")
print("ok 4 quadros")
