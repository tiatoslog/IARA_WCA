/**
 * O CONTRATO SEMÂNTICO MEDIDO — o que a IARA entendeu, em estrutura.
 *
 * ESTE ARQUIVO É O APARATO DE MEDIDA, não o gabarito. Ele lê o sistema real e
 * devolve o que ele compreendeu; o que a frase DEVERIA significar está escrito
 * à mão em `cenarios.ts`, por quem conhece a operação, e nunca é calculado
 * daqui. Misturar os dois faria o circuito fechado que invalida o arnês:
 *
 *     IARA interpreta → IARA produz o esperado → IARA compara consigo → passa
 *
 * O QUE ELE NÃO MEDE, e a recusa é o que o mantém honesto: TEXTO. Nenhuma
 * asserção deste arnês olha a resposta que a IARA escreveria. Procurar
 * `resposta.includes('cargas')` passa sozinho — a IARA reescreve o pedido na
 * própria frase — e já produziu falso verde neste repositório antes
 * (`testes/navegador`, 19/08/2026). Aqui só entra ESTADO.
 *
 * ---------------------------------------------------------------------------
 * DOIS MODOS, MESMOS CASOS — é o que torna o antes/depois comparável
 * ---------------------------------------------------------------------------
 *
 *   `lexical`   como o sistema era até 21/08/2026: o objetivo sai do topo da
 *               `DescobertaCapacidades`, e propósito e referente só existem na
 *               família fechada do `ContratoFactual`. É a linha de base de 54%.
 *
 *   `semantica` com a `CompreensaoSemantica` no caminho: o objetivo sai do
 *               contrato, e `operacao` — que não existia — entra como dimensão.
 *
 * As duas leem os MESMOS `cenarios.ts`. Trocar os casos junto com a camada
 * produziria um delta que não mede nada, que é o modo mais comum de uma
 * migração parecer bem-sucedida.
 *
 * DETERMINISMO É PRÉ-REQUISITO. Sem rede, sem LLM, sem disco e com relógio
 * congelado (`AGORA`): duas execuções sobre a mesma frase têm de produzir o
 * mesmo contrato, ou a taxa medida é ruído. O runner verifica antes de publicar.
 */

import { MotorPercepcao } from '../../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../../servidor/nucleo/kernel/Planejador';
import { FuncaoExecutiva } from '../../servidor/nucleo/kernel/FuncaoExecutiva';
import { MemoriaTrabalho } from '../../servidor/nucleo/kernel/MemoriaTrabalho';
import {
  DescobertaCapacidades,
  margemRelativa,
} from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { compreender } from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { interpretarPeriodo } from '../../servidor/nucleo/kernel/PeriodoOperacional';
import { interpretarContratoFactual } from '../../servidor/nucleo/kernel/ContratoFactual';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';
import { FAMILIA_DA_HABILIDADE } from './cenarios';

/**
 * RELÓGIO CONGELADO. "essa semana" e "hoje" são janelas relativas; sem uma data
 * fixa o arnês mediria o calendário em vez de medir a compreensão, e a taxa
 * mudaria sozinha de uma quarta-feira para um domingo.
 */
export const AGORA = new Date('2026-08-19T10:00:00');

/** Ausência de valor. Nunca confundir com "convergiu" — ver `LACUNA` no runner. */
export const INDETERMINADO = 'indeterminado';

/**
 * Abaixo disto o segundo candidato carrega 85% ou mais do peso do primeiro, e
 * escolher o de cima é desempate numérico, não evidência. O número é uma régua
 * declarada, não uma medida: mexer nele muda o que o arnês chama de ambíguo, e
 * por isso ele mora aqui, visível, em vez de embutido numa comparação.
 */
export const LIMIAR_DISPUTA = 0.15;

export type Camada = 'lexical' | 'semantica';

export interface ContratoSemanticoMedido {
  /** A família de capacidade que a camada nomeia. */
  readonly objetivo: string;
  /** `leitura`, `criacao`, `contagem`… `indeterminado` na camada lexical. */
  readonly operacao: string;
  /** A janela de tempo, como `AAAA-MM-DD..AAAA-MM-DD`. `nenhum` = não nomeada. */
  readonly periodo: string;
  readonly proposito: string;
  /** O substantivo sobre o qual a pergunta é. */
  readonly referente: string;
  /** O caminho do pipeline. É a medida que a auditoria de 21/08 chamou de instável. */
  readonly rota: string;
  /** `clara` ou `disputada` — ver `LIMIAR_DISPUTA`. */
  readonly ambiguidade: 'clara' | 'disputada';
  /** Diagnóstico, não dimensão: os ids que a camada devolveu, em ordem. */
  readonly candidatos: readonly string[];
  readonly margem: number;
}

