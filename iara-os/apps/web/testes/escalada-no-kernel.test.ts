/**
 * A ESCALADA DENTRO DO KERNEL — turno de verdade, do pedido à fala.
 *
 * O arquivo irmão (`escalada-verificada.test.ts`) testa a máquina de estados e
 * os oráculos isolados. Aqui o que se confere é o que nenhum deles alcança: que
 * a decisão CHEGA ao operador, que o orçamento é debitado de fato, que o pool
 * premium é chamado exatamente uma vez, e que o número contestado nunca sai.
 *
 * A pergunta experimental da fatia, em uma frase: *a IARA detecta uma resposta
 * errada durante o turno e gasta conscientemente uma segunda tentativa com um
 * modelo melhor, sem estourar orçamento e sem entrar em laço?*
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import { TETOS_PADRAO } from '../servidor/nucleo/kernel/OrcamentoDoTurno';
import type {
  ContextoDaTarefa,
  PortaVerificacaoRuntime,
  ResultadoVerificacao,
} from '../lib/verificacao/contrato';

/** O mesmo dublê que o resto da suíte usa. Escrever um próprio custou uma
 *  rodada inteira de falsos vermelhos: faltava `historico`, e o turno morria
 *  antes de chegar à síntese — que é justamente onde a verificação mora. */
const memoriaFalsa = () =>
  ({
    async registrar() {},
    async historico() {
      return [];
    },
    async carregarGlobal() {
      return '';
    },
    async lerPreferencias() {
      return {} as never;
    },
  }) as never;

/** Um verificador que responde o que o teste mandar, na ordem. */
function verificadorRoteirizado(vereditos: ResultadoVerificacao[]): PortaVerificacaoRuntime & {
  chamadas: string[];
} {
  const chamadas: string[] = [];
  let i = 0;
  return {
    chamadas,
    reconhece: () => true,
    verificar(resposta: string, _ctx: ContextoDaTarefa): ResultadoVerificacao {
      chamadas.push(resposta);
      return vereditos[Math.min(i++, vereditos.length - 1)];
    },
  };
}

function cerebroFalso(o: {
  barato: string;
  premium?: string;
  premiumSaudavel?: boolean;
  premiumExplode?: boolean;
}) {
  const chamadasPremium: string[] = [];
  const motor = {
    disponivel: true,
    modelo: 'teste',
    origem: 'nuvem' as const,
    get premiumSaudavel() {
      return o.premiumSaudavel ?? true;
    },
    async planejar() {
      return null;
    },
    async responder(p: { aoReceberTexto: (t: string) => void }) {
      p.aoReceberTexto(o.barato);
      return { texto: o.barato, tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
    },
    async responderNoPremium(_pedido: unknown, contestacao: string) {
      chamadasPremium.push(contestacao);
      if (o.premiumExplode) throw new Error('premium fora do ar');
      return { texto: o.premium ?? '', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
    },
  };
  return { motor: motor as unknown as MotorRaciocinio, chamadasPremium };
}

const CONTESTADO: ResultadoVerificacao = {
  status: 'invalido',
  motivo: 'a fala afirma 1234 e a fonte diz 1178',
  evidencia: { fonte: 'dados-infraestrutura', esperado: '1178', obtido: '1234', detalhe: 'd' },
  escalavel: true,
};
const OK: ResultadoVerificacao = {
  status: 'valido',
  evidencia: { fonte: 'dados-infraestrutura', esperado: '1178', obtido: '1178', detalhe: 'd' },
};
const NAO_SEI: ResultadoVerificacao = { status: 'inconclusivo', motivo: 'sem oráculo' };

/**
 * UMA PERGUNTA QUE CHEGA À SÍNTESE, e a escolha custou uma rodada de falsos
 * vermelhos: "quantas centrais ativas existem?" tem âncora determinística e é
 * respondida por `consultar_infraestrutura` sem passar por modelo nenhum — a
 * verificação nunca era alcançada.
 *
 * É também o achado que a escolha revela: o alvo real da verificação em runtime
 * é a ROTA COGNITIVA, onde a LLM redige de cabeça. Onde já existe receita
 * determinística, o número nunca foi inventado.
 */
const PERGUNTA_COGNITIVA = 'me explique em uma frase como você decide usar uma ferramenta';

async function turno(o: {
  pergunta?: string;
  vereditos: ResultadoVerificacao[];
  cerebro: ReturnType<typeof cerebroFalso>;
  tetos?: Partial<{ chamadas_modelo: number; tentativas_provedor: number }>;
}) {
  const barramento = new BarramentoEventos('s-escalada');
  const verificacao = verificadorRoteirizado(o.vereditos);
  const kernel = new Kernel({
    sessao: 's-escalada',
    idUsuario: 'u-escalada',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    raciocinio: o.cerebro.motor,
    verificacao,
    ...(o.tetos
      ? {
          tetosOrcamento: {
            voltas: TETOS_PADRAO.voltas,
  passos: 6,
            chamadas_modelo: o.tetos.chamadas_modelo ?? 3,
            tentativas_provedor: o.tetos.tentativas_provedor ?? 6,
            efeitos_externos: 4,
            tokens: 120_000,
            tempo_ms: 900_000,
            custo_micro_centavos: Number.MAX_SAFE_INTEGER,
          },
        }
      : {}),
  });

  let fala = '';
  const falhas: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') fala = e.texto;
    if (e.tipo === 'FALHA') falhas.push(`${e.modulo}: ${e.mensagem}`);
  });

  await kernel.processar(o.pergunta ?? PERGUNTA_COGNITIVA);
  return { fala, falhas, verificacao };
}

