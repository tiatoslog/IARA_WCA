/**
 * LATÊNCIA POR PROVEDOR, COM PROMPT DE TAMANHO REAL.
 *
 * A sonda anterior (`sonda-provedores.mts`) mandava uma frase de dez tokens e
 * respondia "o provedor gera texto?". Boa pergunta, outra pergunta. Um turno da
 * IARA carrega persona, catálogo e histórico — a Groq recusou um deles com
 * `Requested 6448` contra um teto de 8000 por minuto. Medir com dez tokens e
 * planejar a cadeia com esse número é dimensionar a ponte pelo peso do
 * engenheiro.
 *
 * Mede: tempo até o PRIMEIRO PEDAÇO (é ele que tira a tela do vazio) e tempo
 * total. Repete, porque um número só de sistema com fila não é número.
 *
 *   node --import tsx testes/boot/medir-provedores.mts --voltas 3
 */
import { config as carregarEnv } from 'dotenv';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { RAIZ_WEB } from '../campanha/MotorSandbox';

carregarEnv({ path: path.join(RAIZ_WEB, '.env.local') });

const { criarProvedorRaciocinio, provedoresDeclarados } = await import(
  '../../servidor/nucleo/FabricaRaciocinio'
);

const arg = (nome: string, padrao: string): string => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const VOLTAS = Number(arg('--voltas', '3'));
const PRAZO_MS = Number(arg('--prazo', '90000'));

/**
 * O PESO REAL DE UM TURNO. Não é texto aleatório: é o formato do que a IARA
 * manda mesmo — persona, catálogo de habilidades, contexto. O conteúdo importa
 * menos que o tamanho, e o tamanho é o que a Groq contou como 6448.
 */
function personaDeTeste(): string {
  const bloco = [
    'Você é a IARA, o sistema operacional cognitivo da Atos Log, transportadora',
    'com centrais em Mato Grosso, Goiás, São Paulo e Paraná. Fale português do',
    'Brasil, direto, sem floreio. Nunca afirme que executou algo sem evidência.',
    'Quando uma capacidade estiver desligada por falta de credencial, diga qual',
    'credencial falta em vez de improvisar. Capacidades: consultar infraestrutura,',
    'consultar cargas da operação LUFT, estatísticas de cargas, relatório',
    'executivo, clima, hora e data, agenda, busca na internet, memória',
    'corporativa, histórico de incidentes, extração de texto de documentos,',
    'automação do computador local, pareamento de dispositivos.',
  ].join(' ');
  /* ~6k tokens: o tamanho que a Groq recusou por TPM. */
  return Array.from({ length: 40 }, (_, i) => `[bloco ${i}] ${bloco}`).join('\n\n');
}

const PERGUNTA = 'Em uma frase curta: quais capacidades dependem de credencial?';

interface Amostra {
  provedor: string;
  modelo: string;
  volta: number;
  ate_primeiro_pedaco_ms: number | null;
  total_ms: number | null;
  tokens_entrada: number;
  tokens_saida: number;
  erro: string | null;
}

const declarados: string[] = provedoresDeclarados(process.env);
console.log(`cadeia declarada: ${declarados.join(' -> ')}\n`);

const amostras: Amostra[] = [];

for (const escolha of declarados) {
  for (let volta = 1; volta <= VOLTAS; volta += 1) {
    let provedor: { apelido: string; modelo: string; raciocinar: Function };
    try {
      provedor = criarProvedorRaciocinio({ ...process.env, IARA_PROVEDOR: escolha });
    } catch (e) {
      amostras.push({
        provedor: escolha,
        modelo: '-',
        volta,
        ate_primeiro_pedaco_ms: null,
        total_ms: null,
        tokens_entrada: 0,
        tokens_saida: 0,
        erro: (e as Error).message.slice(0, 120),
      });
      continue;
    }

    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), PRAZO_MS);
    const t0 = Date.now();
    let primeiro: number | null = null;
    try {
      const r = await provedor.raciocinar({
        mensagem: PERGUNTA,
        historico: [],
        overridePersona: personaDeTeste(),
        camadaGlobal: '',
        sinal: ctrl.signal,
        aoReceberTexto: () => {
          if (primeiro === null) primeiro = Date.now() - t0;
        },
      });
      amostras.push({
        provedor: provedor.apelido,
        modelo: provedor.modelo,
        volta,
        ate_primeiro_pedaco_ms: primeiro,
        total_ms: Date.now() - t0,
        tokens_entrada: r.tokens_entrada ?? 0,
        tokens_saida: r.tokens_saida ?? 0,
        erro: null,
      });
    } catch (e) {
      amostras.push({
        provedor: provedor.apelido,
        modelo: provedor.modelo,
        volta,
        ate_primeiro_pedaco_ms: primeiro,
        total_ms: Date.now() - t0,
        tokens_entrada: 0,
        tokens_saida: 0,
        erro: (e as Error).message.replace(/\s+/g, ' ').slice(0, 140),
      });
    } finally {
      clearTimeout(relogio);
    }
    const a = amostras.at(-1)!;
    console.log(
      `${a.provedor.padEnd(11)} v${a.volta}  1º=${a.ate_primeiro_pedaco_ms ?? '—'}ms  ` +
        `total=${a.total_ms}ms  tok_in=${a.tokens_entrada}  ${a.erro ?? ''}`,
    );
  }
}

const mediana = (v: number[]): number | null => {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log('\n| provedor | modelo | 1º pedaço (mediana) | total (mediana) | ok/total |');
console.log('|---|---|---|---|---|');
for (const nome of declarados) {
  const minhas = amostras.filter((a) => a.provedor === nome || (nome === 'ollama' && a.provedor === 'ollama'));
  const boas = minhas.filter((a) => a.erro === null);
  console.log(
    `| ${nome} | ${minhas[0]?.modelo ?? '-'} | ` +
      `${mediana(boas.map((a) => a.ate_primeiro_pedaco_ms ?? a.total_ms ?? 0)) ?? '—'}ms | ` +
      `${mediana(boas.map((a) => a.total_ms ?? 0)) ?? '—'}ms | ${boas.length}/${minhas.length} |`,
  );
}

const destino = path.join(RAIZ_WEB, 'test-evidence', 'PROVEDORES-LATENCIA');
mkdirSync(destino, { recursive: true });
writeFileSync(
  path.join(destino, 'amostras.json'),
  JSON.stringify({ instante: new Date().toISOString(), declarados, amostras }, null, 2),
  'utf8',
);
console.log(`\nevidência: ${destino}`);
