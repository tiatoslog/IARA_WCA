/**
 * QUEM SABE PLANEJAR — a medição que precede a seleção de modelo por tarefa.
 *
 * `planejar` tem uma exigência DURA e binária: o modelo precisa emitir JSON
 * parseável. `interpretarPlano` corta qualquer outra coisa e devolve `null` — a
 * chamada inteira vira token gasto e plano nenhum. Não é preferência de
 * qualidade; é "serve ou não serve".
 *
 * ESTE ARQUIVO EXISTE PARA NÃO INVENTAR RANKING. A tentação, ao falar de
 * "escolher modelo por tarefa", é escrever no código que tal modelo é melhor a
 * planejar. Isso seria opinião com cara de configuração, e envelheceria no dia
 * em que o provedor trocasse o modelo por baixo. O que se pode declarar é o que
 * se mediu: este elo devolveu um plano parseável, ou não devolveu.
 *
 * Usa o `planejar` DE PRODUÇÃO — mesmo prompt, mesmo modo planejador, mesmo
 * interpretador. O catálogo é pequeno e isso está declarado: o que se mede é a
 * forma da saída, não a qualidade da escolha entre trinta habilidades.
 *
 *   node --import tsx testes/boot/medir-capacidade-plano.mts
 */
import { config as carregarEnv } from 'dotenv';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { RAIZ_WEB } from '../campanha/MotorSandbox';

carregarEnv({ path: path.join(RAIZ_WEB, '.env.local') });

const { criarProvedorRaciocinio, provedoresDeclarados } = await import(
  '../../servidor/nucleo/FabricaRaciocinio'
);
const { MotorRaciocinio } = await import('../../servidor/nucleo/kernel/MotorRaciocinio');

const VOLTAS = 2;

/** Catálogo mínimo, declarado como mínimo. Mede a FORMA da saída. */
const CATALOGO = [
  {
    id: 'consultar_infraestrutura',
    descricao: 'Lista centrais e frota por UF',
    esquema: { uf: 'texto' },
    custo: 'zero',
    risco: 'baixo',
    exemplos: ['quantas centrais temos em MT?'],
  },
  {
    id: 'consultar_clima',
    descricao: 'Previsão do tempo de uma cidade',
    esquema: { cidade: 'texto' },
    custo: 'zero',
    risco: 'baixo',
    exemplos: ['vai chover em Cuiabá?'],
  },
  {
    id: 'buscar_web',
    descricao: 'Busca na internet',
    esquema: { termo: 'texto' },
    custo: 'zero',
    risco: 'baixo',
    exemplos: ['preço do diesel hoje'],
  },
] as never;

/** Pedido composto — o formato que de fato aciona a decomposição. */
const PERCEPCAO = {
  bruto: 'veja o clima em Cuiabá e depois me diga quantas centrais temos em MT',
  tipo: 'comando',
  confianca: 0.35,
  ancoras: [],
  objetivo: 'clima e infraestrutura',
} as never;

interface Amostra {
  provedor: string;
  modelo: string;
  volta: number;
  planejou: boolean;
  passos: number;
  ms: number;
  erro: string | null;
}

const declarados: string[] = provedoresDeclarados(process.env);
console.log(`declarados: ${declarados.join(' -> ')}\n`);
const amostras: Amostra[] = [];

for (const escolha of declarados) {
  for (let v = 1; v <= VOLTAS; v += 1) {
    const provedor = criarProvedorRaciocinio({ ...process.env, IARA_PROVEDOR: escolha });
    const motor = new MotorRaciocinio(provedor);
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 60_000);
    const t0 = Date.now();
    try {
      const plano = await motor.planejar(PERCEPCAO, CATALOGO, ctrl.signal);
      amostras.push({
        provedor: provedor.apelido,
        modelo: provedor.modelo,
        volta: v,
        planejou: plano !== null,
        passos: plano?.passos?.length ?? 0,
        ms: Date.now() - t0,
        erro: null,
      });
    } catch (e) {
      amostras.push({
        provedor: provedor.apelido,
        modelo: provedor.modelo,
        volta: v,
        planejou: false,
        passos: 0,
        ms: Date.now() - t0,
        erro: (e as Error).message.replace(/\s+/g, ' ').slice(0, 120),
      });
    } finally {
      clearTimeout(relogio);
    }
    const a = amostras.at(-1)!;
    console.log(
      `${a.provedor.padEnd(11)} v${a.volta}  planejou=${String(a.planejou).padEnd(5)} ` +
        `passos=${a.passos}  ${a.ms}ms  ${a.erro ?? ''}`,
    );
  }
}

console.log('\n| provedor | modelo | planejou | passos | ms (mediana) |');
console.log('|---|---|---|---|---|');
for (const nome of declarados) {
  const minhas = amostras.filter((a) => a.provedor === nome);
  if (minhas.length === 0) continue;
  const ok = minhas.filter((a) => a.planejou);
  const ms = [...minhas].map((a) => a.ms).sort((x, y) => x - y);
  console.log(
    `| ${nome} | ${minhas[0].modelo} | ${ok.length}/${minhas.length} | ` +
      `${ok[0]?.passos ?? '—'} | ${ms[Math.floor(ms.length / 2)]} |`,
  );
}

const destino = path.join(RAIZ_WEB, 'test-evidence', 'CAPACIDADE-PLANO');
mkdirSync(destino, { recursive: true });
writeFileSync(
  path.join(destino, 'amostras.json'),
  JSON.stringify({ instante: new Date().toISOString(), amostras }, null, 2),
  'utf8',
);
console.log(`\nevidência: ${destino}`);
