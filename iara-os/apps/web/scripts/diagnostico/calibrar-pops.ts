/**
 * Calibração do limiar de similaridade da base de procedimentos. SÓ LÊ.
 *
 * Existe pela mesma razão que a bateria que mediu o `0.3` do `RagHistorico`: um
 * limiar escolhido no olho é um número com cara de constante e sem medição por
 * trás. Aqui ele é varrido contra dois conjuntos:
 *
 *   GABARITO — perguntas reais de operação, cada uma com o POP que DEVE achar.
 *   RUÍDO    — perguntas fora do domínio, que NÃO podem achar nada.
 *
 * O limiar certo é o maior valor que ainda acerta todo o gabarito, com folga
 * sobre o piso em que o ruído para de casar. Rode de novo quando o corpus
 * crescer — um valor medido em 11 documentos não vale para 60.
 *
 *   npx tsx scripts/diagnostico/calibrar-pops.ts
 */

import {
  BaseProcedimentos,
  LIMIAR_DE_SIMILARIDADE,
} from '../../servidor/nucleo/BaseProcedimentos';

const GABARITO: ReadonlyArray<readonly [string, string]> = [
  ['como faço o agendamento de uma coleta', 'IT-ADMLUFT-001'],
  ['preciso incluir a OCI na planilha de agendamento', 'IT-ADMLUFT-001'],
  ['como criar uma OCI no sistema', 'IT-ADMLUFT-002'],
  ['onde consulto a ordem de coleta', 'IT-ADMLUFT-003'],
  ['como emitir o CTE ou a minuta', 'IT-ADMLUFT-004'],
  ['preciso gerar o CIOT e o pedágio', 'IT-ADMLUFT-005'],
  ['como transmitir o CTE para a SEFAZ', 'IT-ADMLUFT-006'],
  ['como encerrar o manifesto', 'IT-ADMLUFT-007'],
  ['preciso alterar o manifesto', 'IT-ADMLUFT-007'],
  ['como faço o follow-up dos documentos', 'IT-ADMLUFT-008'],
  ['emissão de contrato manual', 'IT-ADMLUFT-009'],
  ['como emitir manifesto manual', 'IT-ADMLUFT-010'],
  ['como faço o fechamento de motoristas', 'IT-ADMLUFT-011'],
];

const RUIDO: readonly string[] = [
  'como faço lasanha de berinjela',
  'qual a previsão do tempo para amanhã',
  'me lembra de ligar para o contador na sexta',
  'quem ganhou o jogo ontem',
  'qual a capital da Austrália',
  'preciso trocar o pneu do meu carro',
];

/**
 * RUÍDO PRÓXIMO — o caso difícil, e o que este script existe para não deixar
 * passar despercebido.
 *
 * São perguntas com o vocabulário EXATO da operação e sem POP que as responda.
 * Ruído distante ("lasanha") qualquer limiar separa; estas casam por trigrama
 * com o documento errado e produzem uma resposta plausível — a falha mais cara
 * do SOS, porque quem lê não tem como saber que foi um vizinho lexical.
 *
 * Elas NÃO entram no cálculo da faixa segura: entram como relatório, porque a
 * decisão do que fazer com elas é de projeto, não de limiar.
 */
const RUIDO_PROXIMO: readonly string[] = [
  'como emito nota de exportação',
  'como cancelo um CT-e já transmitido',
  'como faço a baixa do CT-e',
  'como faço a devolução de mercadoria avariada',
  'onde vejo o seguro da carga',
  'qual motorista está na rota de Sorriso hoje',
];

const base = new BaseProcedimentos();
base.carregar();

if (base.catalogo().length === 0) {
  console.error('base vazia — rode `npm run pops` antes de calibrar');
  process.exit(1);
}

console.log(`corpus: ${base.catalogo().length} procedimentos\n`);

/**
 * Similaridade BRUTA do melhor achado — com o limiar desligado.
 *
 * Medir o piso com o piso aplicado devolve zero para todo ruído e faz o script
 * concluir que qualquer limiar serve. Foi o que aconteceu na primeira vez.
 */
function melhor(pergunta: string): { codigo: string; s: number } | null {
  const r = base.consultar(pergunta, { limite: 1, ignorarLimiar: true });
  if (r.achados.length > 0) {
    return { codigo: r.achados[0].procedimento.codigo, s: r.achados[0].similaridade };
  }
  return null;
}

