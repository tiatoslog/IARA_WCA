/**
 * BATERIA — MEMÓRIA: RECALL, FALSA MEMÓRIA, OBSOLESCÊNCIA, ISOLAMENTO.
 *
 * A suíte cobre a ESCRITA da memória — e cobre bem: as três travas de
 * `sobTrava` nasceram de 39 escritas concorrentes perdidas em silêncio. O que
 * ninguém media é a LEITURA:
 *
 *     de 100 fatos gravados, quantos voltam certos — e quantos voltam errados?
 *
 * "Voltam errados" é a metade que costuma ficar de fora e é a que estraga
 * confiança: memória que devolve um fato que ninguém escreveu, ou a versão velha
 * de um fato corrigido, é pior que memória vazia. Memória vazia o operador
 * percebe; memória errada ele repete como se fosse dele.
 *
 * QUATRO MEDIÇÕES, e a segunda achou uma perda silenciosa por desenho:
 *
 *   recall na janela     — o que está dentro do limite volta inteiro?
 *   recall fora da janela— o que a poda cortou volta? (e ALGUÉM É AVISADO?)
 *   falsa memória        — volta algo que nunca foi escrito, ou com texto trocado?
 *   obsolescência        — fato corrigido: a versão vigente é a nova, com motivo?
 *   isolamento           — o fato de um operador aparece para outro?
 *
 * O shard é real (`dados/memoria/<id>.json`, caminho derivado do `id_usuario`) e
 * o operador de laboratório tem id próprio, apagado no fim. Medir sobre um
 * dublê de memória mediria o dublê.
 */

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { MemoriaOperacional } from '../../servidor/nucleo/MemoriaOperacional';
import { extrairFatosHorario, detectarConflitos } from '../../servidor/nucleo/kernel/MemoriaFatos';

/** O limite de janela do produto. Se ele mudar, a bateria mede o valor novo. */
const LIMITE_DECLARADO = 40;

const OP_A = 'lab-memoria-alfa';
const OP_B = 'lab-memoria-beta';

export interface JulgamentoMemoria {
  readonly id: string;
  readonly pergunta: string;
  readonly medido: string;
  readonly aprovado: boolean;
  /** Perda ou risco que a medição revelou e que NÃO é reprovação. */
  readonly observacao?: string;
}

async function limpar(): Promise<void> {
  const pasta = path.resolve(process.cwd(), 'dados', 'memoria');
  for (const id of [OP_A, OP_B]) {
    await rm(path.join(pasta, `${id}.json`), { force: true });
  }
}

