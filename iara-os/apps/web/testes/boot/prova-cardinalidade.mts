/**
 * PROVA DE PRODUÇÃO DA CARDINALIDADE — e o fechamento da Fatia 1.
 *
 * A pergunta é a do operador, literal: **"quantos motoristas temos?"**
 *
 * Ela é hoje o único ponto onde as duas condições se encontram — rota cognitiva
 * (a IARA redige de cabeça) e oráculo ESCALÁVEL (`conferirExecucaoNoTurno`,
 * `escalavel: true`). Foi medido em 19/08/2026, depois que o Ciclo A entrou:
 * antes disso, nenhuma pergunta de produção satisfazia as duas ao mesmo tempo e
 * o ramo `invalido → escalar` era inalcançável.
 *
 * O QUE ESTE INSTRUMENTO OBSERVA, e nada além:
 *
 *   · o número que chegou ao operador, contra 53 (a contagem medida na aba 2026,
 *     53 PESSOAS e não 73 grafias — ver o commit 2ddebf5);
 *   · se alguma operação determinística rodou no turno;
 *   · o veredito da verificação, lido da auditoria do motor;
 *   · se houve escalada, e quantas;
 *   · todo texto que passou pela tela, atrás de número sem procedência.
 *
 * `--liberar graph` devolve ao filho as credenciais de LEITURA da planilha. Sem
 * elas a LUFT conta como desligada, o ramo de fonte-ausente vence antes do de
 * cardinalidade, e o experimento mediria outra coisa. O valor do segredo não
 * passa por aqui — ver `FONTES_LIBERAVEIS` em `MotorSandbox`.
 *
 *   node --import tsx testes/boot/prova-cardinalidade.mts --cerebro groq,gemini,openrouter,anthropic
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ClienteBarramento } from '../campanha/ClienteBarramento';
import { limparMotoresEsquecidos, RAIZ_WEB, subirMotor, type MotorVivo } from '../campanha/MotorSandbox';

const arg = (nome: string, padrao: string): string => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const CEREBRO = arg('--cerebro', 'groq,gemini,openrouter,anthropic');
const PORTA = Number(arg('--porta', '3072'));
const VOLTAS = Number(arg('--voltas', '2'));
const PRAZO_MS = Number(arg('--prazo', '240000'));

const PERGUNTA = 'quantos motoristas temos?';

/** A contagem medida na fonte. 53 pessoas; 73 é o número de GRAFIAS. */
const VERDADE = 53;

function auditoria(saida: readonly string[], filtro: RegExp): string[] {
  const achadas: string[] = [];
  for (const l of saida) {
    for (const m of l.matchAll(/\{"canal":"auditoria".*?\}(?=\{|$)/g)) {
      try {
        const o = JSON.parse(m[0]) as { acao?: string; detalhe?: string };
        if (o.acao && filtro.test(o.acao)) achadas.push(`${o.acao} — ${(o.detalhe ?? '').slice(0, 120)}`);
      } catch {
        /* linha partida entre chunks de stdout; a trilha fica incompleta e o
           relatório mostra o que conseguiu ler, em vez de inventar o resto */
      }
    }
  }
  return achadas;
}

await limparMotoresEsquecidos([PORTA]);
let motor: MotorVivo | null = null;
const voltas: unknown[] = [];

try {
  motor = await subirMotor({
    porta: PORTA,
    rotulo: 'cardinal',
    cerebro: CEREBRO,
    liberar: ['graph'],
    prazo_subida_ms: 90_000,
  });
  const carimbo = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

  for (let v = 1; v <= VOLTAS; v += 1) {
    const cliente = new ClienteBarramento({
      url: motor.url_ws,
      id_usuario: `cardinal${carimbo}v${v}`,
      nome: 'Prova de cardinalidade',
    });
    await cliente.conectar();

    const antesPacotes = cliente.pacotes.length;
    const antesSaida = motor.saida.length;
    const turno = await cliente.dizer(PERGUNTA, PRAZO_MS);
    const saida = motor.saida.slice(antesSaida);

    /* Todo número que a tela mostrou, em qualquer instante. 2026 é ano, não
       contagem, e é ecoado em respostas legítimas. */
    const expostos = new Set<number>();
    for (const p of cliente.pacotes.slice(antesPacotes)) {
      const b = p.bruto as { tipo?: string; snapshot?: { fala?: { texto?: string } } };
      if (b?.tipo !== 'snapshot') continue;
      for (const m of (b.snapshot?.fala?.texto ?? '').matchAll(/\b\d+\b/g)) {
        const n = Number(m[0]);
        if (n !== 2026) expostos.add(n);
      }
    }

    const fala = turno.resposta.replace(/\s+/g, ' ').trim();
    const vereditos = auditoria(saida, /^verificacao:/);
    const escaladas = vereditos.filter((x) => x.startsWith('verificacao:invalido:escalar')).length;
    const passos = saida.filter((l) => /"acao":"passo:/.test(l)).length;
    /* A ROTA é o que decide se a verificação chega a ser consultada: em
       `plano_local` a síntese sequer é chamada — medido em 19/08. */
    const rota = auditoria(saida, /^rota:/).at(0) ?? '(não lida)';
    const disseCerto = expostos.has(VERDADE);
    const disseOutro = [...expostos].filter((n) => n !== VERDADE && n > 10);

    const linha = {
      volta: v,
      fala: fala.slice(0, 220),
      numeros_na_tela: [...expostos],
      disse_53: disseCerto,
      numeros_suspeitos: disseOutro,
      vereditos,
      escaladas,
      passos_no_jornal: passos,
      rota,
      ms: turno.ms,
    };
    voltas.push(linha);
    console.log(`v${v} ${turno.ms}ms  53=${disseCerto}  escaladas=${escaladas}  outros=${JSON.stringify(disseOutro)}`);
    console.log(`   ${rota}`);
    console.log(`   veredito: ${vereditos.join(' | ') || '(nenhum)'}`);
    console.log(`   "${fala.slice(0, 170)}"`);
    await cliente.fechar();
  }
} finally {
  if (motor) await motor.encerrar();
}

const destino = path.join(RAIZ_WEB, 'test-evidence', 'PROVA-CARDINALIDADE');
mkdirSync(destino, { recursive: true });
writeFileSync(
  path.join(destino, 'resultado.json'),
  JSON.stringify({ pergunta: PERGUNTA, verdade: VERDADE, cerebro: CEREBRO, voltas }, null, 2),
  'utf8',
);
console.log(`\nevidência: ${destino}`);
