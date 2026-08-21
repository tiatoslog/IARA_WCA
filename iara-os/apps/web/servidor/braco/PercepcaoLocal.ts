/**
 * O LAÇO DE PERCEPÇÃO, do lado do operador.
 *
 * Ele mora no Braço, e não no motor, porque é isso que faz a arquitetura inteira
 * fechar: a tela é reduzida, comparada e descartada NA MÁQUINA DA PESSOA, e o
 * que atravessa a rede é um evento de algumas centenas de bytes. Se este laço
 * rodasse no motor, cada quadro teria de subir — e aí não haveria desenho de
 * privacidade que salvasse.
 *
 * O QUE ELE NÃO FAZ, e é a fronteira desta camada inteira:
 *
 *   NÃO avança procedimento      não conhece `ProcedimentosEmCurso`
 *   NÃO cria evidência           não conhece `TipoDeEvidencia`
 *   NÃO cria conferência         não conhece `ConferenciaDaParada`
 *   NÃO identifica tela          o P0 só sabe dizer que MUDOU
 *   NÃO captura sem escopo       `dentroDoEscopo` decide antes de ler pixel
 *   NÃO captura sem consentimento `iniciar` exige o registro do aceite
 *
 * Verificado em `testes/percepcao-p0.test.ts`, não por este comentário.
 *
 * INJETÁVEL POR INTEIRO. `janela`, `quadro`, `agora` e `emitir` entram por
 * parâmetro, então o laço se testa com uma tela falsa, determinística, sem
 * PowerShell e sem Windows — que é o que permite a suíte rodar no CI em Linux
 * provando a MESMA lógica que roda na máquina da operadora.
 */

import { linhasDeMensagem, prepararTextoDaTela } from '../../lib/mascara';
import {
  DISTANCIA_MINIMA_RELEVANTE,
  ESTABILIDADE_MS,
  INTERVALO_CAPTURA_MS,
  INTERVALO_OCR_MS,
  MIN_LINHAS_MUDADAS,
  linhasMudadas,
  assinaturaDeTitulo,
  dentroDoEscopo,
  distanciaDeHamming,
  hashDoQuadro,
  mudouDeJanela,
  type EscopoDePercepcao,
  type EventoVisual,
  type JanelaObservada,
} from '../../lib/percepcao';
import type { JanelaEmFoco, Quadro } from './CapturaDeQuadro';

/**
 * Teto de eventos por minuto — o freio de mão do §5.
 *
 * O debounce já impede a enxurrada no caso normal. Este teto cobre o caso
 * anormal: uma tela que pisca entre dois estados estáveis (carrossel, alerta que
 * some e volta) satisfaz a estabilidade das duas vezes e produziria um evento a
 * cada dois segundos, para sempre. Estourar o teto SUSPENDE a percepção e diz
 * por quê — porque uma IARA que fala doze vezes por minuto é uma IARA que o
 * operador desliga.
 */
export const MAX_EVENTOS_POR_MINUTO = 10;

/** O aceite do operador, registrado. Sem isto o laço não liga. */
export interface Consentimento {
  readonly concedido: boolean;
  readonly em: string;
  /** Como foi obtido: `console` no P0. Fica no evento para a auditoria. */
  readonly via: string;
}

export interface DependenciasPercepcao {
  janela(): Promise<JanelaEmFoco | null>;
  quadro(handle: string): Promise<Quadro | null>;
  /**
   * O texto da janela, lido LOCALMENTE. OPCIONAL, e a opcionalidade é o
   * desenho: máquina sem pacote de idioma do Windows não tem OCR, e a percepção
   * precisa continuar detectando mudança de tela sem ele. Ausente aqui significa
   * "esta instalação não lê texto" — não significa "a tela está vazia".
   */
  texto?(handle: string): Promise<{ linhas: readonly string[]; ms: number } | null>;
  agora(): number;
  emitir(evento: EventoVisual): void;
  /**
   * O INDICADOR VISÍVEL (§9). Chamado a cada transição e periodicamente.
   *
   * É dependência, e não `console.log` embutido, por uma razão de honestidade:
   * o dia em que o Braço ganhar bandeja de sistema ou janela própria, o
   * indicador muda de lugar sem que o laço saiba. O que não pode mudar é
   * EXISTIR — por isso ele é obrigatório na interface, não opcional.
   */
  indicar(estado: {
    ativa: boolean;
    suspensa: boolean;
    janela: JanelaObservada | null;
    mudancas: number;
    motivo: string;
  }): void;
}

