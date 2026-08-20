/**
 * CONSISTÊNCIA ESTOCÁSTICA — §22 da auditoria, contra a planilha REAL.
 *
 * A pergunta que originou a auditoria de 19/08/2026 é a mesma: "quantos
 * motoristas temos?". O incidente não foi um número errado — foi números
 * DIFERENTES para a mesma pergunta, do mesmo dado, no mesmo dia.
 *
 * Esta bateria não sabe a resposta. Ela pergunta ao ORÁCULO INDEPENDENTE
 * (`testes/gate/oraculo-planilha.mjs`, que não importa uma linha de
 * `ClientePlanilhaOcis`) e confere o que a IARA afirmou. Fixar o número aqui
 * mediria o autor da bateria e acusaria a IARA de mentir no dia em que a
 * planilha crescesse — ela cresceu entre 19 e 20/08 (2687 → 2700 cargas) e a
 * resposta certa continuou 53.
 *
 * Duas medidas, e elas são diferentes:
 *   REPETIÇÃO  — a MESMA frase N vezes. Mede variância do modelo.
 *   PARÁFRASE  — N frases diferentes para a mesma pergunta. Mede se a
 *                interpretação é estável, que é o defeito mais caro dos dois.
 *
 * Uso:  node --env-file=.env.local --import tsx testes/gate/consistencia-motoristas.mts <url> <voltas>
 */

import { ClienteBarramento } from '../campanha/ClienteBarramento';

const URL = process.argv[2] ?? 'ws://127.0.0.1:3111';
const VOLTAS = Number(process.argv[3] ?? 10);

const PERGUNTA = 'quantos motoristas temos?';
const PARAFRASES = [
  'quantos motoristas temos?',
  'quantos motoristas diferentes temos?',
  'temos quantos motoristas?',
  'qual o total de motoristas?',
  'qual é a quantidade de motoristas?',
  'me diga o número de motoristas',
  'quantos motoristas distintos existem?',
  'quantos condutores temos?',
];

/** Todo número inteiro citado na fala, na ordem em que aparece. */
function numerosDe(texto: string): number[] {
  return [...texto.matchAll(/\b(\d{1,6})\b/g)].map((m) => Number(m[1]));
}

async function oraculo(): Promise<number> {
  const { execFileSync } = await import('node:child_process');
  const bruto = execFileSync(process.execPath, ['testes/gate/oraculo-planilha.mjs'], {
    encoding: 'utf8',
    env: process.env,
  });
  const json = JSON.parse(bruto.slice(bruto.indexOf('{')));
  if (typeof json?.motorista?.pessoas_distintas !== 'number') {
    throw new Error(`oráculo cego: ${bruto.slice(0, 200)}`);
  }
  return json.motorista.pessoas_distintas;
}

const VERDADE = await oraculo();
console.log(`oráculo independente: ${VERDADE} motoristas (pessoas distintas)\n`);

interface Medida {
  readonly rodada: number;
  readonly pergunta: string;
  readonly resposta: string;
  readonly numeros: readonly number[];
  readonly confere: boolean | null;
  readonly ferramenta: string | null;
  readonly ms: number;
}

const medidas: Medida[] = [];

async function medir(rodada: number, pergunta: string, sessaoNova: boolean): Promise<void> {
  const cliente = new ClienteBarramento({
    url: URL,
    /* Sessão nova a cada rodada quando pedido: é o que separa "a IARA é
       consistente" de "a IARA repete o que ela mesma disse no turno anterior". */
    id_usuario: sessaoNova ? `cons-${rodada}` : 'cons-fixa',
    nome: 'Consistência',
  });
  await cliente.conectar();
  try {
    const t = await cliente.dizer(pergunta);
    const numeros = numerosDe(t.resposta);
    const ferramenta = t.cadeia?.execucao?.[0]?.habilidade ?? null;
    const confere =
      t.resposta.trim().length === 0 ? null : numeros.includes(VERDADE) ? true : false;
    medidas.push({ rodada, pergunta, resposta: t.resposta, numeros, confere, ferramenta, ms: t.ms });
    const marca = confere === null ? 'SEM FALA' : confere ? 'CONFERE' : 'DIVERGE ';
    console.log(
      `${String(rodada).padStart(2)}  ${marca}  ${String(t.ms).padStart(6)} ms  ` +
        `nums=[${numeros.join(',')}]  ferr=${ferramenta ?? '—'}  ${pergunta}`,
    );
    if (confere === false) console.log(`      fala: ${t.resposta.replace(/\n/g, ' ').slice(0, 200)}`);
  } finally {
    await cliente.fechar();
  }
}

console.log(`--- REPETIÇÃO: a mesma frase ${VOLTAS}x, sessão nova a cada vez ---`);
for (let i = 1; i <= VOLTAS; i += 1) await medir(i, PERGUNTA, true);

console.log(`\n--- PARÁFRASE: ${PARAFRASES.length} frases para a mesma pergunta ---`);
for (let i = 0; i < PARAFRASES.length; i += 1) {
  await medir(VOLTAS + i + 1, PARAFRASES[i], true);
}

const comFala = medidas.filter((m) => m.confere !== null);
const certas = comFala.filter((m) => m.confere);
const valores = new Set(medidas.flatMap((m) => m.numeros));
console.log('\n=== VEREDITO ===');
console.log(`oráculo: ${VERDADE}`);
console.log(`turnos com fala: ${comFala.length}/${medidas.length}`);
console.log(`afirmaram o número certo: ${certas.length}/${comFala.length}`);
console.log(`conjunto de números citados: {${[...valores].sort((a, b) => a - b).join(', ')}}`);
const ferramentas = new Set(medidas.map((m) => m.ferramenta ?? '—'));
console.log(`ferramentas usadas: {${[...ferramentas].join(', ')}}`);
console.log(
  certas.length === comFala.length && comFala.length === medidas.length
    ? 'CONSISTENTE — toda rodada afirmou o número do oráculo.'
    : 'INCONSISTENTE — ver as linhas DIVERGE/SEM FALA acima.',
);
