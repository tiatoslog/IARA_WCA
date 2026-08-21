/**
 * Calibração da percepção de tela. SÓ LÊ — e não grava imagem nenhuma.
 *
 *     npx tsx scripts/diagnostico/calibrar-percepcao.ts [segundos]
 *
 * POR QUE ESTE ARQUIVO EXISTE. `DISTANCIA_MINIMA_RELEVANTE` decide se a IARA
 * anuncia uma mudança de tela. Um número escolhido no olho ali produz um dos
 * dois desastres: baixo demais, a IARA fala a cada piscada de cursor e o
 * operador aprende a ignorá-la; alto demais, ela cala quando a pessoa navegou
 * para outra tela. É a mesma lei que governa o limiar do corpus de POPs —
 * "número com cara de constante e sem medição por trás" é o defeito, não o
 * valor.
 *
 * O QUE ELE MEDE, em duas fases:
 *
 *   PISO DE RUÍDO   tela parada. Distância entre quadros consecutivos com
 *                   ninguém mexendo em nada: cursor piscando, relógio virando,
 *                   animação de foco. Tudo isso PRECISA ficar abaixo do limiar.
 *   SINAL           distância entre janelas diferentes. Isto PRECISA ficar
 *                   acima.
 *
 * O limiar certo é o maior valor que ainda separa as duas distribuições com
 * folga. Rode de novo em máquina com outra resolução, outro tema ou outro
 * monitor — a medição é da tela, não da técnica.
 */

import { CapturaDeQuadro, percepcaoIndisponivelPorque } from '../../servidor/braco/CapturaDeQuadro';
import {
  DISTANCIA_MINIMA_RELEVANTE,
  MIN_LINHAS_MUDADAS,
  assinaturaDeTitulo,
  distanciaDeHamming,
  hashDoQuadro,
  linhasMudadas,
} from '../../lib/percepcao';
import { prepararTextoDaTela } from '../../lib/mascara';

const SEGUNDOS = Number(process.argv[2] ?? 20);

function percentil(v: readonly number[], p: number): number {
  if (v.length === 0) return 0;
  const ordenado = [...v].sort((a, b) => a - b);
  return ordenado[Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length))];
}

function resumo(rotulo: string, v: readonly number[]): void {
  if (v.length === 0) {
    console.log(`${rotulo}: sem amostra`);
    return;
  }
  console.log(
    `${rotulo}: n=${v.length} min=${Math.min(...v)} p50=${percentil(v, 50)} ` +
      `p95=${percentil(v, 95)} max=${Math.max(...v)}`,
  );
}

/**
 * A CALIBRAÇÃO DO TEXTO — o piso de ruído do OCR.
 *
 *     npx tsx scripts/diagnostico/calibrar-percepcao.ts 20 --texto
 *
 * Existe porque `MIN_LINHAS_MUDADAS` sofre do mesmo problema que
 * `DISTANCIA_MINIMA_RELEVANTE` sofria: o OCR oscila sozinho. Ele lê "l" como
 * "I", perde a última linha, muda o espaçamento — e cada uma dessas oscilações
 * conta como linha diferente. Sem medir, o número seria um palpite, e um palpite
 * baixo faz a IARA anunciar mudança porque o OCR piscou.
 *
 * A MÉTRICA CONTA SUBSTITUIÇÃO COMO DOIS: uma linha que muda é uma que sai e uma
 * que entra. Isso não é defeito — é o que torna a contagem simétrica, para
 * mensagem que SOME contar tanto quanto mensagem que APARECE. O que a medição
 * responde é onde fica o piso nessa escala.
 */
async function calibrarTexto(captura: CapturaDeQuadro, amostras: number): Promise<void> {
  const janela = await captura.janela();
  if (!janela) {
    console.error('nenhuma janela em foco');
    return;
  }
  const primeira = await captura.texto(janela.handle);
  if (!primeira) {
    console.error('OCR indisponível nesta máquina (sem pacote de idioma?)');
    return;
  }

  console.log(
    `Amostrando o TEXTO de "${janela.processo}" ${amostras}x. NÃO mexa na tela.`,
  );

  const churn: number[] = [];
  const tempos: number[] = [];
  let anterior = prepararTextoDaTela(primeira.linhas).texto;
  for (let i = 0; i < amostras; i += 1) {
    await new Promise((r) => setTimeout(r, 1_000));
    const j = await captura.janela();
    if (!j) continue;
    const lido = await captura.texto(j.handle);
    if (!lido) continue;
    tempos.push(lido.ms);
    const atual = prepararTextoDaTela(lido.linhas).texto;
    churn.push(linhasMudadas(anterior, atual));
    anterior = atual;
  }

  console.log('');
  resumo('RUÍDO DO OCR (tela parada, linhas que entram+saem)', churn);
  console.log(
    `OCR: media=${(tempos.reduce((a, b) => a + b, 0) / Math.max(1, tempos.length)).toFixed(1)}ms ` +
      `pico=${Math.max(0, ...tempos).toFixed(1)}ms amostras=${tempos.length}`,
  );
  console.log(`limiar em vigor: MIN_LINHAS_MUDADAS = ${MIN_LINHAS_MUDADAS}`);
  const p95 = percentil(churn, 95);
  console.log(
    p95 < MIN_LINHAS_MUDADAS
      ? `OK: p95 do ruído (${p95}) fica abaixo do limiar (${MIN_LINHAS_MUDADAS})`
      : `AJUSTAR: p95 do ruído é ${p95}; o limiar precisa ficar acima disso`,
  );
}

