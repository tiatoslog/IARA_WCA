/**
 * Ciclo autônomo — o "sonho" computacional.
 *
 * Roda em background como tarefa cancelável. Três responsabilidades:
 *
 *  1. RESPIRAR: regenera energia e paciência no ócio. Isso não é enfeite —
 *     é o que faz a IARA de terça de manhã ser diferente da IARA de sexta
 *     às 18h depois de trinta incidentes.
 *  2. CONSOLIDAR: na janela noturna, varre o shard de CADA operador em
 *     isolamento e grava `InsightRelacional` no shard privado dele.
 *  3. VENCER: a cada tique, procura lembretes que chegaram na hora e os
 *     entrega.
 *
 * Respirar e consolidar NÃO publicam no barramento cognitivo — metabolismo não
 * é fato do turno do operador. Vencer é o oposto, e a diferença importa: um
 * lembrete que venceu É um fato observado, exatamente como o resultado de uma
 * habilidade. Por isso ele sai pelo mesmo canal de qualquer outra fala da IARA,
 * em vez de virar um segundo caminho de conversa.
 *
 * O CICLO SÓ EXISTE COM TELA ABERTA (ver `Porta.ts`: nasce com o primeiro
 * espelho, morre com o último). A consequência é deliberada: um lembrete que
 * vence com o operador desconectado não é entregue no vazio nem carimbado como
 * dito — ele fica pendente e sai no primeiro tique depois da reconexão.
 * Atrasado e entregue vale mais que pontual e perdido.
 */

import type { EstadoAtomico } from './EstadoAtomico';
import type { MemoriaOperacional } from './MemoriaOperacional';
import { agenda as agendaPadrao, type Agenda, type Lembrete } from './Agenda';
import { Vigia, type Aviso } from './kernel/Vigia';
import type { Medicao } from './SondasDesempenho';

const INTERVALO_MS = 15_000;
const HORA_CONSOLIDACAO = 3;

/**
 * De quanto em quanto tempo o vigia MEDE a máquina.
 *
 * Muito mais longo que o tique, e a distância é o ponto: o tique custa
 * praticamente nada (aritmética sobre estado em memória), enquanto uma medição
 * abre o PowerShell e dorme um segundo amostrando processos. Vigiar na cadência
 * do tique transformaria a IARA na causa da lentidão que ela procura — que é a
 * forma mais constrangedora possível de este recurso falhar.
 *
 * Dez minutos também é a granularidade certa para o que ele observa: memória e
 * disco não viram problema em quinze segundos.
 */
const INTERVALO_VIGIA_MS = 10 * 60 * 1000;

/** Chamado quando o estado mudou por metabolismo e vale reprojetar. */
export type AvisoDeMudanca = () => void;

/** Chamado quando um lembrete venceu e precisa ser dito ao operador. */
export type AnuncioDeLembrete = (lembrete: Lembrete) => void;

/**
 * Como o ciclo mede a máquina do operador. `null` = não deu para medir agora,
 * e nesse caso o vigia simplesmente não tem o que dizer.
 *
 * INJETADO, e não importado: o ciclo é metabolismo, e metabolismo não abre
 * PowerShell por conta própria. Quem monta o ciclo (`Porta.ts`) é quem sabe
 * alcançar o braço. É a mesma disciplina de `anunciar`.
 */
export type MedicaoDaMaquina = () => Promise<Medicao | null>;

/** Chamado quando o vigia encontrou algo que vale interromper o operador. */
export type AnuncioDeAviso = (aviso: Aviso) => void;

/**
 * O tique da camada proativa. Ver `proativo/MotorProativo.tique`.
 *
 * ENTRA COMO INJEÇÃO, e não como importação, pela mesma disciplina de `medir` e
 * `anunciar`: o ciclo é metabolismo, e metabolismo não decide política de
 * interrupção. Quem monta o ciclo (`Porta.ts`) é quem sabe qual operador é, onde
 * fica o livro dele e por onde a fala sai.
 *
 * A CADÊNCIA É A DO TIQUE (15 s), e não a do vigia (10 min), porque este
 * trabalho é aritmética sobre estado em memória — consolidar contadores, vencer
 * uma pendência, agrupar assinaturas de passo. Ele só toca o disco quando há o
 * que consolidar. Pendurá-lo na cadência do vigia faria uma proposta ignorada
 * demorar dez minutos a mais para virar aprendizado, sem economizar nada.
 */
export type TiqueProativo = () => Promise<void>;

export class CicloAutonomo {
  private timer: NodeJS.Timeout | null = null;
  private controle: AbortController | null = null;
  private consolidadoEm = '';

