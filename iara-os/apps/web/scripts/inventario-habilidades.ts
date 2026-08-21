/**
 * INVENTÁRIO DE HABILIDADES — derivado do código, nunca escrito à mão.
 *
 * A pergunta que este arquivo responde: *o que a IARA afirma saber fazer?* — e a
 * resposta tem de sair do catálogo em execução, não da memória de quem escreve.
 * Uma matriz curada à mão testa as 30 habilidades de que alguém lembrou enquanto
 * as outras 13 seguem sem ninguém saber que existem.
 *
 * TUDO AQUI É LIDO, NADA É DECLARADO:
 *
 *   · a lista sai de `CATALOGO`, o mesmo objeto que o Kernel oferece à LLM;
 *   · risco, semântica, permissões, esquema e exemplos saem do manifesto, que é
 *     obrigatório em tempo de compilação;
 *   · confirmação prévia e verificação obrigatória saem de `PoliticaPadrao`;
 *   · "a LLM pode planejar isto?" sai de `PorteiroAutorizacao.planejavel`;
 *   · "existe verificador independente?" sai da presença de `verificar` na
 *     habilidade — não de uma coluna que alguém preenche;
 *   · a cobertura de bateria sai de varrer `testes/` pelo id literal.
 *
 * O QUE ISTO NÃO É: não é o harness de validação. Ele mede se a habilidade
 * FUNCIONA; isto declara o que existe e por quais portas cada uma passa. A
 * matriz é o insumo do harness — sem ela, o harness também testaria o que
 * alguém lembrou.
 *
 *   npx tsx scripts/inventario-habilidades.ts            → matriz em markdown
 *   npx tsx scripts/inventario-habilidades.ts --json     → dado para o harness
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { HABILIDADES_OPERACIONAIS } from '../servidor/nucleo/kernel/habilidades/operacionais';
import { HABILIDADES_DADOS } from '../servidor/nucleo/kernel/habilidades/dados';
import { HABILIDADES_INTEGRACAO } from '../servidor/nucleo/kernel/habilidades/integracoes';
import { HABILIDADES_CALENDARIO } from '../servidor/nucleo/kernel/habilidades/calendario';
import { HABILIDADES_AGENTE_LOCAL } from '../servidor/nucleo/kernel/habilidades/agenteLocal';
import { HABILIDADES_AGENTE_CODIGO } from '../servidor/nucleo/kernel/habilidades/agenteCodigo';
import { HABILIDADES_AGENDA } from '../servidor/nucleo/kernel/habilidades/agenda';
import { HABILIDADES_DIAGNOSTICO } from '../servidor/nucleo/kernel/habilidades/diagnostico';
import { HABILIDADES_INVESTIGACAO } from '../servidor/nucleo/kernel/habilidades/investigacao';
import { HABILIDADES_AUDITORIA } from '../servidor/nucleo/kernel/habilidades/auditoria';
import { HABILIDADES_PLANILHA_OCIS } from '../servidor/nucleo/kernel/habilidades/cargasLuft';
import { HABILIDADES_PLANILHA_GENERICA } from '../servidor/nucleo/kernel/habilidades/planilhaGenerica';
import { PoliticaPadrao } from '../servidor/nucleo/kernel/Seguranca';
import { PoliticaRisco } from '../servidor/nucleo/kernel/PoliticaRisco';
import { PorteiroAutorizacao } from '../servidor/nucleo/kernel/PorteiroAutorizacao';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, '..');

const GRUPOS: ReadonlyArray<readonly [string, readonly Habilidade[]]> = [
  ['operacionais', HABILIDADES_OPERACIONAIS],
  ['dados', HABILIDADES_DADOS],
  ['integrações', HABILIDADES_INTEGRACAO],
  ['calendário', HABILIDADES_CALENDARIO],
  ['braço (máquina do operador)', HABILIDADES_AGENTE_LOCAL],
  ['agente de código', HABILIDADES_AGENTE_CODIGO],
  ['agenda', HABILIDADES_AGENDA],
  ['diagnóstico', HABILIDADES_DIAGNOSTICO],
  ['investigação', HABILIDADES_INVESTIGACAO],
  ['auditoria', HABILIDADES_AUDITORIA],
  ['planilha LUFT', HABILIDADES_PLANILHA_OCIS],
  ['planilha genérica', HABILIDADES_PLANILHA_GENERICA],
];

/** Todo arquivo de teste, lido uma vez. A cobertura é grep pelo id literal. */
function arquivosDeTeste(): ReadonlyArray<readonly [string, string]> {
  const achados: Array<[string, string]> = [];
  const andar = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) {
        andar(p);
        continue;
      }
      if (!/\.(ts|mjs|js)$/.test(nome)) continue;
      achados.push([path.relative(APP, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]);
    }
  };
  andar(path.join(APP, 'testes'));
  return achados;
}

