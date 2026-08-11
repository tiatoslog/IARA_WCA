/**
 * Agente Local — as mãos da IARA no computador onde o motor roda.
 *
 * FRONTEIRAS, ANTES DE QUALQUER COISA:
 *
 *  1. RAÍZES AUTORIZADAS. Escrita de pasta só dentro de Área de Trabalho,
 *     Documentos e Downloads do usuário do processo. Não existe parâmetro de
 *     caminho livre — o operador escolhe um LOCAL nomeado, nunca um path.
 *  2. ALLOWLIST DE APLICATIVOS. Abrir aplicativo é escolher de um mapa
 *     fechado, revisado em commit. Não existe "execute este comando".
 *  3. ENERGIA É R2. Desligar/reiniciar/suspender NUNCA executa direto: vira
 *     pendência de 60 segundos que só a palavra "confirmo" do MESMO operador,
 *     NA MESMA CONVERSA, libera — e para a ação que foi de fato anunciada, não
 *     para o que estiver no slot. Cancelar sempre funciona, inclusive depois do
 *     agendamento (shutdown do Windows com atraso + /a) e inclusive de outra
 *     conversa: desistir nunca exige a prova que agir exige.
 *  4. AUDITORIA. Toda ação — executada, recusada ou pendente — vira uma linha
 *     JSON no canal `agente_local`, sem copiar conteúdo de conversa.
 *
 * A LLM não chega aqui: quem chama são habilidades do catálogo, com esquema
 * validado, e os parâmetros dela são rótulos de listas fechadas. É a mesma
 * regra do resto do sistema — a IA propõe, o determinístico executa.
 */

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Raízes autorizadas
// ---------------------------------------------------------------------------

export type LocalAutorizado = 'area_de_trabalho' | 'documentos' | 'downloads';

export const ROTULO_DO_LOCAL: Record<LocalAutorizado, string> = {
  area_de_trabalho: 'Área de Trabalho',
  documentos: 'Documentos',
  downloads: 'Downloads',
};

/**
 * Resolve o local nomeado para um caminho REAL desta máquina. Windows com
 * OneDrive move Desktop/Documentos para dentro do OneDrive (com nome
 * localizado) — por isso é uma lista de candidatos, não um caminho fixo.
 */
export function resolverRaiz(local: LocalAutorizado): string | null {
  const casa = homedir();
  const candidatos: Record<LocalAutorizado, string[]> = {
    area_de_trabalho: [
      path.join(casa, 'OneDrive', 'Área de Trabalho'),
      path.join(casa, 'OneDrive', 'Desktop'),
      path.join(casa, 'Desktop'),
    ],
    documentos: [
      path.join(casa, 'OneDrive', 'Documentos'),
      path.join(casa, 'OneDrive', 'Documents'),
      path.join(casa, 'Documents'),
    ],
    downloads: [path.join(casa, 'Downloads')],
  };
  return candidatos[local].find((c) => existsSync(c)) ?? null;
}

/**
 * Nome de pasta seguro: letras (com acento), números, espaço e -_.
 * Sem barra, sem `..`, sem terminar em ponto/espaço (o NTFS engole e o
 * caminho passa a mentir). O nome NUNCA é interpretado como caminho.
 */
export function validarNomePasta(nome: string): string | null {
  const limpo = nome.trim();
  if (limpo.length === 0 || limpo.length > 60) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(limpo)) return null;
  if (limpo.includes('..') || /[. ]$/.test(limpo)) return null;
  return limpo;
}

// ---------------------------------------------------------------------------
// Aplicativos autorizados
// ---------------------------------------------------------------------------

interface AplicativoAutorizado {
  rotulo: string;
  comando: string;
  argumentos: string[];
}

/**
 * O mapa É a permissão. Adicionar aplicativo = adicionar linha aqui, em
 * commit revisado. As chaves são o que o reconhecedor procura na frase.
 */