interface Candidato {
  readonly hash: string;
  readonly desde: number;
}

export class PercepcaoLocal {
  private sessao: string | null = null;
  private escopo: EscopoDePercepcao = { processos: [] };
  private relogio: ReturnType<typeof setInterval> | null = null;

  private hashEstavel: string | null = null;
  /** A janela da ultima referencia estavel. Segundo sinal, sem limiar. */
  private janelaEstavel: JanelaObservada | null = null;
  private candidato: Candidato | null = null;
  /** O último texto observado e estabilizado, já mascarado. */
  private textoEstavel = '';
  private ultimoOcr = 0;
  private suspensa = false;
  private mudancas = 0;
  private emissoes: number[] = [];
  private ocupado = false;

  constructor(private readonly dep: DependenciasPercepcao) {}

  get ativa(): boolean {
    return this.sessao !== null;
  }

  /**
   * Liga a percepção. **Sem consentimento concedido, não liga** — e devolve
   * `false` em vez de lançar, porque negar o aceite não é erro do programa.
   */
  iniciar(sessao: string, escopo: EscopoDePercepcao, consentimento: Consentimento): boolean {
    if (!consentimento.concedido) return false;
    if (escopo.processos.length === 0) return false;
    if (this.sessao) this.encerrar('sessão substituída');

    this.sessao = sessao;
    this.escopo = { processos: escopo.processos.map((p) => p.toLowerCase()) };
    this.hashEstavel = null;
    this.janelaEstavel = null;
    this.candidato = null;
    this.textoEstavel = '';
    this.ultimoOcr = 0;
    this.suspensa = false;
    this.mudancas = 0;
    this.emissoes = [];

    this.publicar('sessao_iniciada', null, null, null, `consentimento via ${consentimento.via}`);
    this.dep.indicar({ ativa: true, suspensa: false, janela: null, mudancas: 0, motivo: '' });

    this.relogio = setInterval(() => void this.tique(), INTERVALO_CAPTURA_MS);
    this.relogio.unref?.();
    return true;
  }

  encerrar(motivo: string): void {
    if (!this.sessao) return;
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
    this.publicar('sessao_encerrada', null, null, null, motivo);
    this.dep.indicar({ ativa: false, suspensa: false, janela: null, mudancas: this.mudancas, motivo });
    this.sessao = null;
  }

  /**
   * Um tique. Público para o teste poder passar o tempo sem `setInterval`.
   *
   * `ocupado` evita reentrância: uma captura que demora mais que o intervalo
   * (medido: pico de 96 ms contra 1000 ms de intervalo, mas máquina carregada
   * pode inverter isso) empilharia tiques e viraria fila crescente.
   */
  async tique(): Promise<void> {
    if (!this.sessao || this.ocupado) return;
    this.ocupado = true;
    try {
      await this.observar();
    } catch (erro) {
      this.suspender(`falha na captura: ${(erro as Error).message}`);
    } finally {
      this.ocupado = false;
    }
  }

