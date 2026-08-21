/**
 * ARNÊS C — quando a IARA entende, ela escolhe a rota correspondente?
 *
 * ===========================================================================
 * O DADO QUE PEDIU ESTE ARNÊS
 * ===========================================================================
 *
 *     ARNÊS B (compreensão correta)   1/13  →  13/13   100%
 *     rota                            49/72 →  49/72    68%    Δ = 0
 *
 * A rota não se moveu UM CASO em três fases de trabalho sobre compreensão. Isso
 * não é ruído: é a assinatura de um decisor que não consome o que a camada de
 * compreensão produz. O cérebro passou a saber o que a pessoa quis dizer, e o
 * decisor continuou decidindo pelos sinais que ele já tinha.
 *
 * ===========================================================================
 * O QUE ESTE ARNÊS FAZ, E O QUE ELE RECUSA FAZER
 * ===========================================================================
 *
 * Ele NÃO conserta nada. Ele CLASSIFICA cada falha em três situações que se
 * consertam em lugares diferentes — e misturá-las é como uma equipe passa uma
 * semana corrigindo o componente errado:
 *
 *   A — COMPREENSÃO   o contrato saiu errado
 *                     → o decisor não tem culpa; conserta-se antes dele
 *
 *   B — ADMISSÃO      contrato certo, nenhuma capacidade compatível
 *                     → é o catálogo, a declaração ou a compatibilidade
 *
 *   C — DECISÃO       contrato certo + candidato certo + rota errada
 *                     → é a `FuncaoExecutiva`. Aqui, e só aqui, o decisor falhou
 *
 * A ordem é uma cascata de propósito: sem contrato correto não se pode
 * responsabilizar a admissão, e sem candidato não se pode responsabilizar a
 * decisão. Um caso é classificado no PRIMEIRO elo que quebra.
 *
 * ===========================================================================
 * O GABARITO É EXTERNO E É DE SIGNIFICADO, NÃO DE HABILIDADE
 * ===========================================================================
 *
 * `Cenario.objetivoSemantico` (`contar_carga`, `consultar_disponibilidade`) é
 * escrito à mão em `cenarios.ts`. Se o esperado fosse o `id` da habilidade,
 * toda lacuna de CATÁLOGO seria contada como falha de COMPREENSÃO — a mistura
 * que esta fase existe para desfazer. A IARA pode entender perfeitamente um
 * pedido que ela não sabe atender.
 *
 * A EXPECTATIVA DE ROTA NÃO É ESCRITA À MÃO, e não deveria: ela é a REGRA que o
 * sistema deveria cumprir, aplicada ao contrato que ele mesmo produziu —
 *
 *     ato de pedido + candidato compatível  →  rota operacional
 *     ato de conversa                       →  raciocinio_direto
 *
 * Escrever 85 rotas esperadas à mão travaria o arnês numa tabela e esconderia
 * a regra; deixá-la explícita permite discutir a REGRA quando ela falhar, que é
 * a conversa que interessa.
 */

import {
  compreender,
  type ContratoSemantico,
} from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { FuncaoExecutiva } from '../../servidor/nucleo/kernel/FuncaoExecutiva';
import { Planejador } from '../../servidor/nucleo/kernel/Planejador';
import { MemoriaTrabalho } from '../../servidor/nucleo/kernel/MemoriaTrabalho';
import { MotorPercepcao } from '../../servidor/nucleo/kernel/Percepcao';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';
import { CENARIOS } from './cenarios';

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const descoberta = new DescobertaCapacidades(MANIFESTOS);
const conceitual = new IndiceConceitual(MANIFESTOS);
const habilidades = MANIFESTOS.map((m) => m.id);
const percepcao = new MotorPercepcao();
export const AGORA_C = new Date('2026-08-19T10:00:00');

/**
 * ROTA OPERACIONAL = a IARA vai FAZER alguma coisa a respeito.
 *
 * `esclarecer` entra na lista de propósito: perguntar de volta é uma decisão
 * operacional legítima — é o sistema dizendo "entendi o pedido e falta um
 * dado". O que NÃO é operacional é `raciocinio_direto`, que responde de
 * cabeça, sem catálogo e sem plano.
 */
const OPERACIONAIS = new Set(['plano_local', 'plano_cognitivo', 'esclarecer']);

/**
 * Ler, contar e analisar são a MESMA família para efeito de rota: nenhuma
 * escreve. É a mesma partição que a trava de compatibilidade usa.
 */
const FAMILIA_LEITURA = new Set(['leitura', 'contagem', 'analise']);
const familiaDeOperacao = (op: string): string => (FAMILIA_LEITURA.has(op) ? 'leitura' : op);
const ATOS_DE_PEDIDO = new Set(['perguntar', 'solicitar_acao', 'recapitular']);

export type Elo = 'compreensao' | 'admissao' | 'decisao';
export type Veredito = 'PASS' | 'FAIL' | 'N/A';