const APLICATIVOS: Record<string, AplicativoAutorizado> = {
  'bloco de notas': { rotulo: 'Bloco de Notas', comando: 'notepad.exe', argumentos: [] },
  notepad: { rotulo: 'Bloco de Notas', comando: 'notepad.exe', argumentos: [] },
  calculadora: { rotulo: 'Calculadora', comando: 'calc.exe', argumentos: [] },
  paint: { rotulo: 'Paint', comando: 'mspaint.exe', argumentos: [] },
  explorador: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [] },
  explorer: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [] },
  arquivos: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [] },
  // Navegadores instalam fora do PATH; `start` resolve pelo registro do app.
  chrome: { rotulo: 'Google Chrome', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'chrome'] },
  edge: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'] },
  navegador: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'] },
};

export function resolverAplicativo(pedido: string): AplicativoAutorizado | null {
  const t = pedido
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // Chaves mais longas primeiro: "bloco de notas" antes de "notas".
  const chaves = Object.keys(APLICATIVOS).sort((a, b) => b.length - a.length);
  for (const chave of chaves) {
    if (t.includes(chave)) return APLICATIVOS[chave];
  }
  return null;
}

export function aplicativosDisponiveis(): string {
  const rotulos = [...new Set(Object.values(APLICATIVOS).map((a) => a.rotulo))];
  return rotulos.join(', ');
}

// ---------------------------------------------------------------------------
// Energia — pendência com confirmação explícita
// ---------------------------------------------------------------------------

export type AcaoEnergia = 'desligar' | 'reiniciar' | 'suspender';

const ROTULO_ENERGIA: Record<AcaoEnergia, string> = {
  desligar: 'desligar o computador',
  reiniciar: 'reiniciar o computador',
  suspender: 'suspender o computador',
};

/** Janela para o "confirmo" chegar. Curta de propósito: confirmação velha
 *  executando ação esquecida é exatamente o acidente que este fluxo evita. */
const VALIDADE_PENDENCIA_MS = 60_000;

/**
 * A pendência de energia, com IDENTIDADE — não só uma ação solta.
 *
 * O DEFEITO, reproduzido na auditoria de fechamento (11/08/2026): a pendência
 * era `{ acao, expira_em }` indexada só por `id_usuario`. Duas consequências,
 * as duas confirmadas com executor espião:
 *
 *  1. TROCA SILENCIOSA DE AÇÃO. `pedirEnergia(u,'desligar')` seguido de
 *     `pedirEnergia(u,'reiniciar')` sobrescrevia o slot sem dizer nada. O
 *     operador que leu "vou desligar" e digitou "confirmo" recebia um REBOOT.
 *  2. CONFIRMAÇÃO ATRAVESSANDO CANAL. O `agenteLocal` é singleton do processo e
 *     a chave era só o usuário: uma pendência armada pelo WhatsApp podia ser
 *     liberada por um "confirmo" digitado no navegador — duas conversas
 *     diferentes, uma autorização só.
 *
 * `sessao` amarra a confirmação ao MESMO diálogo em que o pedido foi feito
 * (`Porta.ts` usa o id do operador; `PortaWhatsapp.ts` usa `whatsapp:<id>`, e é
 * por isso que os espelhos do navegador continuam funcionando entre si).
 * `id` é o nonce que dá à pendência uma identidade própria, para que
 * "confirmo" nunca seja um cheque em branco sobre o slot atual.
 */
interface Pendencia {
  readonly id: string;
  readonly acao: AcaoEnergia;
  readonly sessao: string;
  readonly criada_em: number;
  readonly expira_em: number;
}

/** Assinatura compatível com `child_process.spawn` — injetável nos testes
 *  para que "confirmar desligamento" seja testável sem desligar nada. */
export type Executor = (comando: string, argumentos: string[]) => void;

const executorReal: Executor = (comando, argumentos) => {
  const filho = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });
  filho.unref();
};