  private async observar(): Promise<void> {
    const foco = await this.dep.janela();

    /* ESCOPO ANTES DE PIXEL. `janela()` lê só metadado; se o processo não está
       autorizado, `quadro()` nunca é chamado e a tela daquela aplicação nunca é
       lida. A ordem destas quatro linhas é a trava de privacidade inteira. */
    if (!foco) {
      this.suspender('nenhuma janela em foco legível');
      return;
    }
    if (!dentroDoEscopo(foco.processo, this.escopo)) {
      this.suspender(`janela fora do escopo autorizado (${foco.processo})`);
      return;
    }

    const janela = this.descrever(foco);

    if (this.suspensa) {
      this.suspensa = false;
      this.publicar('percepcao_retomada', janela, null, null, 'janela autorizada de volta em foco');
      this.dep.indicar({ ativa: true, suspensa: false, janela, mudancas: this.mudancas, motivo: '' });
    }

    const quadro = await this.dep.quadro(foco.handle);
    /* `null` = o foco mudou entre o metadado e a captura. Não é falha e não
       suspende: no tique seguinte o escopo é reavaliado do zero. */
    if (!quadro) return;

    const hash = hashDoQuadro(quadro.cinza);
    const agora = this.dep.agora();

    if (this.hashEstavel === null) {
      /* PRIMEIRO QUADRO DA SESSÃO. Vira referência e NÃO produz evento: não
         houve mudança nenhuma — houve o começo da observação, que já foi
         anunciado por `sessao_iniciada`.
    
         O TEXTO VIRA REFERÊNCIA JUNTO, e essa linha nasceu de um teste que
         falhou: sem ela, a primeira leitura de OCR só acontecia no segundo
         tique e a primeira mudança de texto só era vista no terceiro. A
         referência de imagem e a de texto têm de nascer no mesmo instante,
         senão a percepção fica cega ao que a pessoa digitou logo depois de a
         observação começar. */
      this.hashEstavel = hash;
      this.janelaEstavel = janela;
      const primeira = await this.lerTexto(foco.handle, agora);
      if (primeira) this.textoEstavel = primeira.texto;
      return;
    }

    /**
     * DOIS SINAIS, e a medição de 21/08/2026 é a razão de serem dois.
     *
     * A distância de Hamming sobre um navegador com conteúdo vivo chegou a 13
     * de ruído contra 18 de sinal — cinco bits de folga, que é pouco para
     * apostar. Identidade de janela não tem zona cinzenta: mudou o processo ou
     * o título, houve navegação, e não há limiar envolvido.
     *
     * O `||` é deliberado: uma navegação dentro da mesma tela (mesmo título)
     * ainda é pega pela distância; uma troca de aplicação com telas parecidas
     * ainda é pega pela identidade. Nenhum dos dois sozinho cobria os dois casos.
     */
    const mudouIdentidade = mudouDeJanela(this.janelaEstavel, janela);
    const mudouConteudo = distanciaDeHamming(this.hashEstavel, hash) >= DISTANCIA_MINIMA_RELEVANTE;

    /**
     * O TERCEIRO SINAL: o TEXTO. É ele que fecha o buraco que a prova de
     * 21/08/2026 escancarou — seis digitações no Bloco de Notas produziram UM
     * evento, e ele veio da troca de título, não do que foi escrito.
     *
     * Digitar uma linha muda pouquíssimos pixels numa miniatura de 32×32: a
     * distância de Hamming fica muito abaixo do limiar, e baixá-lo traria de
     * volta o alarme falso que a medição já tinha descartado. Texto não tem esse
     * problema — uma linha nova é uma linha nova.
     *
     * NÃO RODA A CADA QUADRO: 90–460 ms de OCR contra 41 ms de captura. A cada
     * `INTERVALO_OCR_MS`, que é o tempo em que alguém preenche um campo.
     */
    const leitura = await this.lerTexto(foco.handle, agora);
    const mudouTexto =
      leitura !== null &&
      this.textoEstavel !== '' &&
      linhasMudadas(this.textoEstavel, leitura.texto) >= MIN_LINHAS_MUDADAS;

    if (leitura && this.textoEstavel === '') this.textoEstavel = leitura.texto;

    /* MENSAGEM É EVENTO PRÓPRIO, e sai mesmo quando a tela não "mudou o
       bastante": um alerta que aparece sobre a mesma tela é exatamente o caso
       que o operador precisa que a IARA veja. */
    if (leitura) this.anunciarMensagens(janela, leitura);

    if (!mudouIdentidade && !mudouConteudo && !mudouTexto) {
      /* Voltou ao que era: cursor, relógio, foco piscando. O candidato morre —
         uma mudança que não persistiu não é mudança. */
      this.candidato = null;
      return;
    }

    /**
     * MUDANÇA DE TEXTO NÃO ESPERA ESTABILIZAR, e a assimetria é deliberada. O
     * debounce existe para não anunciar os quadros intermediários de uma
     * navegação; o OCR já roda a cada cinco segundos, então um texto diferente
     * de cinco segundos atrás JÁ é o estado estável. Fazê-lo esperar mais
     * atrasaria em vão a única detecção que enxerga o que a pessoa digitou.
     */
    if (mudouTexto) {
      this.anunciarMudanca(janela, hash, leitura!.texto, 'ocr');
      return;
    }

    if (this.candidato && distanciaDeHamming(this.candidato.hash, hash) < DISTANCIA_MINIMA_RELEVANTE) {
      if (agora - this.candidato.desde >= ESTABILIDADE_MS) {
        this.anunciarMudanca(janela, hash, leitura?.texto ?? this.textoEstavel, 'hash_de_quadro');
      }
      return;
    }

    /* Tela nova ainda mexendo: reinicia a contagem de estabilidade. É isto que
       transforma uma navegação de cinco quadros diferentes em UM evento. */
    this.candidato = { hash, desde: agora };
  }

