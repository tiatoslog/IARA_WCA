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
import { configUtilizavel } from '../Configuracao';
import { estadoRaciocinio } from '../../FabricaRaciocinio';
import { falhasObservadas } from '../../CadeiaDeRaciocinio';
import {
  fichasDeProvedores,
  ROTULO_DO_ESTADO,
  utilizavel,
  type FichaProvedor,
} from '../../DiagnosticoProvedores';

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
    exemplos: [
      'Faça um diagnóstico do sistema',
      'Você está funcionando direito?',
      'Por que não abriu o aplicativo?',
    ],
    capacidades: ['estado real de cada componente', 'últimas execuções e onde pararam'],
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
    /**
     * TRÊS estados, não dois, e a diferença é o incidente inteiro: uma chave
     * CONTAMINADA respondia `true` no booleano antigo, e este painel dizia
     * "ONLINE" enquanto toda requisição à nuvem falhava. Um autodiagnóstico que
     * confunde "configurada" com "utilizável" é pior que nenhum — ele manda
     * quem investiga procurar no lugar errado.
     */
    const nuvem = configUtilizavel('ANTHROPIC_API_KEY');
    const chaveContaminada = !nuvem && Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    /**
     * A MESMA decisão da fábrica, com sonda ATIVA quando o provedor é o Ollama:
     * "configurado" e "respondendo" são estados diferentes, e um painel que os
     * confunde manda quem investiga procurar no lugar errado — é a lição da
     * chave contaminada, aplicada ao provedor local.
     */
    const raciocinio = await estadoRaciocinio();

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
        // OFFLINE e não DEGRADADO quando contaminada, e a distinção é o ponto:
        // DEGRADADO é o modo sem-raciocínio DELIBERADO, que funciona como
        // projetado. Chave contaminada e Ollama declarado-mas-mudo são
        // capacidades fora do ar por engano de deploy — mesmo sintoma da
        // ausência, conserto oposto.
        raciocinio.origem === 'nuvem'
          ? 'ONLINE'
          : raciocinio.origem === 'local'
            ? raciocinio.alcancavel
              ? 'ONLINE'
              : 'OFFLINE'
            : chaveContaminada
              ? 'OFFLINE'
              : 'DEGRADADO',
        raciocinio.origem === 'nuvem'
          ? 'chave da nuvem válida'
          : raciocinio.origem === 'local'
            ? raciocinio.alcancavel
              ? `raciocínio local via Ollama (${raciocinio.modelo}) em ${raciocinio.url}`
              : `OLLAMA_URL configurada (${raciocinio.url}) mas o servidor não responde — ` +
                'o Ollama está desligado, a porta está errada ou a rede não alcança. ' +
                'Não é falta de configuração: é servidor declarado e mudo.'
            : chaveContaminada
              ? 'ANTHROPIC_API_KEY está no ambiente mas é inutilizável — mais de uma ' +
                'configuração no mesmo campo, ou formato errado. Não é falta de chave: ' +
                'é chave contaminada, e o conserto é no painel de variáveis do host.'
              : 'sem ANTHROPIC_API_KEY e sem OLLAMA_URL: respondo pelo caminho local, sem raciocínio livre',
      ),
    ];

    /**
     * OS CÉREBROS, UM POR UM — e a razão de a linha única acima não bastar.
     *
     * Em 16/08/2026 a operadora perguntou pelo celular: "mas você tem outras api
     * do gemini e do grok". A IARA repetiu a frase da cota da Anthropic. A
     * `CadeiaDeRaciocinio` funcionava; o que faltava era a Anthropic ser o único
     * elo daquele motor — as chaves de Groq e Gemini não estavam no ambiente da
     * nuvem, embora estivessem na máquina de desenvolvimento.
     *
     * E não havia como descobrir isso de dentro: `Raciocínio ONLINE — chave da
     * nuvem válida` é a MESMA linha num motor com quatro cérebros e num motor
     * com um. Este bloco existe para que a diferença apareça sem ninguém precisar
     * abrir o painel de variáveis do host.
     *
     * `nao_configurado` é impresso junto com os outros de propósito: o valor
     * inteiro está em ver o que FALTA, não só o que existe.
     */
    const fichas = await fichasDeProvedores({ observado: falhasObservadas() });
    const prontos = fichas.filter(utilizavel);
    const linhaDoProvedor = (f: FichaProvedor): string =>
      `  ${f.apelido.padEnd(10)} ${ROTULO_DO_ESTADO[f.estado].padEnd(16)} ` +
      (f.modelo ? `${f.modelo} — ` : '') +
      f.detalhe;
    const blocoProvedores = [
      '',
      `Cérebros de raciocínio (${prontos.length} utilizável(is) de ${fichas.length} conhecidos):`,
      ...fichas.map(linhaDoProvedor),
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
      texto: ['Diagnóstico da IARA:', '', ...corpo, ...blocoProvedores, ...rodape].join('\n'),
      detalhe:
        `diagnostico: ${dispositivos.length} dispositivo(s), executor ${saudeExecutor}, ` +
        `${prontos.length}/${fichas.length} cérebro(s) utilizável(is)`,
      resolveu: true,
    };
  },
};

export const HABILIDADES_DIAGNOSTICO: readonly Habilidade[] = [diagnosticarSistema];
