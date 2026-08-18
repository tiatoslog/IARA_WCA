/**
 * BATERIA — CONSISTÊNCIA SOB QUEDA.
 *
 *     depois do crash, ela distingue "não executado" de "executado e não confirmado"?
 *
 * É a pergunta que decide se a IARA pode retentar em segurança. Se os dois casos
 * voltarem iguais do disco, só existem duas saídas, e as duas são ruins: retentar
 * sempre (e duplicar efeito não idempotente — mensagem enviada duas vezes) ou nunca
 * retentar (e abandonar trabalho que só faltava confirmar).
 *
 * O CRASH É REAL, em processo filho. `process.exit(1)` no meio de uma operação não
 * é simulável de dentro: `throw` roda `finally`, e um mock de crash grava o que um
 * crash real não gravaria — as duas coisas testariam a simulação. O filho morre sem
 * `finally`, sem flush e sem despedida, como um `kill -9` ou um pico de energia.
 *
 * DOIS ORÁCULOS INDEPENDENTES, e é a comparação entre eles que dá o veredito:
 *
 *   o jornal  — o que a IARA sabe, lido por `reidratar` num processo NOVO;
 *   o mundo   — um arquivo que o filho tocou (ou não), lido por fora.
 *
 * Perguntar só ao jornal seria pedir ao acusado que testemunhe.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RegistroOperacoes } from '../../servidor/nucleo/kernel/RegistroOperacoes';

export type MomentoDaQueda = 'antes_do_efeito' | 'depois_do_efeito' | 'depois_de_verificar';

export interface JulgamentoQueda {
  readonly momento: MomentoDaQueda;
  /** O que o jornal diz depois de reidratar num processo novo. */
  readonly estado_lido: string | null;
  /** O mundo tem o efeito? Lido do disco, não do jornal. */
  readonly efeito_no_mundo: boolean;
  /** A leitura do jornal é compatível com o que o mundo mostra? */
  readonly honesto: boolean;
  /** A operação voltou como pendente de verdade — a fila de quem investiga. */
  readonly pendente_de_verdade: boolean;
  readonly detalhe: string;
}

const FILHO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'quedaFilho.ts',
);
const OPERADOR = 'operador-de-queda';

/**
 * O QUE CADA MOMENTO EXIGE DO JORNAL — e a primeira versão desta bateria exigiu a
 * coisa errada, porque o produto é mais honesto do que eu esperava.
 *
 * Eu esperava `executando`, raciocinando que é o estado gravado antes do executor.
 * A reidratação devolve `desconhecida`, e ela está certa: um processo que MORREU
 * não está executando nada. Manter `executando` seria o jornal afirmando atividade
 * de um processo que não existe — e alguém, um dia, leria isso como "está em
 * andamento, espere".
 *
 * `desconhecida` é a leitura exata: pode ter acontecido, ninguém confirmou.
 *
 * OS DOIS PRIMEIROS CASOS ESPERAM O MESMO ESTADO, e isso responde a pergunta da
 * bateria de um jeito que merece ser dito em voz alta: o jornal **não distingue**
 * efeito aplicado de efeito não aplicado, e não deve fingir que distingue — ele não
 * tem como saber. Quem distingue é o verificador olhando o MUNDO depois, e o que
 * torna isso possível é a operação ficar em `pendentesDeVerdade`. Sem essa fila, a
 * única saída seria retentar às cegas (duplicando efeito não idempotente) ou
 * abandonar trabalho que só faltava confirmar.
 */
const ESPERADO: Record<MomentoDaQueda, readonly string[]> = {
  antes_do_efeito: ['desconhecida'],
  depois_do_efeito: ['desconhecida'],
  depois_de_verificar: ['verificada'],
};

