/**
 * Diagnóstico — "IARA, faça um diagnóstico".
 *
 * A pergunta que esta habilidade existe para responder não é "você está bem?".
 * É a outra, a que se faz irritado depois de um comando não funcionar: **por
 * que não deu certo?**
 *
 * Por isso ela não devolve uma lista de bolinhas verdes. Ela devolve o estado
 * de cada elo da cadeia MAIS as últimas execuções deste operador, com o estado
 * em que cada uma parou. Uma linha dizendo `enviada_ao_dispositivo` e nada
 * depois responde a pergunta sozinha: o braço não leu a ordem. Uma dizendo
 * `dispositivo_ausente` responde outra: não havia braço nenhum.
 *
 * NADA AQUI É INVENTADO OU ASSUMIDO. Cada linha sai de uma fonte viva no
 * processo: a ponte sabe quantos braços estão pendurados, o cliente de
 * persistência sabe se há banco, o ambiente sabe se há chave da LLM. Um
 * diagnóstico que relata o que deveria estar ligado, em vez do que está, é pior
 * que nenhum — ele ensina a não olhar.
 */

import type { Habilidade } from '../Habilidade';
import { braco, motorTemMaos } from '../../Braco';
import { ponteDispositivos } from '../../../barramento/PonteDispositivos';
import { persistenciaEmUso } from '../../ClienteSupabase';

/** O vocabulário do §27: quatro estados, e `desconhecido` é um deles de propósito. */
type Saude = 'ONLINE' | 'OFFLINE' | 'DEGRADADO' | 'DESCONHECIDO';

const SIMBOLO: Record<Saude, string> = {
  ONLINE: '●',
  DEGRADADO: '◐',
  OFFLINE: '○',
  DESCONHECIDO: '?',
};

function linha(componente: string, saude: Saude, detalhe: string): string {
  return `${SIMBOLO[saude]} ${componente.padEnd(14)} ${saude.padEnd(12)} ${detalhe}`;
}

export const diagnosticarSistema: Habilidade = {
  manifesto: {
    id: 'diagnosticar_sistema',
    nome: 'Diagnóstico do sistema',
    descricao:
      'Relata o estado real de cada parte da IARA: motor, banco, computador do operador, executor, ' +
      'catálogo de ferramentas e serviços externos — mais as últimas execuções e onde cada uma parou. ' +
      'Use para "faça um diagnóstico", "você está funcionando?", "por que não abriu?".',
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 8000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {},
  },

  async executar(ctx) {
    const dispositivos = ponteDispositivos.listar(ctx.id_usuario);
    const maos = motorTemMaos();
    const persistencia = persistenciaEmUso();
    const nuvem = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

    /**
     * Import tardio e deliberado. `habilidades/index.ts` importa ESTE arquivo
     * para montar o catálogo; importá-lo de volta no topo fecharia um ciclo de
     * módulos, que em ESM não explode — ele resolve para `undefined` num dos
     * lados, o que é bem pior: um catálogo que às vezes tem zero habilidades.
     * Aqui dentro, no momento da execução, tudo já está carregado.
     */
    let ferramentas = 0;
    let indisponiveis: string[] = [];
    try {
      const { CATALOGO } = await import('./index');
      ferramentas = CATALOGO.length;
      indisponiveis = CATALOGO.filter((h) => h.indisponivelPorque?.() != null).map(
        (h) => h.manifesto.nome,
      );
    } catch {
      ferramentas = -1;
    }

    /**
     * O EXECUTOR é DEGRADADO — não OFFLINE — quando o motor tem as mãos e não
     * há braço. A distinção é real: nesse estado a IARA executa de verdade, só
     * que na máquina onde o motor roda. Chamar de OFFLINE esconderia uma
     * capacidade que existe; chamar de ONLINE esconderia que ela não alcança o
     * computador que o operador tem na frente.
     */
    const saudeExecutor: Saude =
      dispositivos.length > 0 ? 'ONLINE' : maos ? 'DEGRADADO' : 'OFFLINE';

    const corpo = [
      linha('Motor', 'ONLINE', `processo vivo, respondendo a esta conversa (${process.platform})`),
      linha('Barramento', 'ONLINE', 'esta resposta atravessou o WebSocket para chegar até você'),
      linha(
        'Banco',
        persistencia.includes('supabase') ? 'ONLINE' : 'DEGRADADO',
        `persistência em uso: ${persistencia}`,
      ),
      linha(
        'Computador',
        dispositivos.length > 0 ? 'ONLINE' : 'OFFLINE',
        dispositivos.length > 0
          ? dispositivos.map((d) => `${d.nome} (${d.plataforma}, braço v${d.versao})`).join(' | ')
          : 'nenhum braço conectado a este operador',
      ),
      linha(
        'Executor',
        saudeExecutor,
        dispositivos.length > 0
          ? 'ações vão para o seu computador'
          : maos
            ? 'sem braço; ações correm na máquina onde o motor está — que pode não ser a sua'
            : 'sem braço e sem mãos locais: ação no computador é recusada, nunca simulada',
      ),
      linha(
        'Ferramentas',
        ferramentas > 0 ? (indisponiveis.length > 0 ? 'DEGRADADO' : 'ONLINE') : 'DESCONHECIDO',
        ferramentas > 0
          ? `${ferramentas} no catálogo` +
            (indisponiveis.length > 0 ? `; sem credencial: ${indisponiveis.join(', ')}` : '')
          : 'não consegui ler o catálogo',
      ),
      linha(
        'Raciocínio',
        nuvem ? 'ONLINE' : 'DEGRADADO',
        nuvem
          ? 'chave da nuvem presente'
          : 'sem ANTHROPIC_API_KEY: respondo pelo caminho local, sem raciocínio livre',
      ),
    ];

    /**
     * A TRILHA é o que transforma isto de painel em ferramenta de investigação.
     * Ela vem do Braço, em memória, e carrega o `execucao_id` — o mesmo número
     * que aparece no log estruturado do processo, para quem quiser a linha
     * inteira.
     */
    const trilha = braco.trilhaDe(ctx.id_usuario, 6);
    const rodape =
      trilha.length > 0
        ? [
            '',
            'Últimas execuções no seu computador:',
            ...trilha.map(
              (l) => `  ${l.execucao_id}  ${l.acao} → ${l.estado} (${l.ms} ms, alvo: ${l.alvo})`,
            ),
          ]
        : ['', 'Nenhuma execução pedida nesta sessão ainda.'];

    return {
      texto: ['Diagnóstico da IARA:', '', ...corpo, ...rodape].join('\n'),
      detalhe: `diagnostico: ${dispositivos.length} dispositivo(s), executor ${saudeExecutor}`,
      resolveu: true,
    };
  },
};

export const HABILIDADES_DIAGNOSTICO: readonly Habilidade[] = [diagnosticarSistema];
