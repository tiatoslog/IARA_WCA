/**
 * QUANTO TEMPO O OPERADOR FICA OLHANDO PARA O NADA.
 *
 * Instrumento de medição — despeja, não julga. Existe para o antes/depois do
 * prazo de fala, e mede UMA coisa que nenhum teste desta base media: o intervalo
 * entre a pessoa apertar enter e a tela mudar.
 *
 * A MÉTRICA É "PRIMEIRA COISA PERCEPTÍVEL", não "resposta pronta", e a distinção
 * é o conserto inteiro. O turno pode legitimamente levar um minuto — a IARA
 * consulta cadeia de provedores, executa passos, verifica. O que não pode é a
 * tela ficar parada em "pensando" durante esse minuto, porque silêncio e
 * travamento são indistinguíveis para quem espera.
 *
 * Perceptível = um `RESPOSTA_TRECHO` (a fala começou a aparecer) ou o
 * `TAREFA_CONCLUIDA` (a fala inteira chegou de uma vez). O cliente vê os dois
 * como snapshot com `fala.texto` não vazio.
 *
 *   node --import tsx testes/boot/medir-prazo-fala.mts --cerebro groq,gemini,openrouter
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ClienteBarramento } from '../campanha/ClienteBarramento';
import { limparMotoresEsquecidos, RAIZ_WEB, subirMotor, type MotorVivo } from '../campanha/MotorSandbox';

const arg = (nome: string, padrao: string): string => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const CEREBRO = arg('--cerebro', 'groq,gemini,openrouter');
const PORTA = Number(arg('--porta', '3090'));
const PRAZO_MS = Number(arg('--prazo', '120000'));
const ROTULO = arg('--rotulo', 'medicao');
/**
 * `--prazo-fala` impõe `IARA_PRAZO_FALA_MS` ao motor filho.
 *
 * Serve para PROVAR o mecanismo sem depender da sorte da rede. A cadeia gratuita
 * tem variância enorme — a mesma pergunta levou 46,7 s numa execução e 18,9 s na
 * seguinte — então esperar o turno patológico acontecer para ver o aviso é
 * medir o humor da Groq, não o conserto. Com um prazo curto, todo turno cruza a
 * linha e o aviso ou aparece ou não aparece.
 */
const PRAZO_FALA = arg('--prazo-fala', '').trim();
/**
 * `--prazo-provedor` impõe `IARA_PRAZO_PROVEDOR_MS` ao motor filho — o prazo do
 * primeiro pedaço, por elo da cadeia.
 *
 * Existe para o A/B honesto. A primeira comparação de lentidão trocou DUAS
 * variáveis ao mesmo tempo (o prazo entrou e a Anthropic entrou na cadeia junto),
 * e uma medição com dois tratamentos não atribui o efeito a nenhum dos dois.
 * Com esta porta, a mesma cadeia roda com o abandono ligado e desligado.
 */
const PRAZO_PROVEDOR = arg('--prazo-provedor', '').trim();

/**
 * PERGUNTAS QUE CAEM NA ROTA COGNITIVA, que é onde o silêncio mora. A rota
 * determinística (hora, clima) responde em menos de um segundo e não teria o que
 * medir. Repetidas de propósito: a variância entre execuções da mesma frase é
 * parte do que se quer saber.
 */
const ROTEIRO = [
  'O que você consegue fazer?',
  'Quantas cargas existem na base 2026?',
  'Qual motorista possui mais cargas?',
  'Me explique como você decide usar uma ferramenta.',
  'Quantas cargas existem na base 2026?',
  'O que você consegue fazer?',
];

interface Medida {
  n: number;
  pedido: string;
  /** ms até a PRIMEIRA coisa que a tela mostraria. `null` = nada apareceu. */
  ate_perceptivel_ms: number | null;
  /** ms até a fala se declarar concluída. `null` = não concluiu no prazo. */
  ate_concluir_ms: number | null;
  mudo: boolean;
  /** O aviso de espera chegou ao cliente neste turno? */
  avisou: boolean;
  texto: string;
}

/** Como o aviso se reconhece do lado de fora. Ver `PrazoDeFala.textoDeEspera`. */
const MARCA_DO_AVISO = /ainda estou nisto/i;

/** Toda fala vista, para o dossiê. */
const FALAS: Array<{ turno: number; t: number; id: string; concluida: boolean; texto: string }> = [];

await limparMotoresEsquecidos([PORTA]);
let motor: MotorVivo | null = null;
const medidas: Medida[] = [];