  /**
   * Lê o texto da janela, mascarado, respeitando o intervalo do OCR.
   *
   * `null` quando não é hora de ler, quando esta instalação não tem OCR, ou
   * quando a leitura falhou. Os três casos são o mesmo para quem chama — e
   * nenhum deles pode virar "a tela está vazia".
   */
  private async lerTexto(
    handle: string,
    agora: number,
  ): Promise<{ texto: string; mensagens: readonly string[] } | null> {
    if (!this.dep.texto) return null;
    if (agora - this.ultimoOcr < INTERVALO_OCR_MS) return null;
    this.ultimoOcr = agora;
    const lido = await this.dep.texto(handle);
    if (!lido || lido.linhas.length === 0) return null;
    /* A MÁSCARA RODA AQUI, na máquina do operador, antes de o texto existir como
       dado deste processo. Nenhum caminho leva texto cru a um evento. */
    const preparado = prepararTextoDaTela(lido.linhas);
    return {
      texto: preparado.texto,
      mensagens: linhasDeMensagem(preparado.texto.split('\n')),
    };
  }

  /** Emite `mensagem_detectada` para o que apareceu desde a leitura anterior. */
  private anunciarMensagens(
    janela: JanelaObservada,
    leitura: { texto: string; mensagens: readonly string[] },
  ): void {
    if (leitura.mensagens.length === 0) return;
    const antigas = new Set(this.textoEstavel.split('\n'));
    const novas = leitura.mensagens.filter((m) => !antigas.has(m));
    if (novas.length === 0) return;
    this.publicar('mensagem_detectada', janela, null, null, 'mensagem observada na tela', novas.join('\n'));
  }

  private anunciarMudanca(
    janela: JanelaObservada,
    hash: string,
    textoObservado: string,
    origem: 'hash_de_quadro' | 'ocr',
  ): void {
    const agora = this.dep.agora();
    this.emissoes = this.emissoes.filter((t) => agora - t < 60_000);
    if (this.emissoes.length >= MAX_EVENTOS_POR_MINUTO) {
      this.suspender(`mais de ${MAX_EVENTOS_POR_MINUTO} mudanças por minuto: tela instável`);
      return;
    }

    const distancia = distanciaDeHamming(this.hashEstavel ?? hash, hash);
    this.hashEstavel = hash;
    this.janelaEstavel = janela;
    this.candidato = null;
    if (textoObservado) this.textoEstavel = textoObservado;
    this.mudancas += 1;
    this.emissoes.push(agora);
    this.publicar('mudanca_visual', janela, hash, distancia, '', textoObservado, origem);
    this.dep.indicar({
      ativa: true,
      suspensa: false,
      janela,
      mudancas: this.mudancas,
      motivo: '',
    });
  }

  private suspender(motivo: string): void {
    if (this.suspensa) return;
    this.suspensa = true;
    this.candidato = null;
    /* O HASH ESTÁVEL MORRE junto com a suspensão. Ao voltar, o primeiro quadro
       vira referência nova: comparar a tela de agora com a de antes de a pessoa
       sair produziria um "mudou!" que só diz que ela foi tomar café. */
    this.hashEstavel = null;
    this.janelaEstavel = null;
    /* O TEXTO TAMBÉM MORRE na suspensão, e pela mesma razão do hash: comparar o
       que está na tela agora com o que estava antes de a pessoa sair produziria
       um "mudou!" que só diz que ela foi tomar café. */
    this.textoEstavel = '';
    this.publicar('percepcao_suspensa', null, null, null, motivo);
    this.dep.indicar({ ativa: true, suspensa: true, janela: null, mudancas: this.mudancas, motivo });
  }

  /** O metadado da janela, JÁ MASCARADO. O título cru morre aqui. */
  private descrever(foco: JanelaEmFoco): JanelaObservada {
    return {
      processo: foco.processo,
      assinatura: assinaturaDeTitulo(foco.titulo),
      largura: foco.largura,
      altura: foco.altura,
    };
  }

  private publicar(
    tipo: EventoVisual['tipo'],
    janela: JanelaObservada | null,
    hash: string | null,
    distancia: number | null,
    motivo: string,
    textoObservado = '',
    origem?: EventoVisual['origem'],
  ): void {
    if (!this.sessao) return;
    this.dep.emitir({
      tipo,
      sessao_percepcao: this.sessao,
      instante: new Date(this.dep.agora()).toISOString(),
      janela,
      hash,
      distancia,
      origem: origem ?? (hash ? 'hash_de_quadro' : textoObservado ? 'ocr' : 'metadado_de_janela'),
      motivo,
      texto: textoObservado,
    });
  }
}
