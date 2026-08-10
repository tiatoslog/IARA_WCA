/**
 * Ciclo autônomo — o "sonho" computacional.
 *
 * Roda em background como tarefa cancelável. Duas responsabilidades:
 *
 *  1. RESPIRAR: regenera energia e paciência no ócio. Isso não é enfeite —
 *     é o que faz a IARA de terça de manhã ser diferente da IARA de sexta
 *     às 18h depois de trinta incidentes.
 *  2. CONSOLIDAR: na janela noturna, varre o shard de CADA operador em
 *     isolamento e grava `InsightRelacional` no shard privado dele.
 *
 * Ele NÃO publica no barramento cognitivo: respirar não é um fato do turno do
 * operador, é metabolismo. Ele apenas avisa que o estado mudou, e quem projeta
 * decide o que fazer com isso.
 */

import type { EstadoAtomico } from './EstadoAtomico';
import type { MemoriaOperacional } from './MemoriaOperacional';

const INTERVALO_MS = 15_000;
const HORA_CONSOLIDACAO = 3;

/** Chamado quando o estado mudou por metabolismo e vale reprojetar. */
export type AvisoDeMudanca = () => void;

export class CicloAutonomo {
  private timer: NodeJS.Timeout | null = null;
  private controle: AbortController | null = null;
  private consolidadoEm = '';

  constructor(
    private readonly idUsuario: string,
    private readonly estado: EstadoAtomico,
    private readonly memoria: MemoriaOperacional,
    private readonly avisar: AvisoDeMudanca,
  ) {}

  iniciar(): void {
    if (this.timer) return;
    this.controle = new AbortController();
    this.agendar();
  }

  parar(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controle?.abort();
    this.controle = null;
  }

  private agendar(): void {
    this.timer = setTimeout(() => {
      void this.tique();
    }, INTERVALO_MS);
    // Não segura o processo vivo se for a única coisa pendente.
    this.timer.unref?.();
  }

  private async tique(): Promise<void> {
    const sinal = this.controle?.signal;
    if (!sinal || sinal.aborted) return;

    try {
      const antes = this.estado.instantaneo();
      // Só respira quando de fato está ocioso — respirar durante um raciocínio
      // faria a UI mentir sobre o custo do turno.
      if (antes.estagio === 'ocioso') {
        await this.estado.respirar();
        this.avisar();
      }

      await this.talvezConsolidar(sinal);
    } catch (erro) {
      if (!sinal.aborted) {
        console.warn(`[iara] ciclo autônomo: ${(erro as Error).message}`);
      }
    } finally {
      if (!sinal.aborted) this.agendar();
    }
  }

  private async talvezConsolidar(sinal: AbortSignal): Promise<void> {
    const agora = new Date();
    // Data LOCAL, coerente com o `getHours()` local logo abaixo. Misturar
    // data UTC com hora local vira troca de dia no meio da janela.
    const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
    if (agora.getHours() !== HORA_CONSOLIDACAO) return;
    if (this.consolidadoEm === hoje) return;

    const insight = await this.memoria.consolidar(this.idUsuario);
    // O carimbo só entra APÓS o sucesso: se o Supabase está fora às 03:00,
    // o próximo tique dentro da janela tenta de novo, em vez de o dia
    // inteiro ficar sem consolidação por causa de uma falha transitória.
    this.consolidadoEm = hoje;
    if (sinal.aborted || !insight) return;
    console.log(
      JSON.stringify({ canal: 'consolidacao', usuario: this.idUsuario, titulo: insight.titulo }),
    );
  }

  /**
   * Execução manual da consolidação — usada para validar o caminho sem
   * esperar as 03:00.
   */
  async consolidarAgora(): Promise<void> {
    await this.memoria.consolidar(this.idUsuario);
  }
}