test('K1. contestado → escala → premium acerta → a resposta premium é a que sai', async () => {
  const cerebro = cerebroFalso({ barato: 'São 1234 centrais ativas.', premium: 'São 1178 centrais ativas.' });
  const { fala } = await turno({ vereditos: [CONTESTADO, OK], cerebro });

  assert.equal(cerebro.chamadasPremium.length, 1, 'o pool premium foi chamado uma vez');
  assert.match(fala, /1178/);
  assert.doesNotMatch(fala, /1234/, 'o número contestado não pode chegar ao operador');
});

test('K2. a contestação VIAJA para o premium — não é o mesmo pedido repetido', async () => {
  /* Repetir a mesma pergunta a um modelo melhor é apostar na sorte. Dizer o que
     a fonte independente afirma transforma a segunda chamada em correção. */
  const cerebro = cerebroFalso({ barato: 'São 1234.', premium: 'São 1178.' });
  await turno({ vereditos: [CONTESTADO, OK], cerebro });
  assert.match(cerebro.chamadasPremium[0], /1178/);
});

test('K3. o laço TERMINA: premium também erra e não existe terceira chamada', async () => {
  const cerebro = cerebroFalso({ barato: 'São 1234.', premium: 'São 999.' });
  /* ORÇAMENTO FOLGADO DE PROPÓSITO. Com o teto padrão, era ELE que impedia a
     segunda escalada, e o teste passava mesmo com a trava de escalada única
     removida — defesa em profundidade escondendo qual defesa estava agindo.
     Aqui só `ja_escalou` pode segurar. */
  const { fala, falhas } = await turno({
    vereditos: [CONTESTADO, CONTESTADO],
    cerebro,
    tetos: { chamadas_modelo: 9, tentativas_provedor: 20 },
  });

  assert.equal(cerebro.chamadasPremium.length, 1, 'uma escalada por TURNO, não por verificação');
  assert.doesNotMatch(fala, /\b(1234|999)\b/, 'nenhum dos dois valores contestados pode sair');
  assert.match(fala, /não confirmei|não bateu/i);
  assert.ok(falhas.some((f) => /verdade/.test(f)));
});

test('K4. inconclusivo entrega a resposta e NUNCA chama o premium', async () => {
  /* A imensa maioria dos turnos. Escalar aqui faria toda conversa custar dois
     modelos. */
  const cerebro = cerebroFalso({ barato: 'Uma resposta qualquer.' });
  const { fala } = await turno({ vereditos: [NAO_SEI], cerebro });

  assert.equal(cerebro.chamadasPremium.length, 0);
  assert.match(fala, /resposta qualquer/);
});

