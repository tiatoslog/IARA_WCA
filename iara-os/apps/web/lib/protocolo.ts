/**
 * Protocolo do barramento WebSocket.
 *
 * CONTRATO OFICIAL: só três coisas atravessam a fronteira do KERNEL —
 * `snapshot`, `log` e `erro`. Nenhum objeto interno, nenhuma referência,
 * nenhuma memória operacional.
 *
 * `dispositivos` é o quarto pacote e NÃO é uma exceção a essa regra — é o
 * reconhecimento de que existe uma segunda fronteira. A lista de máquinas não
 * sai do kernel: sai da `PonteDispositivos` e da tabela de pareamento, que o
 * kernel nem enxerga. Enfiá-la dentro do `SnapshotCognitivo` foi a primeira
 * tentativa e foi recusada por duas razões: o snapshot é recompilado a cada
 * evento cognitivo (o inventário de mãos viajaria dezenas de vezes por turno,
 * sem ter mudado), e o compilador passaria a depender de um estado que não é
 * cognitivo — que é como um contrato limpo vira um saco de campos.
 *
 * Todo pacote carrega `seq` monotônico. O cliente descarta qualquer pacote com
 * `seq` menor ou igual ao último aplicado — é o que impede a enxurrada
 * retroativa (backpressure wave) de bagunçar a UI na reconexão.
 */

import type { MaquinaDoOperador } from './execucao';
import { normalizarPreferencias, type PreferenciasOperador } from './perfil';
import type { SnapshotCognitivo } from './snapshot';

export type NivelLog = 'traco' | 'info' | 'alerta';

/** Chave de aglutinação: pacotes com a mesma chave se sobrescrevem na fila. */
export type ChaveAglutinacao = string;

export type PacoteServidor =
  /**
   * O estado cognitivo inteiro. Substitui hidratação, transição, pulso e
   * fala — todos eram fatias de um mesmo estado, e mantê-los separados
   * obrigava o cliente a remontar o que o servidor já sabia.
   */
  | { tipo: 'snapshot'; seq: number; instante: number; snapshot: SnapshotCognitivo }
  /** Console técnico. Nunca vira animação na sala. */
  | { tipo: 'log'; seq: number; instante: number; nivel: NivelLog; texto: string }
  | { tipo: 'erro'; seq: number; instante: number; texto: string }
  /**
   * O inventário de mãos deste operador. Sai sob demanda — nunca por relógio e
   * nunca junto do snapshot.
   *
   * `ultima_acao` viaja no MESMO pacote que a lista atualizada, e isso é
   * deliberado: o resultado de "autorizar este código" e a lista que ele mudou
   * são o mesmo fato. Separados em dois pacotes, a tela mostraria por um
   * instante a lista nova com a mensagem velha, ou a mensagem nova com a lista
   * velha — e as duas ordens são igualmente mentirosas.
   */
  | {
      tipo: 'dispositivos';
      seq: number;
      instante: number;
      maquinas: MaquinaDoOperador[];
      /** `false` quando não há banco: sem ele o pareamento não fica guardado. */
      pareamento_disponivel: boolean;
      ultima_acao?: { ok: boolean; texto: string };
    };

export type PacoteCliente =
  /**
   * `token` é o access token do Supabase. Quando a autenticação está ativa, é
   * ELE que define quem é o operador — `id_usuario` e `nome` viram decoração
   * de desenvolvimento e são ignorados pelo servidor.
   */
  | { tipo: 'ola'; id_usuario: string; nome: string; token?: string }
  | { tipo: 'mensagem'; texto: string }
  | { tipo: 'interromper' }
  /**
   * A ficha do operador. Não carrega `id_usuario`: o shard de destino é
   * derivado da sessão do socket, como toda escrita do sistema. Aceitar um id
   * aqui seria abrir por escrito a porta que o roteador fecha.
   */
  | { tipo: 'preferencias'; preferencias: PreferenciasOperador }
  /**
   * Onde o APARELHO está, quando a pessoa concede a permissão do navegador.
   *
   * Existe porque uma coordenada fixa no servidor está errada para todo mundo
   * que sai do escritório — e com a IARA no celular isso é o caso comum. O
   * pacote é separado do `ola` de propósito: a caixa de permissão do navegador
   * pode demorar (ou nunca ser respondida), e prender o handshake nela
   * atrasaria a conversa por causa do clima.
   *
   * NÃO CARREGA CIDADE. O nome do lugar seria uma afirmação que este pacote não
   * pode provar; o servidor tem a coordenada e é ela que a previsão usa.
   */
  | { tipo: 'local'; latitude: number; longitude: number }
  /**
   * "Quais computadores estão ligados a mim?" — pedido explícito, não assinatura.
   *
   * A tela pergunta ao abrir a gaveta e depois de cada ação. Empurrar a lista a
   * cada mudança de socket seria tráfego contínuo por uma informação que ninguém
   * está olhando na maior parte do tempo.
   */
  | { tipo: 'dispositivos' }
  /**
   * A APROVAÇÃO do pareamento. Não carrega `id_usuario` pela mesma razão que a
   * ficha não carrega: o dono da credencial que vai nascer é a sessão resolvida
   * deste socket. Aceitar um id aqui seria deixar o cliente autorizar um
   * computador em nome de outra pessoa — exatamente o que o pareamento existe
   * para impedir.
   */
  | { tipo: 'parear'; codigo: string }
  /** Revoga uma credencial de computador. `id` é o `id_credencial`. */
  | { tipo: 'esquecer_dispositivo'; id: string }
  /**
   * "Atualize AGORA esta máquina" — Etapa 2 (14/08/2026). `id` é o mesmo
   * `MaquinaDoOperador.id` que a gaveta já mostra; o servidor resolve o
   * socket vivo (`PonteDispositivos.porId`) e manda a ordem `atualizar` por
   * ele. Nunca carrega URL nem hash — o cliente não escolhe DE ONDE baixar
   * nem O QUE validar, isso é o manifesto do motor.
   */
  | { tipo: 'atualizar_dispositivo'; id: string };