/** As dimensões que entram na taxa. `ambiguidade` é medida em bloco próprio. */
export const DIMENSOES = ['objetivo', 'operacao', 'periodo', 'proposito', 'referente', 'rota'] as const;
export type Dimensao = (typeof DIMENSOES)[number];

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const descoberta = new DescobertaCapacidades(MANIFESTOS);
const habilidades = MANIFESTOS.map((m) => m.id);
const conceitual = new IndiceConceitual(MANIFESTOS);
const percepcao = new MotorPercepcao();

const familiaDe = (id: string | null): string =>
  id === null ? INDETERMINADO : (FAMILIA_DA_HABILIDADE.get(id) ?? `fora_de_familia:${id}`);

/**
 * A `FuncaoExecutiva` nasce por chamada de propósito: ela recebe uma
 * `MemoriaTrabalho`, e memória compartilhada entre casos faria o resultado do
 * caso 40 depender do caso 39 — que é medir sequência, não invariância.
 */
function decidirRota(bruto: string, camada: Camada): string {
  /**
   * A CAMADA SÓ É INJETADA NO MODO 'semantica'. É o que faz a coluna ANTES
   * reproduzir o pipeline como ele era, em vez de guardar um número solto que
   * ninguém pode recalcular no dia em que duvidar dele.
   */
  const executiva = new FuncaoExecutiva(
    new Planejador(),
    new MemoriaTrabalho(),
    ['João Silva', 'Marina Alves'],
    () => true,
    descoberta,
    camada === 'semantica'
      ? (b) => {
          const c = compreender({ bruto: b, descoberta, conceitual, agora: AGORA, habilidades });
          return { ato: c.ato, objetivo: c.objetivo };
        }
      : null,
  );
  return executiva.decidir(percepcao.perceber(bruto), {
    historicoRecente: [],
    pessoasConhecidas: ['João Silva', 'Marina Alves'],
  }).rota;
}

export function interpretar(bruto: string, camada: Camada = 'semantica'): ContratoSemanticoMedido {
  const p = interpretarPeriodo(bruto, AGORA);
  const periodo = p ? `${p.inicio}..${p.fim}` : 'nenhum';
  const rota = decidirRota(bruto, camada);

  if (camada === 'lexical') {
    /**
     * O SISTEMA COMO ELE ERA. Reproduzido aqui em vez de guardado num número
     * solto: uma linha de base que não pode ser recalculada deixa de ser
     * verificável no dia em que alguém duvidar dela.
     */
    const candidatos = descoberta.descobrirCandidatos(bruto);
    const margem = margemRelativa(candidatos);
    const leitura = interpretarContratoFactual(bruto);
    return {
      objetivo: familiaDe(candidatos[0]?.habilidade ?? null),
      operacao: INDETERMINADO,
      periodo,
      proposito: leitura.tipo === 'contrato' ? leitura.contrato.operacao : INDETERMINADO,
      referente:
        leitura.tipo === 'contrato'
          ? leitura.contrato.dimensao !== 'nenhum'
            ? leitura.contrato.dimensao
            : leitura.contrato.entidade
          : INDETERMINADO,
      rota,
      ambiguidade: margem < LIMIAR_DISPUTA ? 'disputada' : 'clara',
      candidatos: candidatos.map((c) => c.habilidade),
      margem,
    };
  }

  const c = compreender({ bruto, descoberta, conceitual, agora: AGORA, habilidades });
  return {
    objetivo: familiaDe(c.objetivo),
    operacao: c.operacao ?? INDETERMINADO,
    periodo,
    proposito: c.proposito ?? INDETERMINADO,
    referente: c.referente.conceito ?? INDETERMINADO,
    rota,
    ambiguidade: c.margem < LIMIAR_DISPUTA ? 'disputada' : 'clara',
    candidatos: c.hipoteses.map((h) => h.objetivo),
    margem: c.margem,
  };
}