/* Duas políticas, duas perguntas: `PoliticaRisco` diz quanta prova o risco
   exige; `PoliticaPadrao` diz o que cada PAPEL pode usar. */
const risco = new PoliticaRisco();
const politica = new PoliticaPadrao();
const porteiro = new PorteiroAutorizacao();
const testes = arquivosDeTeste();

interface LinhaDoInventario {
  readonly id: string;
  readonly nome: string;
  readonly grupo: string;
  readonly descricao: string;
  readonly dominio: string;
  readonly capacidade: string;
  /** A coluna ENTRADA: frase real de operador, gravada no manifesto. */
  readonly exemplos: readonly string[];
  readonly parametros: ReadonlyArray<{
    readonly nome: string;
    readonly tipo: string;
    readonly obrigatorio: boolean;
    readonly dentre: readonly string[] | null;
    readonly sinonimos: number;
  }>;
  readonly risco: string;
  readonly idempotencia: string;
  readonly permissoes: readonly string[];
  readonly custo: string;
  readonly timeout_ms: number;
  /** Segurança, derivada da política — não declarada aqui. */
  readonly confirmacao_previa: boolean;
  readonly verificacao_obrigatoria: boolean;
  readonly planejavel_pela_llm: boolean;
  /** Evidência independente: a habilidade implementa `verificar`? */
  readonly verificador_proprio: boolean;
  /** Por onde ela alcança o mundo. */
  readonly alcanca: readonly string[];
  /** Recuperação declarada: o esquema traz sinônimo ou valor padrão? */
  readonly recuperacao: readonly string[];
  readonly baterias: readonly string[];
  /** O papel `somente_leitura` alcança esta habilidade? Coluna de autorização. */
  readonly somente_leitura_pode: boolean;
  /**
   * PARÂMETRO ABERTO — texto obrigatório sem `dentre` e sem sinônimos.
   *
   * A classe de defeito mais cara já medida aqui: o modelo tem de adivinhar uma
   * string exata, e uma palavra fora do vocabulário mata o turno. Foi assim que
   * `agrupar_por` derrubou a pergunta "quantas cargas temos?" em produção
   * (18/08), e é a mesma forma de `abrir_aplicativo`, cuja allowlist vive
   * dentro do `AgenteLocal` e chega ao modelo só pela prosa da descrição.
   *
   * Ter `dentre` não é burocracia: é o que faz o erro morrer no esquema, barato
   * e com a lista dos valores aceitos na mensagem — que foi exatamente o que
   * permitiu ao laço se recuperar sozinho na medição de 19/08.
   */
  readonly parametros_abertos: readonly string[];
}

const ALCANCE: Record<string, string> = {
  rede: 'internet',
  banco: 'base da operação',
  memoria: 'shard do operador',
  llm: 'modelo (tokens)',
  escrita: 'máquina do motor',
  externo: 'terceiro (em nome do operador)',
};

const inventario: LinhaDoInventario[] = [];

for (const [grupo, lista] of GRUPOS) {
  for (const h of lista) {
    const m = h.manifesto;
    const exigencia = risco.exigenciaDe(m.risco);
    const campos = Object.entries(m.esquema ?? {});

    const recuperacao: string[] = [];
    if (campos.some(([, c]) => (c as { sinonimos?: object }).sinonimos))
      recuperacao.push('sinônimos declarados no esquema');
    if (campos.some(([, c]) => (c as { padrao?: unknown }).padrao !== undefined))
      recuperacao.push('valor padrão');
    if (typeof h.verificar === 'function') recuperacao.push('verificador confere depois');

    inventario.push({
      id: m.id,
      nome: m.nome,
      grupo,
      descricao: m.descricao,
      dominio: m.dominio,
      capacidade: m.capacidade,
      exemplos: m.exemplos ?? [],
      parametros: campos.map(([nome, c]) => {
        const campo = c as {
          tipo: string;
          obrigatorio?: boolean;
          dentre?: readonly string[];
          sinonimos?: Record<string, string>;
        };
        return {
          nome,
          tipo: campo.tipo,
          obrigatorio: Boolean(campo.obrigatorio),
          dentre: campo.dentre ? [...campo.dentre] : null,
          sinonimos: campo.sinonimos ? Object.keys(campo.sinonimos).length : 0,
        };
      }),
      risco: m.risco,
      idempotencia: m.idempotencia,
      permissoes: [...m.permissoes],
      custo: m.custo,
      timeout_ms: m.timeout_ms,
      confirmacao_previa: exigencia.confirmacaoPrevia,
      verificacao_obrigatoria: exigencia.verificacaoPosterior,
      planejavel_pela_llm: m.custo === 'zero' && m.id !== 'sigilo' && porteiro.planejavel(m.risco),
      verificador_proprio: typeof h.verificar === 'function',
      alcanca: m.permissoes.map((p) => ALCANCE[p] ?? p),
      recuperacao,
      baterias: testes.filter(([, txt]) => txt.includes(m.id)).map(([f]) => f),
      somente_leitura_pode: politica.podeUsar('somente_leitura', m.id),
      parametros_abertos: campos
        .filter(([, c]) => {
          const campo = c as { tipo: string; obrigatorio?: boolean; dentre?: unknown; sinonimos?: unknown };
          return campo.tipo === 'texto' && campo.obrigatorio && !campo.dentre && !campo.sinonimos;
        })
        .map(([nome]) => nome),
    });
  }
}