test('K5. válido de primeira entrega sem gastar premium', async () => {
  const cerebro = cerebroFalso({ barato: 'São 1178 centrais ativas.' });
  const { fala } = await turno({ vereditos: [OK], cerebro });
  assert.equal(cerebro.chamadasPremium.length, 0);
  assert.match(fala, /1178/);
});

test('K6. sem orçamento para a segunda chamada, degrada em vez de escalar', async () => {
  /**
   * DENIED_BY_BUDGET. O teto de chamadas é 1: a síntese barata já o gastou, e a
   * escalada não tem com o que pagar. O operador recebe a limitação, nunca o
   * número contestado.
   */
  const cerebro = cerebroFalso({ barato: 'São 1234.', premium: 'São 1178.' });
  const { fala } = await turno({
    vereditos: [CONTESTADO, OK],
    cerebro,
    tetos: { chamadas_modelo: 2 },
  });

  assert.equal(cerebro.chamadasPremium.length, 0, 'escalou sem orçamento');
  assert.doesNotMatch(fala, /1234/);
  assert.match(fala, /não confirmei|não bateu/i);
});

test('K7. sem pool premium saudável, degrada — não tenta o barato de novo', async () => {
  const cerebro = cerebroFalso({ barato: 'São 1234.', premiumSaudavel: false });
  const { fala } = await turno({ vereditos: [CONTESTADO], cerebro });

  assert.equal(cerebro.chamadasPremium.length, 0);
  assert.doesNotMatch(fala, /1234/);
});

test('K8. premium fora do ar não devolve o número contestado', async () => {
  /* Falha de PROVEDOR não é valor confirmado. A resposta honesta continua sendo
     a degradação — nunca o número que a fonte desmentiu. */
  const cerebro = cerebroFalso({ barato: 'São 1234.', premiumExplode: true });
  const { fala, falhas } = await turno({ vereditos: [CONTESTADO], cerebro });

  assert.doesNotMatch(fala, /1234/);
  assert.ok(falhas.some((f) => /escalada/.test(f)));
});

test('K9. a resposta contestada não streama antes do veredito', async () => {
  /**
   * Se ela streamasse, o operador leria "1234" e veria o texto ser trocado meio
   * segundo depois — a tela mentindo e se corrigindo. `reconhece` arma a trava
   * da fala ANTES da chamada ao modelo justamente para isso.
   */
  const barramento = new BarramentoEventos('s-trava');
  const cerebro = cerebroFalso({ barato: 'São 1234.', premium: 'São 1178.' });
  const kernel = new Kernel({
    sessao: 's-trava',
    idUsuario: 'u-trava',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    raciocinio: cerebro.motor,
    verificacao: verificadorRoteirizado([CONTESTADO, OK]),
  });

  const trechos: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'RESPOSTA_TRECHO') trechos.push(e.texto);
  });
  await kernel.processar(PERGUNTA_COGNITIVA);

  assert.equal(
    trechos.some((t) => t.includes('1234')),
    false,
    'o número contestado apareceu na tela antes de ser conferido',
  );
});

test('K10. desligar a verificação com `null` devolve o comportamento anterior', async () => {
  /* `undefined` vale o padrão; `null` declara que não se quer verificação. A
     diferença importa: um teste que passa `null` está decidindo, não esquecendo. */
  const barramento = new BarramentoEventos('s-off');
  const cerebro = cerebroFalso({ barato: 'São 1234.' });
  const kernel = new Kernel({
    sessao: 's-off',
    idUsuario: 'u-off',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    raciocinio: cerebro.motor,
    verificacao: null,
  });
  let fala = '';
  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') fala = e.texto;
  });
  await kernel.processar(PERGUNTA_COGNITIVA);

  assert.match(fala, /1234/);
  assert.equal(cerebro.chamadasPremium.length, 0);
});
