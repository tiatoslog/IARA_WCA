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
import { comparar, emTexto, escolherBaseline, lerLimiares } from './Regressao';

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

/**
 * A SEGUNDA PERGUNTA, e ela é diferente da primeira.
 *
 * `apurar` responde "este commit está provado?". Isso não responde "este commit
 * piorou?" — uma bateria pode cair de 100% para 70% e continuar `EXECUTADA_PASSOU`,
 * porque o status olha o commit contra si mesmo. As duas perguntas precisam ser
 * feitas, e a segunda só existe quando há linha de base.
 *
 * A LINHA DE BASE É O ÚLTIMO COMMIT UTILIZÁVEL, não o commit anterior: comparar
 * com um commit quebrado faria um commit ainda quebrado sair "sem regressão".
 * `utilizavel` reusa o próprio `MotorVeredito`, que é quem sabe o que conta.
 */
const baselineValidada = escolherBaseline(registros, commit, (c) =>
  apurar({ commit: c, baterias: BATERIAS, registros }).pode_chamar_de_pronto,
);

/**
 * A DEGRADAÇÃO, e ela é o que faz a comparação existir neste projeto.
 *
 * Só a régua estrita deixaria a regressão INERTE: o diário tem quase cem
 * registros e nenhum commit jamais alcançou `PRONTO`, então "sem linha de base"
 * seria a resposta para sempre. Sem base validada, compara-se com o commit
 * anterior mesmo — e o relatório diz, na mesma linha, que aquilo é tendência e
 * não prova. Uma trava que nunca deixa medir não protege ninguém.
 */
const baseline = baselineValidada ?? escolherBaseline(registros, commit);

let regressao;
try {
  regressao = comparar({
    registros,
    commitAtual: commit,
    commitBaseline: baseline,
    limiares: lerLimiares(),
    baselineValidada: baseline !== null && baseline === baselineValidada,
  });
  console.log(`\n${emTexto(regressao)}`);
} catch (e) {
  /* Limiar mal declarado é defeito DA RÉGUA, e uma régua quebrada não pode
     aprovar nem reprovar código: ela sai do caminho dizendo por quê. */
  console.log(`\nREGRESSÃO: não calculada — ${(e as Error).message}`);
  regressao = null;
}

console.log(`\nDiário: ${caminho} · ${registros.length} registro(s) lido(s)`);

/**
 * O código de saída soma as duas perguntas: provado E não piorou.
 *
 * `CRITICO` reprova sozinho mesmo com a apuração dizendo `PRONTO` — é o caso do
 * commit que passa em tudo que mede e derrubou uma dimensão crítica em relação a
 * ontem. `AVISO` não reprova: ele existe para ser lido, e um alarme que bloqueia
 * por 2% é um alarme que a equipe aprende a desligar.
 */
const regrediuGrave = regressao?.severidade === 'CRITICO' || regressao?.severidade === 'ERRO';
process.exit(apuracao.pode_chamar_de_pronto && !regrediuGrave ? 0 : 1);