// ---------------------------------------------------------------------------

export class AgenteLocal {
  /** Pendência R2 por operador — confirmação de A nunca libera ação de B. */
  private pendencias = new Map<string, Pendencia>();

  constructor(private readonly executor: Executor = executorReal) {}

  private auditar(idUsuario: string, acao: string, permitido: boolean, detalhe: string): void {
    console.log(
      JSON.stringify({ canal: 'agente_local', usuario: idUsuario, acao, permitido, detalhe }),
    );
  }

  async criarPasta(
    idUsuario: string,
    nomePedido: string,
    local: LocalAutorizado,
  ): Promise<string> {
    const nome = validarNomePasta(nomePedido);
    if (!nome) {
      this.auditar(idUsuario, 'criar_pasta', false, 'nome inválido');
      return (
        'Esse nome de pasta não passa na minha regra de segurança (só letras, números, espaço, hífen e sublinhado, até 60 caracteres). ' +
        'Me diga outro nome que eu crio na hora.'
      );
    }

    const raiz = resolverRaiz(local);
    if (!raiz) {
      this.auditar(idUsuario, 'criar_pasta', false, `raiz ${local} não encontrada`);
      return `Não encontrei a pasta ${ROTULO_DO_LOCAL[local]} neste computador.`;
    }

    const destino = path.join(raiz, nome);
    if (existsSync(destino)) {
      this.auditar(idUsuario, 'criar_pasta', true, 'já existia');
      return `A pasta "${nome}" já existe em ${ROTULO_DO_LOCAL[local]} (${destino}). Não mexi em nada.`;
    }

    await mkdir(destino);
    this.auditar(idUsuario, 'criar_pasta', true, destino);
    return `Pasta "${nome}" criada em ${ROTULO_DO_LOCAL[local]}: ${destino}`;
  }

  abrirAplicativo(idUsuario: string, pedido: string): string {
    const app = resolverAplicativo(pedido);
    if (!app) {
      this.auditar(idUsuario, 'abrir_aplicativo', false, pedido.slice(0, 60));
      return `Esse aplicativo não está na minha lista autorizada. Hoje eu abro: ${aplicativosDisponiveis()}.`;
    }
    this.executor(app.comando, app.argumentos);
    this.auditar(idUsuario, 'abrir_aplicativo', true, app.rotulo);
    return `${app.rotulo} aberto.`;
  }

  /**
   * A pendência VÁLIDA para este diálogo, ou `null`.
   *
   * Um só lugar decide o que "válida" quer dizer — não expirada E do mesmo
   * `sessao`. Espalhar esse teste por `confirmar`, `cancelar` e `temPendencia`
   * é como as três respostas passam a divergir com o tempo.
   */
  private valida(idUsuario: string, sessao: string): Pendencia | null {
    const p = this.pendencias.get(idUsuario);
    if (!p) return null;
    if (Date.now() > p.expira_em) return null;
    if (p.sessao !== sessao) return null;
    return p;
  }

  /** R2: nunca executa — registra a pendência e devolve o pedido de confirmação. */
  pedirEnergia(idUsuario: string, acao: AcaoEnergia, sessao: string): string {
    /**
     * Substituir uma pendência é FATO DITO, não sobrescrita muda.
     *
     * Sem esta frase, quem pediu "desligar" e depois "reiniciar" fica com dois
     * pedidos na cabeça e um só no sistema — e o "confirmo" seguinte resolve o
     * que o sistema guardou, não o que a pessoa lembra.
     */
    const anterior = this.pendencias.get(idUsuario);
    const trocou =
      anterior && Date.now() <= anterior.expira_em && anterior.acao !== acao
        ? `Descartei o pedido anterior de ${ROTULO_ENERGIA[anterior.acao]}. `
        : '';

    this.pendencias.set(idUsuario, {
      id: randomUUID(),
      acao,
      sessao,
      criada_em: Date.now(),
      expira_em: Date.now() + VALIDADE_PENDENCIA_MS,
    });
    this.auditar(idUsuario, `energia_pendente:${acao}`, true, `aguardando confirmação (${sessao})`);
    return (
      `${trocou}Entendido: você quer ${ROTULO_ENERGIA[acao]}. Isso interrompe tudo que estiver aberto, ` +
      `então preciso da sua confirmação explícita. Responda "confirmo ${ROTULO_ENERGIA[acao].split(' ')[0]}" ` +
      `— ou só "confirmo" — em até 1 minuto. "cancela" desiste.`
    );
  }