async function rodar(momento: MomentoDaQueda): Promise<JulgamentoQueda> {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-queda-'));

  const filho = spawnSync(
    process.execPath,
    ['--import', 'tsx', FILHO, raiz, momento],
    { encoding: 'utf8', timeout: 60_000 },
  );

  const idOperacao = (filho.stdout ?? '').trim().split('\n').at(-1) ?? '';
  const mundo = path.join(raiz, 'mundo.txt');
  const efeito = existsSync(mundo) && readFileSync(mundo, 'utf8').includes('efeito aplicado');

  /* Processo NOVO lendo o disco: é o que acontece quando o serviço sobe depois da
     queda. Reusar o registro do filho mediria memória, não persistência — e a
     memória morreu com ele. */
  const registro = new RegistroOperacoes(raiz);
  const reidratadas = await registro.reidratar(OPERADOR);
  const operacao = reidratadas.find((o) => o.id_operacao === idOperacao) ?? reidratadas.at(-1);
  const estado = operacao?.estado ?? null;

  const pendentes = registro.pendentesDeVerdade(OPERADOR);

  return {
    momento,
    estado_lido: estado,
    efeito_no_mundo: efeito,
    honesto: estado !== null && ESPERADO[momento].includes(estado),
    pendente_de_verdade: pendentes.some((o) => o.id_operacao === operacao?.id_operacao),
    detalhe:
      `saída do filho: ${(filho.status ?? '?')}` +
      `${filho.stderr ? ` · stderr: ${filho.stderr.slice(0, 160)}` : ''}` +
      ` · ${reidratadas.length} operação(ões) reidratada(s)`,
  };
}

export async function medirQueda(): Promise<readonly JulgamentoQueda[]> {
  const js: JulgamentoQueda[] = [];
  for (const momento of [
    'antes_do_efeito',
    'depois_do_efeito',
    'depois_de_verificar',
  ] as MomentoDaQueda[]) {
    js.push(await rodar(momento));
  }
  return js;
}

export function violacoesDeQueda(js: readonly JulgamentoQueda[]): readonly string[] {
  const fora: string[] = [];

  for (const j of js) {
    if (j.estado_lido === null) {
      /* Jornal ilegível depois do crash é o pior desfecho: não é "não sei", é "não
         tenho nem a pergunta". Sem isto, um jornal corrompido contaria como
         "nenhuma violação" porque nenhuma comparação foi possível. */
      fora.push(`${j.momento}: nada foi reidratado — o jornal não sobreviveu à queda`);
      continue;
    }
    if (!j.honesto) {
      fora.push(
        `${j.momento}: jornal diz "${j.estado_lido}" e o mundo ${
          j.efeito_no_mundo ? 'TEM' : 'não tem'
        } o efeito — leitura incompatível`,
      );
    }
  }

  /* A FILA É O QUE TORNA A DISTINCAO RESOLVIVEL. Se o jornal diz "desconhecida" e
     a operacao NAO entra em `pendentesDeVerdade`, o desconhecimento morre ali: nada
     mais vai olhar o mundo, e o operador nunca sabe se a mensagem foi enviada. */
  for (const j of js.filter((x) => x.estado_lido === 'desconhecida')) {
    if (!j.pendente_de_verdade) {
      fora.push(
        `${j.momento}: jornal diz "desconhecida" e a operação ficou fora da fila de verdade — ninguém vai conferir`,
      );
    }
  }

  /* A trava contra o desfecho perigoso: efeito no mundo com jornal declarando
     confirmação sem verificador nenhum ter olhado, ou pior, declarando que nada
     aconteceu. É por essa porta que a duplicata entra na retentativa seguinte. */
  const meio = js.find((j) => j.momento === 'depois_do_efeito');
  if (meio && meio.efeito_no_mundo && (meio.estado_lido === 'verificada' || meio.estado_lido === 'aceita_pelo_provedor')) {
    fora.push(
      `depois_do_efeito: o jornal declarou "${meio.estado_lido}" sem verificador ter olhado — confirmação por otimismo`,
    );
  }
  if (meio && meio.efeito_no_mundo && !meio.pendente_de_verdade) {
    fora.push(
      'depois_do_efeito: efeito no mundo e a operação NÃO ficou pendente de verdade — ninguém vai conferir',
    );
  }
  return fora;
}
