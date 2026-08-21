/**
 * Calibração da ADERÊNCIA — texto observado × `ParadaEsperada`. SÓ LÊ.
 *
 *     npx tsx scripts/diagnostico/calibrar-aderencia.ts
 *
 * POR QUE ELE EXISTE. `PROPORCAO_MINIMA` decide se a IARA diz "você está na tela
 * desta etapa" ou "essa tela não é a desta etapa". Um número escolhido no olho
 * ali produz os dois desastres de sempre: baixo demais, ela afirma reconhecer
 * qualquer tela; alto demais, ela nunca reconhece nenhuma e o recurso não existe
 * na prática.
 *
 * O QUE ELE MEDE, sobre os 11 POPs reais:
 *
 *   SINAL    a parada contra o texto da PRÓPRIA parada, DEGRADADO — só uma
 *            fração das palavras sobrevive, e entram palavras de outra tela
 *            como ruído. É o proxy do que uma tela mostra: parte do que o POP
 *            descreve, mais menu, cabeçalho e rodapé que ele não descreve.
 *   VIZINHA  a parada contra o texto da parada SEGUINTE do mesmo POP. É o caso
 *            difícil — telas vizinhas do mesmo procedimento se parecem.
 *   ALHEIA   a parada contra uma parada de OUTRO procedimento. Precisa ficar
 *            claramente abaixo do limiar.
 *
 * O QUE ELE **NÃO** MEDE, e isto precisa ficar dito: nada aqui viu o GW. O texto
 * do POP é um proxy da tela, e é um proxy OTIMISTA — ele foi escrito olhando
 * para a tela. Numa tela real a proporção tende a cair. É por isso que a leitura
 * errada custa uma frase e nunca um avanço.
 */

import { baseProcedimentos } from '../../servidor/nucleo/BaseProcedimentos';
import { descreverParada, podeGuiar, posicoes } from '../../lib/procedimento';
import {
  MARGEM_MINIMA,
  PROPORCAO_MINIMA,
  aderenciaAParada,
  compararComOPercurso,
} from '../../lib/aderencia';

/** Fração das palavras do POP que a tela de fato mostra. Pessimista de propósito. */
const SOBREVIVENCIA = 0.6;

/**
 * O RUÍDO QUE UMA TELA ACRESCENTA — e de onde ele NÃO pode vir.
 *
 * A primeira versão desta calibração tirava o ruído do texto da parada ALHEIA, a
 * mesma contra a qual a comparação era medida depois. Isso inflava a aderência
 * alheia por construção: o "ruído" era literalmente o vocabulário do alvo que
 * deveria ficar abaixo do limiar. A medição saiu com as distribuições
 * sobrepostas e a culpa era do medidor.
 *
 * O ruído de uma tela de verdade é cromo de janela: menu, usuário logado,
 * botões de barra, rodapé. Nada disso vem de outro procedimento.
 */
const CROMO_DE_TELA =
  'arquivo editar exibir favoritos ferramentas ajuda usuario logado sair inicio ' +
  'pesquisar filtro limpar novo salvar cancelar voltar avancar imprimir exportar ' +
  'relatorios cadastro configuracoes janela minimizar maximizar fechar';

/** Gerador determinístico: a mesma calibração duas vezes dá o mesmo número. */
function sorteio(semente: number): () => number {
  let s = (semente % 2147483647) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * O texto que uma tela MOSTRARIA, a partir do que o POP descreve.
 *
 * Degrada de dois jeitos ao mesmo tempo, porque a tela real erra nos dois
 * sentidos: ela mostra MENOS do que o POP descreve (o POP explica, a tela só
 * rotula) e mostra MAIS coisas que o POP ignora (menu, usuário logado, rodapé).
 */
function telaSimulada(instrucao: string, semente: number): string {
  const r = sorteio(semente);
  const palavras = instrucao.split(/\s+/).filter(Boolean);
  const sobreviventes = palavras.filter(() => r() < SOBREVIVENCIA);
  return [...sobreviventes, CROMO_DE_TELA].join(' ');
}

function percentil(v: readonly number[], p: number): number {
  if (v.length === 0) return 0;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))];
}

function resumo(rotulo: string, v: readonly number[]): void {
  if (v.length === 0) {
    console.log(`${rotulo}: sem amostra`);
    return;
  }
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  console.log(
    `${rotulo}: n=${v.length} min=${Math.min(...v).toFixed(2)} p05=${percentil(v, 5).toFixed(2)} ` +
      `p50=${percentil(v, 50).toFixed(2)} p95=${percentil(v, 95).toFixed(2)} ` +
      `max=${Math.max(...v).toFixed(2)} media=${media.toFixed(2)}`,
  );
}

