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
 *     pendência de 60 segundos que só a palavra "confirmo" do MESMO operador
 *     libera. Cancelar sempre funciona, inclusive depois do agendamento
 *     (shutdown do Windows com atraso + /a).
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

interface Pendencia {
  acao: AcaoEnergia;
  expira_em: number;
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

  /** R2: nunca executa — registra a pendência e devolve o pedido de confirmação. */
  pedirEnergia(idUsuario: string, acao: AcaoEnergia): string {
    this.pendencias.set(idUsuario, { acao, expira_em: Date.now() + VALIDADE_PENDENCIA_MS });
    this.auditar(idUsuario, `energia_pendente:${acao}`, true, 'aguardando confirmação');
    return (
      `Entendido: você quer ${ROTULO_ENERGIA[acao]}. Isso interrompe tudo que estiver aberto, ` +
      `então preciso da sua confirmação explícita. Responda "confirmo" em até 1 minuto — ou "cancela" para desistir.`
    );
  }

  confirmar(idUsuario: string): string {
    const pendencia = this.pendencias.get(idUsuario);
    if (!pendencia || Date.now() > pendencia.expira_em) {
      this.pendencias.delete(idUsuario);
      return 'Não há nenhuma ação aguardando confirmação — ou ela expirou. Pode pedir de novo.';
    }
    this.pendencias.delete(idUsuario);

    if (pendencia.acao === 'suspender') {
      this.executor('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
      this.auditar(idUsuario, 'energia:suspender', true, 'executado');
      return 'Suspendendo o computador agora. Até já.';
    }

    const flag = pendencia.acao === 'desligar' ? '/s' : '/r';
    // 20 segundos de atraso: janela real de arrependimento. "cancela" aborta.
    this.executor('shutdown.exe', [flag, '/t', '20', '/c', 'IARA: acao confirmada pelo operador.']);
    this.auditar(idUsuario, `energia:${pendencia.acao}`, true, 'agendado em 20s');
    return (
      `Confirmado. Vou ${ROTULO_ENERGIA[pendencia.acao]} em 20 segundos. ` +
      'Se mudou de ideia, diga "cancela" que eu aborto.'
    );
  }

  cancelar(idUsuario: string): string {
    const havia = this.pendencias.delete(idUsuario);
    // Aborta também um shutdown já agendado — melhor um /a sem efeito do que
    // um desligamento que o operador tentou impedir e não conseguiu.
    this.executor('shutdown.exe', ['/a']);
    this.auditar(idUsuario, 'energia:cancelar', true, havia ? 'pendência descartada' : 'abort enviado');
    return havia
      ? 'Cancelado. Nada será executado.'
      : 'Cancelado — se havia um desligamento agendado, acabei de abortar.';
  }

  /** Existe pendência válida para este operador? (usado pelo fluxo de confirmação) */
  temPendencia(idUsuario: string): boolean {
    const p = this.pendencias.get(idUsuario);
    return Boolean(p && Date.now() <= p.expira_em);
  }
}

/** Instância única do processo — as pendências vivem nela. */
export const agenteLocal = new AgenteLocal();