// ---------------------------------------------------------------------------

if (process.argv.includes('--json')) {
  const destino = path.join(APP, 'test-evidence', 'INVENTARIO', 'habilidades.json');
  writeFileSync(destino, JSON.stringify({ gerado_em: null, habilidades: inventario }, null, 2));
  console.log(`${inventario.length} habilidades → ${path.relative(APP, destino)}`);
  process.exit(0);
}

const sim = (b: boolean) => (b ? 'sim' : '—');
const linhas: string[] = [];

linhas.push('# Inventário de habilidades da IARA');
linhas.push('');
linhas.push(
  `**${inventario.length} habilidades** em ${GRUPOS.length} grupos, derivadas de \`CATALOGO\` — ` +
    'o mesmo objeto que o Kernel oferece à LLM. Nenhuma linha foi escrita à mão.',
);
linhas.push('');

const semBateria = inventario.filter((h) => h.baterias.length === 0);
const semVerificador = inventario.filter((h) => h.verificacao_obrigatoria && !h.verificador_proprio);
const alcancamOMundo = inventario.filter((h) => h.permissoes.some((p) => p === 'escrita' || p === 'externo'));

linhas.push('## O que a contagem já diz');
linhas.push('');
linhas.push('| | |');
linhas.push('|---|---|');
linhas.push(`| habilidades no catálogo | ${inventario.length} |`);
linhas.push(`| planejáveis pela LLM | ${inventario.filter((h) => h.planejavel_pela_llm).length} |`);
linhas.push(`| exigem confirmação prévia | ${inventario.filter((h) => h.confirmacao_previa).length} |`);
linhas.push(`| alteram o mundo (escrita ou externo) | ${alcancamOMundo.length} |`);
linhas.push(`| com verificador próprio | ${inventario.filter((h) => h.verificador_proprio).length} |`);
linhas.push(`| **exigem verificação e NÃO têm verificador** | **${semVerificador.length}** |`);
linhas.push(`| **sem nenhuma bateria citando o id** | **${semBateria.length}** |`);
linhas.push(`| sem exemplo de entrada no manifesto | ${inventario.filter((h) => h.exemplos.length === 0).length} |`);
const comAberto = inventario.filter((h) => h.parametros_abertos.length > 0);
linhas.push(`| com texto livre obrigatório | ${comAberto.length} |`);
linhas.push('');

if (comAberto.length > 0) {
  linhas.push('### Texto livre obrigatório — superfície a triar, não lista de defeitos');
  linhas.push('');
  linhas.push(
    'Parâmetro `texto` obrigatório sem `dentre` e sem sinônimos. **A maioria é ' +
      'legítima**: a consulta de `pesquisar_web` e a mensagem de `enviar_whatsapp` ' +
      'são texto livre por natureza, e enumerá-las não faria sentido. O que esta ' +
      'lista existe para separar é o subconjunto em que o parâmetro **é uma lista ' +
      'fechada que vive fora do esquema** — ali o modelo aprende os valores pela ' +
      'prosa da descrição, e uma palavra fora deles morre no executor em vez de ' +
      'morrer no esquema.',
  );
  linhas.push('');
  linhas.push(
    'É a forma do defeito de 18/08 (`agrupar_por` fora do enum matou o turno) e o ' +
      'oposto do que salvou a medição de 19/08: `uf` TEM `dentre`, o erro morreu no ' +
      'esquema com a lista dos aceitos na mensagem, e o laço se corrigiu sozinho na ' +
      'volta seguinte.',
  );
  linhas.push('');
  linhas.push('| habilidade | parâmetro | risco | a lista existe fora do esquema? |');
  linhas.push('|---|---|---|---|');
  /* Os três abaixo foram CONFERIDOS no código: a allowlist mora no executor.
     O resto fica marcado como "a conferir" — afirmar sem ler seria inventar. */
  const listaFechadaConhecida: Record<string, string> = {
    'abrir_aplicativo.aplicativo': 'sim — allowlist em AgenteLocal',
    'fechar_aplicativo.aplicativo': 'sim — allowlist em AgenteLocal',
    'atualizar_repositorio.repositorio': 'sim — RepositoriosAutorizados',
    'abrir_sessao_agente_codigo.repositorio': 'sim — RepositoriosAutorizados',
  };
  for (const h of comAberto) {
    for (const par of h.parametros_abertos) {
      /* Chave por (habilidade, PARÂMETRO). Chavear só pela habilidade marcava
         `instrucao` de `abrir_sessao_agente_codigo` como lista fechada — e ela
         é texto livre. Agregar por engano é a forma mais fácil de um inventário
         mentir. */
      const fechada = listaFechadaConhecida[`${h.id}.${par}`];
      linhas.push(
        `| \`${h.id}\` | \`${par}\` | ${h.risco} | ${fechada ?? 'a conferir'} |`,
      );
    }
  }
  linhas.push('');
}