function principal(): void {
  const pops = baseProcedimentos.catalogo().filter(podeGuiar);
  if (pops.length < 2) {
    console.error('preciso de pelo menos dois POPs conduzíveis: rode `npm run pops`');
    process.exitCode = 1;
    return;
  }

  /* A VARREDURA. O erro que importa nao e simetrico: dizer "essa tela nao e a
     desta etapa" a quem esta na tela certa custa a confianca do operador; deixar
     de reconhecer custa uma frase a menos. Entao o que se minimiza aqui e o
     FALSO DESVIO sobre a propria tela, sem deixar a tela alheia passar. */
  const varredura: { limiar: number; naEtapa: number; desvio: number; indef: number; alheiaPassa: number }[] = [];

  const sinal: number[] = [];
  const vizinha: number[] = [];
  const alheia: number[] = [];
  const leituras = new Map<string, number>();
  let semTermos = 0;
  let semente = 1;
  const amostras: { parada: ReturnType<typeof descreverParada>; proxima: ReturnType<typeof descreverParada> | null; doOutro: ReturnType<typeof descreverParada>; tela: string }[] = [];

  for (const p of pops) {
    const todas = posicoes(p);
    const outro = pops.find((x) => x.codigo !== p.codigo)!;
    const paradasDoOutro = posicoes(outro);

    for (const pos of todas) {
      const parada = descreverParada(p, pos);
      if (parada.instrucao.trim().length < 20) continue;

      const proxima = todas[pos.indice] ? descreverParada(p, todas[pos.indice]) : null;
      const doOutro = descreverParada(
        outro,
        paradasDoOutro[pos.indice % paradasDoOutro.length],
      );

      semente += 1;
      const tela = telaSimulada(parada.instrucao, semente);

      const a = aderenciaAParada(parada, tela);
      if (a.esperados.length === 0) {
        semTermos += 1;
        continue;
      }
      sinal.push(a.proporcao);
      if (proxima) vizinha.push(aderenciaAParada(proxima, tela).proporcao);
      alheia.push(aderenciaAParada(doOutro, tela).proporcao);

      const c = compararComOPercurso(parada, proxima, tela);
      leituras.set(c.leitura, (leituras.get(c.leitura) ?? 0) + 1);
      amostras.push({ parada, proxima, doOutro, tela });
    }
  }

  console.log(`POPs conduzíveis: ${pops.length}; paradas com termos: ${sinal.length}`);
  if (semTermos > 0) console.log(`paradas sem termo nenhum (ignoradas): ${semTermos}`);
  console.log('');
  resumo('SINAL   (própria parada, tela degradada)', sinal);
  resumo('VIZINHA (parada seguinte do mesmo POP)  ', vizinha);
  resumo('ALHEIA  (parada de outro procedimento)  ', alheia);
  console.log('');
  console.log('leitura que sairia, sobre a tela da PRÓPRIA parada:');
  for (const [k, n] of [...leituras.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${n} (${((n / sinal.length) * 100).toFixed(0)}%)`);
  }
  console.log('');
  console.log(`limiares em vigor: PROPORCAO_MINIMA=${PROPORCAO_MINIMA} MARGEM_MINIMA=${MARGEM_MINIMA}`);

  console.log('');
  console.log('varredura do limiar (sobre a tela da PROPRIA parada / da alheia):');
  console.log('  limiar  na_etapa  desvio_falso  indefinida  alheia_reconhecida');
  for (const limiar of [0.15, 0.2, 0.25, 0.3, 0.34, 0.4, 0.5]) {
    let naEtapa = 0;
    let desvio = 0;
    let indef = 0;
    let alheiaPassa = 0;
    for (const am of amostras) {
      const c = compararComOPercurso(am.parada, am.proxima, am.tela, { proporcaoMinima: limiar });
      if (c.leitura === 'na_etapa') naEtapa += 1;
      else if (c.leitura === 'fora_do_percurso') desvio += 1;
      else indef += 1;
      /* A tela alheia sendo reconhecida como "a parada dela" e o falso positivo
         que importa: a IARA afirmando que a pessoa esta numa etapa de outro POP. */
      const cAlheia = compararComOPercurso(am.doOutro, null, am.tela, { proporcaoMinima: limiar });
      if (cAlheia.leitura === 'na_etapa') alheiaPassa += 1;
    }
    varredura.push({ limiar, naEtapa, desvio, indef, alheiaPassa });
    const pct = (n: number) => `${((n / amostras.length) * 100).toFixed(0)}%`.padStart(11);
    console.log(
      `  ${limiar.toFixed(2).padStart(6)}${pct(naEtapa)}${pct(desvio)}${pct(indef)}${pct(alheiaPassa)}`,
    );
  }
  console.log('');

  /**
   * O VEREDITO MUDOU DE CRITÉRIO, e a mudança é a lição desta calibração.
   *
   * A primeira versão exigia separação total — `alheia_p95 < limiar <= sinal_p05`
   * —, do jeito que a calibração do corpus de POPs funciona. Aqui as caudas se
   * tocam em 0,20 e esse critério imprimiria "AJUSTAR" para sempre, para
   * qualquer valor, porque o número que ele pede não existe.
   *
   * Quando as distribuições se sobrepõem, a pergunta deixa de ser "onde elas se
   * separam?" e passa a ser "qual erro custa mais?". O veredito abaixo é sobre
   * isso: o limiar em vigor está no joelho, ou passou dele?
   */
  const noLimiar = varredura.find((v) => Math.abs(v.limiar - PROPORCAO_MINIMA) < 0.001);
  const melhor = varredura.reduce((a, b) =>
    /* O joelho: menor soma de erro falso, com desempate no menor limiar. Os dois
       erros entram com o mesmo peso aqui, e a decisão final é humana — o que o
       script faz é mostrar onde a troca deixa de valer a pena. */
    b.desvio + b.alheiaPassa < a.desvio + a.alheiaPassa ? b : a,
  );
  console.log(
    noLimiar
      ? `limiar ${PROPORCAO_MINIMA}: ${((noLimiar.desvio / amostras.length) * 100).toFixed(0)}% de ` +
          `desvio falso, ${((noLimiar.alheiaPassa / amostras.length) * 100).toFixed(0)}% de tela ` +
          `alheia reconhecida. Menor erro somado na varredura: ${melhor.limiar}`
      : `limiar ${PROPORCAO_MINIMA} não está na varredura — acrescente-o para poder comparar`,
  );
  console.log(
    `caudas: sinal p05=${percentil(sinal, 5).toFixed(2)} e alheia p95=${percentil(alheia, 95).toFixed(2)} ` +
      'se tocam — não existe limiar que separe as distribuições inteiras',
  );
}

principal();