async function principal(): Promise<void> {
  const indisponivel = percepcaoIndisponivelPorque();
  if (indisponivel) {
    console.error(`Não dá para calibrar: ${indisponivel}`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--texto')) {
    const c = new CapturaDeQuadro();
    try {
      c.iniciar();
      await calibrarTexto(c, SEGUNDOS);
    } finally {
      c.encerrar();
    }
    return;
  }

  const captura = new CapturaDeQuadro();
  captura.iniciar();

  const t0 = Date.now();
  const cpu0 = process.cpuUsage();

  const hashes: string[] = [];
  const distancias: number[] = [];
  const temposCaptura: number[] = [];
  const porJanela = new Map<string, string[]>();
  let foraDeFoco = 0;

  console.log(`Amostrando ${SEGUNDOS}s a 1 Hz. NÃO mexa na tela durante a primeira metade.`);

  for (let i = 0; i < SEGUNDOS; i += 1) {
    const janela = await captura.janela();
    if (!janela) {
      foraDeFoco += 1;
    } else {
      const q = await captura.quadro(janela.handle);
      if (!q) {
        foraDeFoco += 1;
      } else {
        const h = hashDoQuadro(q.cinza);
        temposCaptura.push(q.ms);
        const chave = `${janela.processo}|${assinaturaDeTitulo(janela.titulo)}`;
        porJanela.set(chave, [...(porJanela.get(chave) ?? []), h]);
        if (hashes.length > 0) distancias.push(distanciaDeHamming(hashes[hashes.length - 1], h));
        hashes.push(h);
        if (i === Math.floor(SEGUNDOS / 2)) {
          console.log('--- metade: agora pode trocar de janela ---');
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  captura.encerrar();

  /* O PISO DE RUÍDO é medido DENTRO de cada janela: comparar quadros de janelas
     diferentes seria misturar o ruído com o sinal, que é exatamente o que a
     calibração existe para separar. */
  const ruido: number[] = [];
  for (const lista of porJanela.values()) {
    for (let i = 1; i < lista.length; i += 1) ruido.push(distanciaDeHamming(lista[i - 1], lista[i]));
  }

  const chaves = [...porJanela.keys()];
  const sinal: number[] = [];
  for (let a = 0; a < chaves.length; a += 1) {
    for (let b = a + 1; b < chaves.length; b += 1) {
      sinal.push(
        distanciaDeHamming(porJanela.get(chaves[a])![0], porJanela.get(chaves[b])![0]),
      );
    }
  }

  const cpu = process.cpuUsage(cpu0);
  const decorrido = Date.now() - t0;

  console.log('');
  resumo('PISO DE RUÍDO (mesma janela) ', ruido);
  resumo('SINAL (janelas diferentes)   ', sinal);
  console.log('');
  console.log(`janelas distintas vistas: ${chaves.length}`);
  for (const k of chaves) console.log(`  ${k} (${porJanela.get(k)!.length} quadros)`);
  console.log('');
  console.log(
    `captura: media=${(temposCaptura.reduce((a, b) => a + b, 0) / Math.max(1, temposCaptura.length)).toFixed(1)}ms ` +
      `pico=${Math.max(0, ...temposCaptura).toFixed(1)}ms amostras=${temposCaptura.length} fora_de_foco=${foraDeFoco}`,
  );
  console.log(
    `CPU do processo Node: user=${(cpu.user / 1000).toFixed(0)}ms sys=${(cpu.system / 1000).toFixed(0)}ms ` +
      `em ${(decorrido / 1000).toFixed(1)}s (${(((cpu.user + cpu.system) / 1000 / decorrido) * 100).toFixed(1)}% de um núcleo)`,
  );
  console.log(`limiar em vigor: DISTANCIA_MINIMA_RELEVANTE = ${DISTANCIA_MINIMA_RELEVANTE}`);

  const p95Ruido = percentil(ruido, 95);
  const minSinal = sinal.length > 0 ? Math.min(...sinal) : null;
  console.log('');
  if (minSinal === null) {
    console.log('SEM SINAL: só uma janela foi vista. Rode de novo e troque de janela no meio.');
  } else if (p95Ruido < DISTANCIA_MINIMA_RELEVANTE && DISTANCIA_MINIMA_RELEVANTE <= minSinal) {
    console.log(`OK: ${p95Ruido} (p95 do ruído) < ${DISTANCIA_MINIMA_RELEVANTE} <= ${minSinal} (menor sinal)`);
  } else {
    console.log(
      `AJUSTAR: p95 do ruído=${p95Ruido}, menor sinal=${minSinal}. ` +
        `Um limiar honesto fica entre os dois — hoje está ${DISTANCIA_MINIMA_RELEVANTE}.`,
    );
  }
}

void principal();