export async function medirMemoria(): Promise<readonly JulgamentoMemoria[]> {
  await limpar();
  const memoria = new MemoriaOperacional();
  const julgamentos: JulgamentoMemoria[] = [];

  /* Cem fatos numerados e distinguíveis: o número no texto é o que permite dizer
     QUAL voltou, e não só quantos. */
  const total = 100;
  const fatos = Array.from(
    { length: total },
    (_, i) => `fato numero ${String(i + 1).padStart(3, '0')} sobre a operacao de carga`,
  );
  for (const f of fatos) await memoria.registrar(OP_A, 'operador', f);

  const voltaram = await memoria.historico(OP_A, LIMITE_DECLARADO);
  const textos = voltaram.map((r) => r.texto);
  const ultimos = fatos.slice(-LIMITE_DECLARADO);

  // 1. RECALL NA JANELA -------------------------------------------------------
  const dentro = ultimos.filter((f) => textos.includes(f)).length;
  julgamentos.push({
    id: 'recall-na-janela',
    pergunta: `os ${LIMITE_DECLARADO} fatos mais recentes voltam inteiros?`,
    medido: `${dentro}/${ultimos.length}`,
    aprovado: dentro === ultimos.length,
  });

  // 2. JANELA DE LEITURA × PODA -----------------------------------------------
  /**
   * DUAS PERDAS DIFERENTES, e a primeira versão desta bateria as confundiu.
   *
   * Ela mediu "0 de 60 fatos antigos voltaram" com o contador de poda em zero, e
   * concluiu perda invisível. Estava errada: com 100 registros nada foi podado (a
   * poda só corta acima de 3× = 120). Os 60 estavam no disco inteiros — o que os
   * escondeu foi o LIMITE DE LEITURA, que é parâmetro de quem chama.
   *
   *   janela de leitura — `historico(id, limite)` devolve os últimos N. Nada se
   *                       perdeu; pedir mais devolve mais.
   *   poda              — acima de 3× o limite o shard é cortado para 2×. Perda
   *                       permanente, e é esta que precisa estar registrada.
   *
   * Medir as duas como uma só produziria a acusação errada — "a memória perde
   * fato em silêncio" quando o fato estava lá. Ficou como está por isso.
   */
  const tudo = (await memoria.historico(OP_A, total)).map((r) => r.texto);
  const fundoDoBaú = fatos.filter((f) => tudo.includes(f)).length;
  julgamentos.push({
    id: 'janela-de-leitura-nao-e-perda',
    pergunta: 'pedir limite maior devolve o que a janela pequena escondeu?',
    medido: `${fundoDoBaú}/${total} com limite ${total} · ${textos.length} com limite ${LIMITE_DECLARADO}`,
    aprovado: fundoDoBaú === total,
  });

  const antigos = fatos.slice(0, total - LIMITE_DECLARADO);
  const sobreviventes = antigos.filter((f) => textos.includes(f)).length;
  /* A perda agora tem número no shard — é o que separa "descartado pela poda" de
     "nunca foi gravado", distinção que a primeira rodada desta bateria não sabia
     fazer. Lido do disco, não do processo: o contador só vale se sobreviver ao
     `rename` atômico. */
  julgamentos.push({
    id: 'janela-pequena-esconde-antigo',
    pergunta: `com limite ${LIMITE_DECLARADO}, o fato antigo aparece?`,
    medido: `${sobreviventes}/${antigos.length} — esperado 0, é o corte da janela`,
    aprovado: sobreviventes === 0,
  });

  /* PODA DE VERDADE: passa de 3× o limite e força o corte. É a perda permanente,
     e o que a medição cobra é que ela esteja REGISTRADA — perda com número é
     investigável; perda silenciosa é indistinguível de fato nunca gravado. */
  const excedente = Array.from(
    { length: LIMITE_DECLARADO * 3 },
    (_, i) => `enchimento ${String(i).padStart(3, '0')} para forcar a poda`,
  );
  for (const f of excedente) await memoria.registrar(OP_A, 'operador', f);

  const depoisDaPoda = JSON.parse(
    await readFile(path.resolve(process.cwd(), 'dados', 'memoria', `${OP_A}.json`), 'utf8').catch(
      () => '{}',
    ),
  ) as { podados?: number; ultima_poda?: string; registros?: unknown[] };

  julgamentos.push({
    id: 'poda-registra-a-perda',
    pergunta: 'a poda permanente deixa número e data no shard?',
    medido:
      `shard com ${depoisDaPoda.registros?.length ?? 0} registro(s) · ` +
      `${depoisDaPoda.podados ?? 0} descartado(s) · última poda ${depoisDaPoda.ultima_poda ?? '—'}`,
    aprovado: (depoisDaPoda.podados ?? 0) > 0 && Boolean(depoisDaPoda.ultima_poda),
    observacao:
      'o registro é para quem investiga: o operador não é avisado na resposta de que fato antigo saiu',
  });

  // 3. FALSA MEMÓRIA ----------------------------------------------------------
  const inventados = textos.filter((t) => !fatos.includes(t));
  julgamentos.push({
    id: 'falsa-memoria',
    pergunta: 'volta algum registro que ninguém escreveu, ou com texto alterado?',
    medido: inventados.length === 0 ? 'nenhum' : `${inventados.length}: ${inventados.slice(0, 2)}`,
    aprovado: inventados.length === 0,
  });

  /* Ordem cronológica importa: memória fora de ordem faz a IARA tratar
     correção como fato original. */
  const emOrdem = voltaram.every(
    (r, i) => i === 0 || r.instante >= voltaram[i - 1].instante,
  );
  julgamentos.push({
    id: 'ordem-cronologica',
    pergunta: 'a leitura respeita a ordem em que os fatos entraram?',
    medido: emOrdem ? 'crescente' : 'FORA DE ORDEM',
    aprovado: emOrdem,
  });

  // 4. OBSOLESCÊNCIA ---------------------------------------------------------
  await memoria.registrar(OP_A, 'operador', 'a reuniao de operacao e as 8h');
  await memoria.registrar(OP_A, 'operador', 'corrigindo: a reuniao de operacao e as 10h');
  const recente = await memoria.historico(OP_A, LIMITE_DECLARADO);
  const conflitos = detectarConflitos(extrairFatosHorario(recente));
  const oConflito = conflitos[0];
  julgamentos.push({
    id: 'obsolescencia-vence-a-nova',
    pergunta: 'fato corrigido: a versão vigente é a mais nova, com motivo escrito?',
    medido: oConflito
      ? `vigente ${oConflito.vigente.minutos} min · superadas ${oConflito.superadas.length} · motivo: ${
          (oConflito as { motivo?: string }).motivo ?? 'sem campo de motivo'
        }`
      : 'nenhum conflito detectado entre 8h e 10h para o mesmo assunto',
    aprovado: Boolean(oConflito && oConflito.vigente.minutos === 600),
  });

  // 5. ISOLAMENTO ------------------------------------------------------------
  await memoria.registrar(OP_B, 'operador', 'segredo do beta: a rota nova passa por Rondonopolis');
  const doA = (await memoria.historico(OP_A, LIMITE_DECLARADO)).map((r) => r.texto).join(' ');
  const doB = (await memoria.historico(OP_B, LIMITE_DECLARADO)).map((r) => r.texto).join(' ');
  julgamentos.push({
    id: 'isolamento-entre-operadores',
    pergunta: 'o fato de um operador aparece na leitura do outro?',
    medido:
      !doA.includes('segredo do beta') && !doB.includes('fato numero')
        ? 'nenhum cruzamento'
        : 'CRUZOU',
    aprovado: !doA.includes('segredo do beta') && !doB.includes('fato numero'),
  });

  await limpar();
  return julgamentos;
}

export interface TaxasMemoria {
  readonly medicoes: number;
  readonly aprovadas: number;
  readonly recall_na_janela: number;
  readonly falsa_memoria: number;
  readonly observacoes: readonly string[];
}

export function taxasMemoria(js: readonly JulgamentoMemoria[]): TaxasMemoria {
  const achar = (id: string) => js.find((j) => j.id === id);
  const janela = achar('recall-na-janela');
  const [a, b] = (janela?.medido ?? '0/1').split('/').map(Number);

  return {
    medicoes: js.length,
    aprovadas: js.filter((j) => j.aprovado).length,
    recall_na_janela: b === 0 ? 0 : a / b,
    falsa_memoria: achar('falsa-memoria')?.aprovado ? 0 : 1,
    observacoes: js.flatMap((j) => (j.observacao ? [`${j.id}: ${j.observacao}`] : [])),
  };
}

export function violacoesDeMemoria(js: readonly JulgamentoMemoria[]): readonly string[] {
  return js.filter((j) => !j.aprovado).map((j) => `${j.id}: medido ${j.medido}`);
}
