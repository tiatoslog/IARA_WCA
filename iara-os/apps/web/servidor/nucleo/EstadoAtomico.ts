/**
 * Guardião do estado. Ninguém escreve em `EstadoEscritorio` fora desta classe.
 *
 * A LLM é PROIBIDA de alterar estado diretamente: ela emite intenções, e
 * `aplicarIntencao` valida cada uma em tempo de execução antes de mutar.
 * Intenção malformada é descartada com log, nunca aplicada parcialmente.
 */

import {
  LEITURA_INICIAL,
  LUZES_APAGADAS,
  METRICAS_INICIAIS,
  OBJETO_DA_CAPACIDADE,
  estadoInicial,
  limitar,
  type CapacidadeAtiva,
  type EstadoEscritorio,
  type EstagioCognitivo,
  type LeituraOperador,
  type MapaLuzes,
  type MetricasVitais,
  type OrigemRaciocinio,
  type PerfilOperador,
} from '../../lib/estado';
import { TravaAssincrona } from './TravaAssincrona';

/** Campos numéricos que uma intenção pode mover. */
export type CampoVital = keyof MetricasVitais;

const CAMPOS_VITAIS: readonly CampoVital[] = [
  'energia_cognitiva',
  'paciencia_operacional',
  'afinidade',
  'carga_contextual',
];

/** Intenção estruturada — o único formato que a LLM pode emitir. */
export interface IntencaoMutacao {
  campo: string;
  delta: number;
  motivo?: string;
}

export class EstadoAtomico {
  private readonly trava = new TravaAssincrona();
  private estado: EstadoEscritorio = estadoInicial();

  /** Cópia defensiva. O chamador nunca recebe a referência interna. */
  instantaneo(): EstadoEscritorio {
    return {
      ...this.estado,
      metricas: { ...this.estado.metricas },
      leitura: { ...this.estado.leitura, sinais: [...this.estado.leitura.sinais] },
      luzes: { ...this.estado.luzes },
      operador: this.estado.operador ? { ...this.estado.operador } : null,
    };
  }

  get seq(): number {
    return this.estado.seq;
  }

  private proximoSeq(): void {
    this.estado.seq += 1;
    this.estado.instante = Date.now();
  }

  async definirOperador(operador: PerfilOperador): Promise<EstadoEscritorio> {
    return this.trava.executar(() => {
      /**
       * Métricas só zeram quando o OPERADOR muda. Reconexão (queda de rede,
       * F5) chama isto de novo para o mesmo operador — resetar aqui apagaria
       * energia/paciência/afinidade acumuladas e contradiria o contrato do
       * takeover: "derruba o transporte antigo, preserva estado e kernel".
       */
      const mesmoOperador = this.estado.operador?.id_usuario === operador.id_usuario;
      this.estado.operador = { ...operador };
      if (!mesmoOperador) {
        this.estado.metricas = { ...METRICAS_INICIAIS };
        this.estado.leitura = { ...LEITURA_INICIAL, sinais: [] };
      }
      this.proximoSeq();
      return this.instantaneo();
    });
  }

  /**
   * Os DOIS campos sob a mesma trava, de propósito: `nuvem_indisponivel`
   * preserva a semântica original ("a nuvem Anthropic não está utilizável") e
   * `origem_raciocinio` diz o que existe no lugar. Gravá-los em chamadas
   * separadas abriria uma janela em que o snapshot afirma "sem nuvem" e "sem
   * origem" ao mesmo tempo — e a projeção mostraria um aviso mentiroso.
   */
  async definirOrigemRaciocinio(origem: OrigemRaciocinio): Promise<void> {
    await this.trava.executar(() => {
      this.estado.origem_raciocinio = origem;
      this.estado.nuvem_indisponivel = origem !== 'nuvem';
      this.proximoSeq();
    });
  }

  async transicionar(
    estagio: EstagioCognitivo,
    capacidade: CapacidadeAtiva | null,
  ): Promise<EstadoEscritorio> {
    return this.trava.executar(() => {
      this.estado.estagio = estagio;
      this.estado.capacidade = capacidade;
      this.estado.luzes = calcularLuzes(estagio, capacidade, this.estado.metricas);
      this.proximoSeq();
      return this.instantaneo();
    });
  }

  async definirLeitura(leitura: LeituraOperador): Promise<EstadoEscritorio> {
    return this.trava.executar(() => {
      this.estado.leitura = { ...leitura, sinais: [...leitura.sinais] };
      this.proximoSeq();
      return this.instantaneo();
    });
  }

  /**
   * Mutação numérica sob trava. Retorna `null` quando a intenção é inválida —
   * o chamador loga e segue; o estado permanece intacto.
   */
  async aplicarIntencao(intencao: IntencaoMutacao): Promise<EstadoEscritorio | null> {
    return this.trava.executar(() => {
      if (!CAMPOS_VITAIS.includes(intencao.campo as CampoVital)) return null;
      if (typeof intencao.delta !== 'number' || !Number.isFinite(intencao.delta)) return null;
      // Uma intenção nunca move mais de 30% de uma métrica de uma vez.
      const delta = Math.max(-0.3, Math.min(0.3, intencao.delta));

      const campo = intencao.campo as CampoVital;
      this.estado.metricas[campo] = limitar(this.estado.metricas[campo] + delta);
      this.estado.luzes = calcularLuzes(
        this.estado.estagio,
        this.estado.capacidade,
        this.estado.metricas,
      );
      this.proximoSeq();
      return this.instantaneo();
    });
  }

  /** Regeneração no ócio. Chamada só pelo ciclo autônomo. */
  async respirar(): Promise<EstadoEscritorio> {
    return this.trava.executar(() => {
      const m = this.estado.metricas;
      m.energia_cognitiva = limitar(m.energia_cognitiva + 0.02);
      m.paciencia_operacional = limitar(m.paciencia_operacional + 0.03);
      m.carga_contextual = limitar(m.carga_contextual - 0.01);
      this.estado.luzes = calcularLuzes(this.estado.estagio, this.estado.capacidade, m);
      this.proximoSeq();
      return this.instantaneo();
    });
  }
}

/**
 * Luz é consequência de estado, nunca decoração. Um objeto só acende porque
 * a capacidade correspondente está em uso agora.
 */
function calcularLuzes(
  estagio: EstagioCognitivo,
  capacidade: CapacidadeAtiva | null,
  metricas: MetricasVitais,
): MapaLuzes {
  const luzes: MapaLuzes = { ...LUZES_APAGADAS };

  // A janela é a percepção passiva: sempre há um fio de luz do mundo externo.
  luzes.janela = 0.25;
  // A planta responde à paciência — o único indicador ambiente honesto.
  luzes.planta = 0.15 + metricas.paciencia_operacional * 0.2;
  // O rack marca a carga acumulada da sessão, com ou sem raciocínio ativo.
  luzes.rack = 0.12 + metricas.carga_contextual * 0.35;

  if (capacidade) {
    const alvo = OBJETO_DA_CAPACIDADE[capacidade];
    luzes[alvo] = estagio === 'pensando' ? 1 : 0.75;
  }
  if (estagio === 'falando') {
    luzes.terminal = Math.max(luzes.terminal, 0.4);
  }
  if (estagio === 'ocioso') {
    luzes.quadro_metas = 0.2;
  }
  return luzes;
}
