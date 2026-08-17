/**
 * `npm run veredito` — o estado de validação do commit em que a árvore está.
 *
 * Ninguém aqui digita o resultado: o comando lê o diário de evidência, casa com
 * o registro de baterias e imprime o que o `MotorVeredito` calculou. É a
 * ferramenta que torna verificável a frase da Fase 12 — *o relatório nunca é a
 * fonte de verdade do estado de release*.
 *
 * O código de saída é 0 só quando o veredito permite a palavra "pronto"
 * (`PRONTO` ou `PRONTO_COM_RISCOS`). Não é um veto a distribuir — distribuir é
 * decisão do dono. É o que impede um passo de automação de anunciar aprovação
 * sem ter medido.
 *
 *   npm run veredito
 *   npm run veredito -- --commit 4d65ca1
 *   npm run veredito -- --diario caminho/para/diario.jsonl
 */

import { execFileSync } from 'node:child_process';

import { apurar, resumo } from './MotorVeredito';
import { BATERIAS } from './registro';
import { CAMINHO_PADRAO, ler } from './Diario';

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function commitDaArvore(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const commit = argumento('commit') ?? commitDaArvore();
const caminho = argumento('diario') ?? CAMINHO_PADRAO;

if (!commit) {
  console.error(
    'Sem commit para julgar: `git rev-parse HEAD` falhou e nenhum --commit foi passado.\n' +
      'Evidência sem commit não é evidência — o veredito não é calculado no escuro.',
  );
  process.exit(2);
}

const { registros, ilegiveis } = ler(caminho);
const apuracao = apurar({ commit, baterias: BATERIAS, registros });

console.log(resumo(apuracao));

if (ilegiveis.length > 0) {
  console.log(
    `\nATENÇÃO — ${ilegiveis.length} linha(s) do diário não viraram registro e não contam ` +
      `como execução:\n${ilegiveis.map((l) => `  · ${l}`).join('\n')}`,
  );
}

console.log(`\nDiário: ${caminho} · ${registros.length} registro(s) lido(s)`);

process.exit(apuracao.pode_chamar_de_pronto ? 0 : 1);