  confirmar(idUsuario: string, sessao: string): string {
    const bruta = this.pendencias.get(idUsuario);
    const pendencia = this.valida(idUsuario, sessao);

    if (!pendencia) {
      /**
       * Pendência de OUTRO diálogo não é apagada aqui: ela não é deste
       * "confirmo", e destruí-la deixaria o operador sem a ação que ele de fato
       * pediu na outra tela. Só a expirada sai do mapa.
       */
      if (bruta && Date.now() > bruta.expira_em) this.pendencias.delete(idUsuario);
      if (bruta && bruta.sessao !== sessao && Date.now() <= bruta.expira_em) {
        this.auditar(idUsuario, 'energia:confirmacao_de_outra_sessao', false, sessao);
        return (
          'Existe um pedido seu aguardando confirmação, mas ele foi feito em outra conversa. ' +
          'Confirme por lá, ou repita o pedido aqui — não libero ação irreversível com um "confirmo" ' +
          'que veio de outro contexto.'
        );
      }
      return 'Não há nenhuma ação aguardando confirmação — ou ela expirou. Pode pedir de novo.';
    }

    this.pendencias.delete(idUsuario);

    if (pendencia.acao === 'suspender') {
      this.executor('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
      this.auditar(idUsuario, 'energia:suspender', true, `executado (${pendencia.id})`);
      return 'Suspendendo o computador agora. Até já.';
    }

    const flag = pendencia.acao === 'desligar' ? '/s' : '/r';
    // 20 segundos de atraso: janela real de arrependimento. "cancela" aborta.
    this.executor('shutdown.exe', [flag, '/t', '20', '/c', 'IARA: acao confirmada pelo operador.']);
    this.auditar(idUsuario, `energia:${pendencia.acao}`, true, `agendado em 20s (${pendencia.id})`);
    return (
      `Confirmado. Vou ${ROTULO_ENERGIA[pendencia.acao]} em 20 segundos. ` +
      'Se mudou de ideia, diga "cancela" que eu aborto.'
    );
  }

  cancelar(idUsuario: string, sessao: string): string {
    /**
     * Cancelar é ASSIMÉTRICO em relação a confirmar, e de propósito: desistir
     * nunca precisa da mesma prova que agir. Uma pendência de outra sessão é
     * apagada daqui sem cerimônia — o custo de cancelar demais é zero, o de
     * cancelar de menos é um desligamento que o operador tentou impedir.
     */
    const havia = this.pendencias.delete(idUsuario);
    this.executor('shutdown.exe', ['/a']);
    this.auditar(
      idUsuario,
      'energia:cancelar',
      true,
      `${havia ? 'pendência descartada' : 'abort enviado'} (${sessao})`,
    );
    return havia
      ? 'Cancelado. Nada será executado.'
      : 'Cancelado — se havia um desligamento agendado, acabei de abortar.';
  }

  /** Existe pendência válida PARA ESTE DIÁLOGO? (usado pelo fluxo de confirmação) */
  temPendencia(idUsuario: string, sessao: string): boolean {
    return this.valida(idUsuario, sessao) !== null;
  }
}

/** Instância única do processo — as pendências vivem nela. */
export const agenteLocal = new AgenteLocal();