if (semVerificador.length > 0) {
  linhas.push('### Exigem verificação e não têm verificador próprio');
  linhas.push('');
  for (const h of semVerificador) linhas.push(`- \`${h.id}\` (risco ${h.risco})`);
  linhas.push('');
}
if (semBateria.length > 0) {
  linhas.push('### Nenhuma bateria menciona o id');
  linhas.push('');
  for (const h of semBateria) linhas.push(`- \`${h.id}\` — ${h.descricao.slice(0, 80)}`);
  linhas.push('');
}

for (const [grupo] of GRUPOS) {
  const doGrupo = inventario.filter((h) => h.grupo === grupo);
  if (doGrupo.length === 0) continue;
  linhas.push(`## ${grupo} — ${doGrupo.length}`);
  linhas.push('');
  for (const h of doGrupo) {
    linhas.push(`### \`${h.id}\``);
    linhas.push('');
    linhas.push(`${h.descricao}`);
    linhas.push('');
    linhas.push('| campo | valor |');
    linhas.push('|---|---|');
    linhas.push(`| **entrada** (exemplos do manifesto) | ${h.exemplos.length ? h.exemplos.map((e) => `"${e}"`).join(' · ') : '— *sem exemplo declarado*'} |`);
    linhas.push(
      `| **parâmetros** | ${
        h.parametros.length
          ? h.parametros
              .map(
                (p) =>
                  `\`${p.nome}\`:${p.tipo}${p.obrigatorio ? ' *(obrig.)*' : ''}` +
                  (p.dentre ? ` ∈ {${p.dentre.join('\\|')}}` : '') +
                  (p.sinonimos ? ` +${p.sinonimos} sinônimos` : ''),
              )
              .join('<br>')
          : 'nenhum'
      } |`,
    );
    linhas.push(`| **alcança** | ${h.alcanca.join(', ')} |`);
    linhas.push(`| **risco / repetir** | ${h.risco} / ${h.idempotencia} |`);
    linhas.push(
      `| **segurança** | confirmação prévia: ${sim(h.confirmacao_previa)} · verificação obrigatória: ${sim(h.verificacao_obrigatoria)} · planejável pela LLM: ${sim(h.planejavel_pela_llm)} |`,
    );
    linhas.push(`| **papel somente-leitura alcança** | ${sim(h.somente_leitura_pode)} |`);
    if (h.parametros_abertos.length > 0) {
      linhas.push(`| **texto livre obrigatório** | ${h.parametros_abertos.map((p) => `\`${p}\``).join(', ')} |`);
    }
    linhas.push(`| **evidência independente** | ${h.verificador_proprio ? 'verificador próprio' : '— *a resposta é o resultado*'} |`);
    linhas.push(`| **recuperação** | ${h.recuperacao.length ? h.recuperacao.join(' · ') : '— *nenhuma declarada*'} |`);
    linhas.push(`| **timeout** | ${h.timeout_ms} ms |`);
    linhas.push(`| **baterias que citam o id** | ${h.baterias.length ? h.baterias.map((b) => `\`${b}\``).join(' ') : '— **nenhuma**'} |`);
    linhas.push('');
  }
}

const destino = path.join(APP, 'test-evidence', 'INVENTARIO', 'habilidades.md');
writeFileSync(destino, linhas.join('\n'));
console.log(linhas.slice(0, 60).join('\n'));
console.log(`\n… matriz completa (${inventario.length} habilidades) em ${path.relative(APP, destino)}`);
