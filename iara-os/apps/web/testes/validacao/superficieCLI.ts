/**
 * `npm run superficie` — mostra o delta; `-- --aceitar` grava a superfície nova.
 *
 * Separado do `npm run bateria` de propósito: aceitar superfície é ATO HUMANO com
 * diff no git, e não pode acontecer como efeito colateral de rodar uma bateria. Se
 * `bateria` aceitasse sozinha, o portão passaria a se auto-aprovar na primeira
 * execução depois da mudança — que é exatamente o buraco que ele existe para
 * fechar.
 */

import { aceitarSuperficie, compararSuperficie, superficieAtual, violacoesDeSuperficie } from './superficie';

const aceitar = process.argv.includes('--aceitar');
const deltas = compararSuperficie();
const violacoes = violacoesDeSuperficie(deltas);

const atual = superficieAtual();
console.log(
  `superfície atual: ${atual.habilidades.length} habilidade(s), ${atual.integracoes.length} integração(ões), ` +
    `${atual.baterias.length} bateria(s), ${atual.portas_de_saida.length} porta(s) de saída`,
);

if (violacoes.length === 0) {
  console.log('\nsuperfície declarada em dia — nada entrou nem saiu sem declaração.');
  process.exit(0);
}

console.log(`\n${violacoes.length} item(ns) fora da declaração:\n`);
for (const v of violacoes) console.log(`  · ${v}`);

if (!aceitar) {
  console.log(
    '\nRode as baterias afetadas ANTES de aceitar. A ordem importa: aceitar primeiro\n' +
      'transforma o portão em carimbo.\n\n  npm run superficie -- --aceitar\n',
  );
  process.exit(1);
}

aceitarSuperficie();
console.log('\nsuperfície nova gravada. O `git diff` da declaração é a evidência de que alguém olhou.');