try {
  motor = await subirMotor({
    porta: PORTA,
    rotulo: ROTULO,
    cerebro: CEREBRO,
    prazo_subida_ms: 60_000,
    ...(PRAZO_FALA || PRAZO_PROVEDOR
      ? {
          ambiente: {
            ...(PRAZO_FALA ? { IARA_PRAZO_FALA_MS: PRAZO_FALA } : {}),
            ...(PRAZO_PROVEDOR ? { IARA_PRAZO_PROVEDOR_MS: PRAZO_PROVEDOR } : {}),
          },
        }
      : {}),
  });
  const carimbo = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const cliente = new ClienteBarramento({
    url: motor.url_ws,
    /* Carimbo no id: o shard de memória vive em `dados/`, fora do sandbox, e um
       id fixo faria a rodada de hoje herdar a conversa de ontem. */
    id_usuario: `medida${carimbo}`,
    nome: 'Medição de prazo',
  });
  await cliente.conectar();

  for (const [i, texto] of ROTEIRO.entries()) {
    const antes = cliente.pacotes.length;
    /**
     * O ID DA FALA ANTERIOR, capturado ANTES de enviar — e ele é a diferença
     * entre medir e inventar.
     *
     * A primeira versão contava o primeiro snapshot com `fala.texto` não vazio,
     * e o snapshot CARREGA a última fala mesmo depois do turno acabar. Resultado
     * medido: todo turno a partir do segundo dava "perceptível = 53 ms" — o eco
     * da resposta anterior, não a resposta nova. Só o T1 de cada corrida era
     * medição de verdade, e a mediana inteira era artefato.
     *
     * É o mesmo cuidado que `ClienteBarramento.dizer` já tomava para saber
     * quando o turno acaba; faltava tomá-lo para saber quando ele COMEÇA a
     * aparecer.
     */
    const falaAnterior = cliente.snapshot?.fala?.id ?? null;
    const t0 = Date.now();
    const turno = await cliente.dizer(texto, PRAZO_MS);

    /**
     * O primeiro pacote DESTE turno que traria texto à tela. Lê-se do gravador
     * do cliente, não do retorno de `dizer` — `dizer` só devolve o fim, e o
     * começo é justamente o que se quer medir.
     */
    let perceptivel: number | null = null;
    let avisou = false;
    for (const p of cliente.pacotes.slice(antes)) {
      const b = p.bruto as {
        tipo?: string;
        snapshot?: { fala?: { texto?: string; id?: string } };
      };
      if (b?.tipo !== 'snapshot') continue;
      const fala = b.snapshot?.fala as
        | { texto?: string; id?: string; concluida?: boolean }
        | undefined;
      const texto = (fala?.texto ?? '').trim();
      if (texto.length > 0 && fala?.id) {
        const ultima = FALAS.at(-1);
        /* Só transições: o snapshot repete a mesma fala em cada emissão. */
        if (!ultima || ultima.id !== fala.id || ultima.concluida !== !!fala.concluida) {
          FALAS.push({
            turno: i + 1,
            t: p.t,
            id: fala.id,
            concluida: !!fala.concluida,
            texto: texto.slice(0, 100),
          });
        }
      }
      /* Fala do turno anterior não conta: ela já estava na tela antes de a
         pessoa apertar enter. */
      if (texto.length === 0 || !fala?.id || fala.id === falaAnterior) continue;
      if (perceptivel === null) perceptivel = p.t;
      if (MARCA_DO_AVISO.test(texto)) avisou = true;
    }
    /* `p.t` é relativo à abertura da conexão; o pedido começou em `t0`. A
       subtração precisa da mesma origem, então converte-se para relativo. */
    const inicioRelativo = cliente.pacotes[antes]?.t ?? null;
    const atePerceptivel =
      perceptivel !== null && inicioRelativo !== null ? perceptivel - inicioRelativo : null;

    medidas.push({
      n: i + 1,
      pedido: texto,
      ate_perceptivel_ms: atePerceptivel,
      ate_concluir_ms: turno.concluida ? Date.now() - t0 : null,
      mudo: !turno.concluida && atePerceptivel === null,
      avisou,
      texto: turno.resposta.replace(/\s+/g, ' ').slice(0, 120),
    });

    const m = medidas.at(-1)!;
    console.log(
      `T${m.n} perceptível=${m.ate_perceptivel_ms ?? 'NUNCA'}ms  ` +
        `concluiu=${m.ate_concluir_ms ?? 'NÃO'}ms  ${m.avisou ? 'AVISOU' : ''} ${m.mudo ? 'MUDO' : ''}`,
    );
    console.log(`    "${m.texto || '(nada)'}"`);
  }
  await cliente.fechar();
} finally {
  if (motor) await motor.encerrar();
}

const perceptiveis = medidas
  .map((m) => m.ate_perceptivel_ms)
  .filter((v): v is number => v !== null)
  .sort((a, b) => a - b);
const p = (q: number) => (perceptiveis.length ? perceptiveis[Math.floor(perceptiveis.length * q)] ?? perceptiveis.at(-1) : null);

const resumo = {
  rotulo: ROTULO,
  cerebro: CEREBRO,
  prazo_fala_imposto_ms: PRAZO_FALA ? Number(PRAZO_FALA) : null,
  instante: new Date().toISOString(),
  turnos: medidas.length,
  avisados: medidas.filter((m) => m.avisou).length,
  mudos: medidas.filter((m) => m.mudo).length,
  nunca_perceptivel: medidas.filter((m) => m.ate_perceptivel_ms === null).length,
  perceptivel_p50_ms: p(0.5),
  perceptivel_p95_ms: p(0.95),
  pior_espera_ms: perceptiveis.at(-1) ?? null,
  medidas,
};

const destino = path.join(RAIZ_WEB, 'test-evidence', `PRAZO-FALA-${ROTULO}`);
mkdirSync(destino, { recursive: true });
writeFileSync(path.join(destino, 'medida.json'), JSON.stringify(resumo, null, 2), 'utf8');
/* Toda fala que passou pelo barramento, com id e `concluida`. Sem isto, um
   resultado estranho vira teoria: foi assim que "o aviso virou a resposta"
   ficou sem explicação por uma rodada inteira. */
writeFileSync(path.join(destino, 'falas.jsonl'), FALAS.map((f) => JSON.stringify(f)).join('\n'), 'utf8');

console.log('\n=== RESUMO ===');
console.log(
  `turnos=${resumo.turnos} avisados=${resumo.avisados} mudos=${resumo.mudos} ` +
    `sem_nada=${resumo.nunca_perceptivel} · ` +
    `perceptível p50=${resumo.perceptivel_p50_ms ?? '—'}ms p95=${resumo.perceptivel_p95_ms ?? '—'}ms · ` +
    `pior espera=${resumo.pior_espera_ms ?? '—'}ms`,
);
console.log(`evidência: ${destino}`);