console.log('--- gabarito (o que PRECISA ser achado) ---');
const acertos: number[] = [];
for (const [pergunta, esperado] of GABARITO) {
  const m = melhor(pergunta);
  const ok = m?.codigo === esperado;
  acertos.push(ok ? (m?.s ?? 0) : 0);
  console.log(
    `${ok ? 'ok  ' : 'ERRO'} s=${(m?.s ?? 0).toFixed(3)}  ${esperado}` +
      `${ok ? '' : `  (achou ${m?.codigo ?? 'nada'})`}  "${pergunta}"`,
  );
}

console.log('\n--- ruído (o que NÃO pode ser achado) ---');
const ruidos: number[] = [];
for (const pergunta of RUIDO) {
  const m = melhor(pergunta);
  ruidos.push(m?.s ?? 0);
  console.log(`     s=${(m?.s ?? 0).toFixed(3)}  ${m?.codigo ?? '—'}  "${pergunta}"`);
}

/** Os dois melhores PROCEDIMENTOS distintos, para medir a margem entre eles. */
function doisMelhores(pergunta: string): { codigo: string; s: number }[] {
  const r = base.consultar(pergunta, { limite: 40, ignorarLimiar: true });
  const vistos: { codigo: string; s: number }[] = [];
  for (const a of r.achados) {
    if (!vistos.some((v) => v.codigo === a.procedimento.codigo)) {
      vistos.push({ codigo: a.procedimento.codigo, s: a.similaridade });
    }
  }
  return vistos.slice(0, 2);
}

console.log('\n--- ruído PRÓXIMO (vocabulário da casa, sem POP que responda) ---');
console.log('    o rótulo compara com o LIMIAR EM VIGOR, não com "achou alguma coisa"\n');
for (const pergunta of RUIDO_PROXIMO) {
  const m = melhor(pergunta);
  const s = m?.s ?? 0;
  const passa = s > LIMIAR_DE_SIMILARIDADE;
  console.log(
    `${passa ? 'PASSA' : 'barra'} s=${s.toFixed(3)}  ${m?.codigo ?? '—'}  "${pergunta}"`,
  );
}

console.log('\n--- margem entre o 1º e o 2º procedimento ---');
console.log('    margem curta = a busca não sabe escolher, e afirmar seria fingir que sabe\n');
for (const pergunta of [...GABARITO.map(([q]) => q), ...RUIDO_PROXIMO]) {
  const dois = doisMelhores(pergunta);
  if (dois.length < 2 || dois[0].s <= LIMIAR_DE_SIMILARIDADE) continue;
  const margem = dois[0].s - dois[1].s;
  const alvo = GABARITO.find(([q]) => q === pergunta)?.[1];
  const rotulo = alvo ? (alvo === dois[0].codigo ? 'gabarito' : 'ERRO   ') : 'próximo ';
  console.log(
    `${rotulo} margem=${margem.toFixed(3)}  ${dois[0].codigo}(${dois[0].s.toFixed(3)}) ` +
      `vs ${dois[1].codigo}(${dois[1].s.toFixed(3)})  "${pergunta}"`,
  );
}

const piorAcerto = Math.min(...acertos.filter((s) => s > 0));
const maiorRuido = Math.max(0, ...ruidos);

console.log('\n--- veredito ---');
console.log(`pior similaridade de acerto : ${piorAcerto.toFixed(3)}`);
console.log(`maior similaridade de ruído : ${maiorRuido.toFixed(3)}`);

if (maiorRuido >= piorAcerto) {
  console.log(
    '\nNÃO HÁ LIMIAR SEGURO: o ruído casa mais forte que o pior acerto. ' +
      'Aumentar o limiar perderia pergunta legítima; baixar deixaria entrar ruído.',
  );
} else {
  const sugerido = (piorAcerto + maiorRuido) / 2;
  console.log(`\nfaixa segura: ]${maiorRuido.toFixed(3)}, ${piorAcerto.toFixed(3)}[`);
  console.log(`LIMIAR_DE_SIMILARIDADE sugerido: ${sugerido.toFixed(3)}`);
}