  constructor(
    private readonly idUsuario: string,
    private readonly estado: EstadoAtomico,
    private readonly memoria: MemoriaOperacional,
    private readonly avisar: AvisoDeMudanca,
    /**
     * Opcional para não quebrar quem constrói o ciclo só para exercitar o
     * metabolismo — e porque um ciclo sem anúncio é um ciclo que simplesmente
     * não entrega lembrete, não um ciclo quebrado.
     */
    private readonly anunciar: AnuncioDeLembrete | null = null,
    private readonly agenda: Agenda = agendaPadrao,
    /**
     * As duas metades do vigia (§12). Ambas opcionais, e a ausência de qualquer
     * uma simplesmente desliga a vigilância — um ciclo sem vigia é um ciclo que
     * não vigia, não um ciclo quebrado. É a mesma escolha de `anunciar`.
     */
    private readonly medir: MedicaoDaMaquina | null = null,
    private readonly alertar: AnuncioDeAviso | null = null,
    /**
     * A camada proativa. Ausente = o ciclo simplesmente não a aciona — mesma
     * escolha de `anunciar`, `medir` e `alertar`, e pela mesma razão: um ciclo
     * sem proatividade é um ciclo que não é proativo, não um ciclo quebrado.
     */
    private readonly tiqueProativo: TiqueProativo | null = null,
  ) {}

  private readonly vigia = new Vigia();
  private vigiadoEm = 0;

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

      await this.entregarVencidos(sinal);
      await this.talvezVigiar(sinal);
      await this.girarProatividade(sinal);
      await this.talvezConsolidar(sinal);
    } catch (erro) {
      if (!sinal.aborted) {
        console.warn(`[iara] ciclo autônomo: ${(erro as Error).message}`);
      }
    } finally {
      if (!sinal.aborted) this.agendar();
    }
  }

  /**
   * Os lembretes que chegaram na hora, ditos um a um.
   *
   * A ORDEM É ANUNCIAR E DEPOIS CARIMBAR, nunca o contrário. Carimbar antes
   * transformaria qualquer falha na entrega — sessão caindo no meio, ouvinte
   * quebrado — num lembrete silenciosamente perdido, e perder é o único
   * desfecho pior que repetir. Se `anunciar` lançar, o carimbo não sai e o
   * próximo tique tenta de novo.
   *
   * O `sinal` é conferido a cada volta porque a lista pode ter dezenas de itens
   * depois de uma reconexão longa, e o operador que fechou a tela no meio disso
   * não deve continuar recebendo recado.
   */
  private async entregarVencidos(sinal: AbortSignal): Promise<void> {
    if (!this.anunciar) return;

    const vencidos = await this.agenda.vencidos(this.idUsuario);
    for (const lembrete of vencidos) {
      if (sinal.aborted) return;
      this.anunciar(lembrete);
      await this.agenda.marcarEntregue(this.idUsuario, lembrete.id);
    }
  }

  /**
   * A vigilância do §12: medir de vez em quando e falar só quando vale.
   *
   * A DECISÃO DE FALAR NÃO MORA AQUI — mora no `Vigia`, que confere autonomia,
   * borda e carência. Este método só resolve a CADÊNCIA, que é assunto do ciclo:
   * ele é quem tem relógio.
   *
   * O carimbo de tempo sai ANTES da medição, e não depois. Depois, uma medição
   * que demora (é justamente na máquina lenta que ela demora) faria o intervalo
   * real virar "dez minutos mais o tempo da última", e duas medições poderiam se
   * sobrepor num tique atrasado. Antes, a cadência é a cadência.
   *
   * NÃO PROPAGA ERRO: uma sonda que falhou não pode derrubar o metabolismo do
   * operador. O `tique` já tem um `catch`, e chegar lá com uma falha de medição
   * cancelaria a consolidação noturna que vem depois.
   */
  private async talvezVigiar(sinal: AbortSignal): Promise<void> {
    if (!this.medir || !this.alertar) return;
    const agora = Date.now();
    if (agora - this.vigiadoEm < INTERVALO_VIGIA_MS) return;
    this.vigiadoEm = agora;

    try {
      const medicao = await this.medir();
      if (sinal.aborted || !medicao) return;
      const aviso = this.vigia.avaliar(medicao);
      if (aviso) this.alertar(aviso);
    } catch (erro) {
      console.warn(`[iara] vigia: ${(erro as Error).message}`);
    }
  }

  /**
   * O tique da camada proativa: consolidar o que foi observado e procurar
   * oportunidade nos passos acumulados.
   *
   * O `catch` é o mesmo do vigia, e a razão é idêntica: este método roda ANTES
   * da consolidação noturna, e deixar uma falha subir daqui cancelaria a
   * consolidação da noite por causa de um disco ocupado. A camada proativa
   * também já promete não lançar (`MotorProativo.tique`); esta é a segunda
   * porta, para o dia em que alguém quebrar a primeira.
   */
  private async girarProatividade(sinal: AbortSignal): Promise<void> {
    if (!this.tiqueProativo || sinal.aborted) return;
    try {
      await this.tiqueProativo();
    } catch (erro) {
      console.warn(`[iara] proatividade: ${(erro as Error).message}`);
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