export interface CadeiaDeDiagnostico {
  readonly frase: string;
  readonly registro: string;
  readonly intencao: string;
  readonly objetivoEsperado: string;
  readonly objetivoProduzido: string | null;
  readonly ato: string;
  readonly operacao: string | null;
  readonly candidatos: readonly string[];
  readonly candidatoAdmitido: string | null;
  readonly rotaEscolhida: string;
  readonly rotaEsperada: string;
  readonly compreensao: Veredito;
  readonly admissao: Veredito;
  readonly decisao: Veredito;
  /** O primeiro elo que quebrou, ou `null` quando a cadeia inteira passou. */
  readonly culpado: Elo | null;
}

function decidirRota(bruto: string, contrato: ContratoSemantico): string {
  /**
   * A `FuncaoExecutiva` nasce por chamada: `MemoriaTrabalho` compartilhada faria
   * o caso 40 depender do caso 39, que é medir sequência e não decisão.
   *
   * A camada de compreensão é injetada exatamente como o `Kernel` a injeta —
   * medir o decisor com uma configuração que a produção não usa não mediria
   * nada.
   */
  const executiva = new FuncaoExecutiva(
    new Planejador(),
    new MemoriaTrabalho(),
    ['João Silva', 'Marina Alves'],
    () => true,
    descoberta,
    () => ({ ato: contrato.ato, objetivo: contrato.objetivo }),
  );
  return executiva.decidir(percepcao.perceber(bruto), {
    historicoRecente: [],
    pessoasConhecidas: ['João Silva', 'Marina Alves'],
  }).rota;
}

function diagnosticar(
  frase: string,
  registro: string,
  intencao: string,
  objetivoEsperado: string,
  operacaoEsperada: string,
): CadeiaDeDiagnostico {
  const c = compreender({ bruto: frase, descoberta, conceitual, agora: AGORA_C, habilidades });
  const rotaEscolhida = decidirRota(frase, c);

  // --- ELO A: a compreensão está correta? -----------------------------------
  /**
   * O PORTÃO É A FAMÍLIA DA OPERAÇÃO, não a string do objetivo.
   *
   * `leitura`, `contagem` e `analise` são intercambiáveis para efeito de rota —
   * as três leem e nenhuma escreve — e é assim que `operacoesCompativeis` já as
   * trata. Reprovar « quanto de memória? » por ter saído `contagem` onde o
   * gabarito disse `leitura` mediria a minha escolha de palavra, não a
   * compreensão da IARA.
   *
   * O que NÃO se afrouxa é a travessia leitura↔escrita: `criacao`, `alteracao`,
   * `remocao`, `envio` e `execucao` só casam consigo mesmas.
   */
  const compreensao: Veredito =
    c.operacao !== null && familiaDeOperacao(c.operacao) === familiaDeOperacao(operacaoEsperada)
      ? 'PASS'
      : 'FAIL';

  // --- ELO B: existe capacidade compatível? ---------------------------------
  /**
   * Compatível é o que a trava estrutural aceitaria: operação da habilidade
   * casando com a da frase. Um candidato incompatível na lista não é admissão —
   * ele está lá rebaixado, de propósito, para o contexto poder resgatá-lo.
   */
  const admitido = c.hipoteses.find((h) => h.compativel) ?? null;
  const admissao: Veredito =
    compreensao === 'FAIL' ? 'N/A' : admitido !== null ? 'PASS' : 'FAIL';

  // --- ELO C: a rota reflete o que foi entendido? ---------------------------
  const deveriaSerOperacional = ATOS_DE_PEDIDO.has(c.ato);
  const rotaEsperada = deveriaSerOperacional ? 'operacional' : 'raciocinio_direto';
  const rotaOk = deveriaSerOperacional
    ? OPERACIONAIS.has(rotaEscolhida)
    : rotaEscolhida === 'raciocinio_direto';
  const decisao: Veredito =
    compreensao === 'FAIL' || admissao === 'FAIL' ? 'N/A' : rotaOk ? 'PASS' : 'FAIL';

  const culpado: Elo | null =
    compreensao === 'FAIL' ? 'compreensao' : admissao === 'FAIL' ? 'admissao' : decisao === 'FAIL' ? 'decisao' : null;

  return {
    frase,
    registro,
    intencao,
    objetivoEsperado: objetivoEsperado + " [op " + operacaoEsperada + "]",
    objetivoProduzido: c.objetivoSemantico,
    ato: c.ato,
    operacao: c.operacao,
    candidatos: c.hipoteses.slice(0, 3).map((h) => `${h.objetivo}${h.compativel ? '' : '✗'}`),
    candidatoAdmitido: admitido?.objetivo ?? null,
    rotaEscolhida,
    rotaEsperada,
    compreensao,
    admissao,
    decisao,
    culpado,
  };
}

export function rodarArnesC(): readonly CadeiaDeDiagnostico[] {
  const saida: CadeiaDeDiagnostico[] = [];
  for (const cenario of CENARIOS) {
    saida.push(diagnosticar(cenario.limpa, 'limpa', cenario.nome, cenario.objetivoSemantico, cenario.operacaoEsperada));
    for (const v of cenario.variacoes) {
      saida.push(diagnosticar(v.frase, v.registro, cenario.nome, cenario.objetivoSemantico, cenario.operacaoEsperada));
    }
  }
  return saida;
}