/**
 * Prioridade de descarte da fila de telemetria. Quanto menor, mais descartável.
 * `snapshot` e `erro` nunca são descartados por pressão — o snapshot É o
 * estado, e perder o último significa a tela mentir até o próximo.
 */
export const PRIORIDADE: Record<PacoteServidor['tipo'], number> = {
  log: 0,
  snapshot: 3,
  erro: 3,
  /**
   * Não descartável. A lista de máquinas só é emitida porque alguém pediu, e
   * sacrificá-la sob pressão deixaria a gaveta girando para sempre sem erro
   * nenhum — a pior forma de falha desta tela, porque parece lentidão.
   */
  dispositivos: 3,
};

/**
 * Snapshot aglutina: só o mais recente importa. É isto que transforma uma
 * rajada de 40 atualizações numa única entrega, e o que faz a reconexão
 * hidratar em vez de reproduzir o passado.
 */
export function chaveDe(pacote: PacoteServidor): ChaveAglutinacao | null {
  return pacote.tipo === 'snapshot' ? 'snapshot' : null;
}

export function ehDescartavel(pacote: PacoteServidor): boolean {
  return PRIORIDADE[pacote.tipo] <= 1;
}

/** Parser defensivo: nada que venha do socket entra no motor sem validação. */
export function lerPacoteCliente(bruto: string): PacoteCliente | null {
  let dado: unknown;
  try {
    dado = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (typeof dado !== 'object' || dado === null) return null;
  const obj = dado as Record<string, unknown>;

  if (obj.tipo === 'ola') {
    const id = typeof obj.id_usuario === 'string' ? obj.id_usuario.trim() : '';
    const nome = typeof obj.nome === 'string' ? obj.nome.trim() : '';
    const token = typeof obj.token === 'string' ? obj.token.trim() : undefined;
    // Sem id E sem token não há como abrir sessão em modo nenhum.
    if (!id && !token) return null;
    return {
      tipo: 'ola',
      id_usuario: id.slice(0, 64),
      nome: (nome || id).slice(0, 64),
      token: token ? token.slice(0, 4096) : undefined,
    };
  }
  if (obj.tipo === 'mensagem') {
    const texto = typeof obj.texto === 'string' ? obj.texto : '';
    if (!texto.trim()) return null;
    return { tipo: 'mensagem', texto: texto.slice(0, 8000) };
  }
  if (obj.tipo === 'interromper') {
    return { tipo: 'interromper' };
  }
  if (obj.tipo === 'local') {
    const lat = typeof obj.latitude === 'number' ? obj.latitude : NaN;
    const lon = typeof obj.longitude === 'number' ? obj.longitude : NaN;
    /* Faixa geográfica, não formato. `Number.isFinite` sozinho aceitaria
       latitude 900 — e uma coordenada impossível não é um erro de digitação do
       cliente: é a única forma de este pacote mentir. Fora da faixa, descarta. */
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { tipo: 'local', latitude: lat, longitude: lon };
  }
  if (obj.tipo === 'dispositivos') {
    return { tipo: 'dispositivos' };
  }
  if (obj.tipo === 'parear') {
    const codigo = typeof obj.codigo === 'string' ? obj.codigo.trim() : '';
    if (!codigo) return null;
    /* Teto generoso e ainda assim teto: o código tem 8 caracteres, e o que
       chega maior que uma linha digitada não é um código com separadores — é
       alguém sondando o parser. A validação de conteúdo mora no `Pareamento`,
       que é quem conhece o alfabeto. */
    return { tipo: 'parear', codigo: codigo.slice(0, 40) };
  }
  if (obj.tipo === 'esquecer_dispositivo') {
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    if (!id) return null;
    return { tipo: 'esquecer_dispositivo', id: id.slice(0, 80) };
  }
  if (obj.tipo === 'atualizar_dispositivo') {
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    if (!id) return null;
    return { tipo: 'atualizar_dispositivo', id: id.slice(0, 80) };
  }
  if (obj.tipo === 'preferencias') {
    // `normalizarPreferencias` já é total: qualquer entrada vira uma ficha
    // válida, no pior caso a vazia. Não existe pacote de preferências
    // malformado — existe ficha em branco, que é um estado legítimo.
    return { tipo: 'preferencias', preferencias: normalizarPreferencias(obj.preferencias) };
  }
  return null;
}
