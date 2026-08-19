/**
 * MAPA ROTA × ORÁCULO — a auditoria que decide o desenho do Fault Injection.
 *
 * A escalada só pode disparar quando uma pergunta satisfaz DUAS condições ao
 * mesmo tempo:
 *
 *   1. chega à ROTA COGNITIVA (senão não há resposta de modelo a contestar);
 *   2. o `VerificadorDeterministico` a reconhece com oráculo ESCALÁVEL.
 *
 * Se nenhuma pergunta satisfizer as duas, o ramo `invalido → escalar` é
 * inalcançável em produção — e isso seria um achado, não um detalhe do teste.
 *
 * Instrumento: observa e imprime. Não altera nada.
 */
import { BarramentoEventos } from '../../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../../servidor/nucleo/EstadoAtomico';
import { Kernel } from '../../servidor/nucleo/kernel/Kernel';
import { VerificadorDeterministico, RAIZ_DO_APP } from '../../servidor/nucleo/kernel/VerificacaoRuntime';
import type { MotorRaciocinio } from '../../servidor/nucleo/kernel/MotorRaciocinio';

const memoria = () =>
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

/** Cérebro que responde uma frase fixa. Só serve para o turno chegar ao fim. */
const cerebro = {
  disponivel: true,
  modelo: 'sonda',
  origem: 'nuvem' as const,
  async planejar() {
    return null;
  },
  async responder(p: { aoReceberTexto: (t: string) => void }) {
    p.aoReceberTexto('resposta de sonda com 1234');
    return { texto: 'resposta de sonda com 1234', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
  },
} as unknown as MotorRaciocinio;

const PERGUNTAS = [
  'quantas centrais ativas existem?',
  'compare o número de centrais ativas com o do mês passado e diga se cresceu',
  'faça um resumo executivo e diga quantas centrais ativas temos',
  'analise a operação e me diga o total de centrais ativas por região',
  'quantas cargas existem na base 2026?',
  'que horas são?',
  'me explique como você decide usar uma ferramenta',
];

const verificador = new VerificadorDeterministico({
  raiz: RAIZ_DO_APP,
  fontesAusentes: () => ['LUFT'],
});

console.log('| pergunta | rota | reconhece? | conclusão |');
console.log('|---|---|---|---|');

for (const [i, pergunta] of PERGUNTAS.entries()) {
  const barramento = new BarramentoEventos(`s-mapa${i}`);
  const kernel = new Kernel({
    sessao: `s-mapa${i}`,
    idUsuario: `u-mapa${i}`,
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoria(),
    barramento,
    raciocinio: cerebro,
    /* Verificação desligada: aqui só interessa a ROTA. O reconhecimento é
       perguntado direto ao verificador, fora do turno. */
    verificacao: null,
  });

  let rota = '(nenhuma)';
  barramento.assinarTudo((e) => {
    if (e.tipo === 'DECISAO_TOMADA') rota = e.rota;
  });
  await kernel.processar(pergunta);

  const reconhece = verificador.reconhece(pergunta);
  const cognitiva = rota.includes('cognitivo');
  /* O que importa não é reconhecer: é o oráculo ser ESCALÁVEL. Um veredito
     `escalavel: false` (hora errada, fonte ausente) nunca chega a `escalar`. */
  const v = verificador.verificar('São 9999 unidades.', {
    pergunta,
    inicio_ms: Date.now(),
    fim_ms: Date.now(),
  });
  const escalavel = v.status === 'invalido' && v.escalavel;
  const conclusao = !reconhece
    ? 'sem oráculo'
    : !cognitiva
      ? 'oráculo existe, mas a rota não chama modelo'
      : escalavel
        ? '**SERVE PARA O FI**'
        : `cognitiva, mas o veredito é ${v.status}${v.status === 'invalido' ? ' NÃO escalável' : ''}`;
  console.log(`| ${pergunta} | ${rota} | ${reconhece} | ${conclusao} |`);
}
