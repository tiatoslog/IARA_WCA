/**
 * As seções da documentação que são DERIVADAS do repositório.
 *
 * A regra que governa este arquivo: o que dá para ler do código, lê-se do
 * código. Documentação escrita à mão sobre número de tabela, nome de variável
 * de ambiente ou lista de habilidade envelhece em silêncio — ninguém percebe
 * que está errada até precisar dela.
 *
 * O catálogo de habilidades é IMPORTADO, não analisado com expressão regular:
 * o manifesto é um objeto de verdade, e ler o objeto é a única forma de a
 * documentação não divergir do que a LLM realmente recebe. Todo o resto é
 * leitura de texto, porque o alvo é um arquivo `.sql`, `.env.example` ou um
 * comentário — coisas sem representação em tempo de execução.
 *
 * ⚠️ NENHUMA FUNÇÃO DAQUI PODE EMITIR VALOR DE VARIÁVEL DE AMBIENTE. Só nome,
 * comentário e a informação de que existe padrão declarado. Um gerador que
 * decide caso a caso o que é segredo erra uma vez e vaza para sempre.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const raiz = process.cwd();
const ler = (caminho) => readFileSync(join(raiz, caminho), 'utf8');
const existe = (caminho) => existsSync(join(raiz, caminho));

/** Título de nível 2, do jeito que o analisador de Markdown espera reler. */
const md = (linhas) => linhas.join('\n');

// ---------------------------------------------------------------------------
// Stack e dependências
// ---------------------------------------------------------------------------

const PAPEL_DA_DEPENDENCIA = {
  '@anthropic-ai/sdk': 'Camada de raciocínio (Claude). Opcional: sem chave o sistema roda local.',
  '@react-three/drei': 'Auxiliares de cena para a projeção "presença".',
  '@react-three/fiber': 'React Three Fiber — o avatar 3D.',
  '@supabase/supabase-js': 'Persistência e identidade do operador.',
  dotenv: 'Leitura de `.env.local` fora do Next.',
  'msedge-tts': 'Voz neural gratuita (pt-BR-FranciscaNeural), sintetizada no servidor.',
  next: 'Camada de projeção (interface).',
  react: 'Interface.',
  'react-dom': 'Interface.',
  three: 'Motor 3D sob o React Three Fiber.',
  tsx: 'Execução de TypeScript sem passo de build — é como o motor sobe.',
  ws: 'WebSocket do barramento entre motor e projeção.',
};

export function dependencias() {
  const pkg = JSON.parse(ler('package.json'));
  const linhas = ['## Stack e dependências', ''];

  linhas.push(
    'Derivado de `iara-os/apps/web/package.json`. Runtime único em TypeScript: o motor',
    'cognitivo e a interface são o mesmo processo por padrão.',
    '',
    '| Pacote | Versão declarada | Papel |',
    '|---|---|---|',
  );
  for (const [nome, versao] of Object.entries(pkg.dependencies ?? {})) {
    linhas.push(`| \`${nome}\` | \`${versao}\` | ${PAPEL_DA_DEPENDENCIA[nome] ?? '*(a preencher)*'} |`);
  }

  linhas.push('', '### Dependências de desenvolvimento', '', '| Pacote | Versão declarada |', '|---|---|');
  for (const [nome, versao] of Object.entries(pkg.devDependencies ?? {})) {
    linhas.push(`| \`${nome}\` | \`${versao}\` |`);
  }

  if (pkg.overrides) {
    linhas.push(
      '',
      '### Versões forçadas (`overrides`)',
      '',
      'Existem para fechar aviso de segurança em dependência transitiva — não são',
      'escolha de funcionalidade.',
      '',
      '| Pacote | Versão mínima |',
      '|---|---|',
      ...Object.entries(pkg.overrides).map(([n, v]) => `| \`${n}\` | \`${v}\` |`),
    );
  }
  return md(linhas);
}

// ---------------------------------------------------------------------------
// Comandos e scripts
// ---------------------------------------------------------------------------

const FINALIDADE_DA_PASTA = {
  diagnostico: 'Só LEEM. Podem rodar a qualquer momento, inclusive contra dado real.',
  provas: 'Provas ponta a ponta contra o Kernel real. Escrevem apenas em diretório temporário.',
  geracao: 'ESCREVEM artefatos no repositório (`public/`, ícones do desktop).',
  docs: 'Geram esta documentação.',
};

export function comandos() {
  const pkg = JSON.parse(ler('package.json'));
  const linhas = [
    '## Comandos e scripts',
    '',
    'Todos rodam a partir de `iara-os/apps/web`.',
    '',
    '| Comando | O que executa |',
    '|---|---|',
  ];
  for (const [nome, corpo] of Object.entries(pkg.scripts ?? {})) {
    const curto = corpo.length > 90 ? corpo.slice(0, 87) + '…' : corpo;
    linhas.push(`| \`npm run ${nome}\` | \`${curto.replace(/\|/g, '\\|')}\` |`);
  }

  linhas.push(
    '',
    '### Organização de `scripts/`',
    '',
    'A separação é por *o que o script faz com o disco*, não por assunto: quem chega',
    'novo precisa saber, pelo nome da pasta, se pode rodar sem medo.',
    '',
  );

  for (const pasta of ['diagnostico', 'provas', 'geracao', 'docs']) {
    if (!existe(join('scripts', pasta))) continue;
    const arquivos = readdirSync(join(raiz, 'scripts', pasta))
      .filter((a) => /\.(ts|mjs)$/.test(a) && !a.startsWith('_'))
      .sort();
    linhas.push(`#### \`scripts/${pasta}/\``, '', FINALIDADE_DA_PASTA[pasta], '');
    for (const arquivo of arquivos) {
      linhas.push(`- \`${arquivo}\` — ${primeiraFraseDoCabecalho(join('scripts', pasta, arquivo))}`);
    }
    linhas.push('');
  }
  return md(linhas);
}

/** A primeira frase do comentário de topo do arquivo — a que diz o que ele é. */
function primeiraFraseDoCabecalho(caminho) {
  const texto = ler(caminho);
  const bloco = /^\/\*\*([\s\S]*?)\*\//.exec(texto);
  if (!bloco) return '*(sem descrição no cabeçalho)*';
  const corpo = bloco[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*ppp?/, '').replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ');
  const frase = /^(.*?[.!?])(\s|$)/.exec(corpo);
  return (frase ? frase[1] : corpo).replace(/\s+/g, ' ').slice(0, 220);
}

// ---------------------------------------------------------------------------
// Habilidades — o catálogo que a LLM recebe
// ---------------------------------------------------------------------------

const ROTULO_RISCO = { baixo: 'baixo', medio: 'médio', alto: 'ALTO' };
const ROTULO_CUSTO = { zero: 'zero', baixo: 'baixo', medio: 'médio', alto: 'alto' };

export async function habilidades() {
  const { CATALOGO } = await import('../../servidor/nucleo/kernel/habilidades/index.ts');

  const linhas = [
    '## Habilidades do kernel',
    '',
    `Derivado de \`servidor/nucleo/kernel/habilidades/\` — **${CATALOGO.length} habilidades**, lidas do`,
    'manifesto em tempo de execução. Esta é literalmente a lista que o planejador',
    'oferece ao modelo: se um item aparece aqui, a IARA pode planejá-lo.',
    '',
    '| id | Nome | Domínio | Risco | Custo | Efeito |',
    '|---|---|---|---|---|---|',
  ];

  const porRisco = { alto: [], medio: [], baixo: [] };

  for (const h of [...CATALOGO].sort((a, b) => a.manifesto.id.localeCompare(b.manifesto.id))) {
    const m = h.manifesto;
    porRisco[m.risco]?.push(m);
    linhas.push(
      `| \`${m.id}\` | ${m.nome} | ${m.dominio} | ${ROTULO_RISCO[m.risco] ?? m.risco} | ` +
        `${ROTULO_CUSTO[m.custo] ?? m.custo} | ${m.idempotencia === 'leitura' ? 'só lê' : m.idempotencia} |`,
    );
  }

  if (porRisco.alto.length) {
    linhas.push(
      '',
      '### As de risco alto',
      '',
      'Risco alto significa **efeito que alcança terceiros ou o mundo fora do processo**.',
      'Elas exigem confirmação do operador e permissão `externo` — ver',
      '`servidor/nucleo/kernel/PoliticaRisco.ts` e `Papeis.ts`.',
      '',
    );
    for (const m of porRisco.alto) {
      linhas.push(`- \`${m.id}\` — ${m.nome}. Permissões: ${(m.permissoes ?? []).map((p) => `\`${p}\``).join(', ') || '—'}.`);
    }
  }

  linhas.push(
    '',
    '### Parâmetros declarados',
    '',
    'O esquema é a trava: parâmetro não declarado não chega ao provedor',
    '(ver `Fronteira.ts`). Um campo a mais no plano derruba a chamada inteira.',
    '',
    '| Habilidade | Parâmetro | Tipo | Padrão | Valores aceitos |',
    '|---|---|---|---|---|',
  );
  for (const h of CATALOGO) {
    const m = h.manifesto;
    for (const [nome, esq] of Object.entries(m.esquema ?? {})) {
      linhas.push(
        `| \`${m.id}\` | \`${nome}\` | ${esq.tipo ?? '—'} | ` +
          `${esq.padrao === undefined ? '—' : `\`${esq.padrao}\``} | ` +
          `${esq.dentre ? esq.dentre.map((v) => `\`${v}\``).join(', ') : '—'} |`,
      );
    }
  }
  return md(linhas);
}

// ---------------------------------------------------------------------------
// Banco de dados
// ---------------------------------------------------------------------------

export function banco() {
  if (!existe('supabase/schema.sql')) return '';
  const sql = ler('supabase/schema.sql');

  const linhas = [
    '## Banco de dados',
    '',
    'Derivado de `supabase/schema.sql`. **A persistência é opcional**: sem',
    '`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o motor lê `dados/*.json` e grava',
    'shards em arquivo, sem trocar uma linha de código.',
    '',
  ];

  const tabelas = [...sql.matchAll(/create table if not exists\s+([\w.]+)\s*\(([\s\S]*?)\n\);/gi)];
  linhas.push(`Tabelas: **${tabelas.length}**.`, '');

  for (const [, nome, corpo] of tabelas) {
    linhas.push(`### \`${nome}\``, '');

    const comentario = comentarioAcimaDe(sql, `create table if not exists ${nome}`);
    if (comentario) linhas.push(comentario, '');

    linhas.push('| Coluna | Tipo | Restrições |', '|---|---|---|');
    for (const bruta of corpo.split('\n')) {
      const l = bruta.replace(/--.*$/, '').trim().replace(/,$/, '');
      if (!l || /^(primary key|unique|constraint|foreign key|check)\b/i.test(l)) continue;
      const m = /^([\w"]+)\s+(.+)$/.exec(l);
      if (!m) continue;
      const restos = m[2];
      const tipo = /^([\w]+(\s*\([^)]*\))?(\[\])?)/.exec(restos)?.[1] ?? restos;
      const restricoes = restos.slice(tipo.length).trim();
      linhas.push(`| \`${m[1]}\` | \`${tipo}\` | ${restricoes ? `\`${restricoes.replace(/\|/g, '/')}\`` : '—'} |`);
    }
    linhas.push('');
  }

  const indices = [...sql.matchAll(/create index if not exists\s+(\w+)\s+on\s+([\w.]+)\s*([\s\S]*?);/gi)];
  if (indices.length) {
    linhas.push('### Índices', '', '| Índice | Tabela | Colunas |', '|---|---|---|');
    for (const [, nome, tabela, resto] of indices) {
      const cols = /\(([^)]*)\)/.exec(resto.replace(/\s+/g, ' '))?.[1] ?? '—';
      linhas.push(`| \`${nome}\` | \`${tabela}\` | \`${cols.trim()}\` |`);
    }
    linhas.push('');
  }

  const rls = [...sql.matchAll(/alter table\s+([\w.]+)\s+enable row level security/gi)].map((m) => m[1]);
  if (rls.length) {
    linhas.push(
      '### Row Level Security',
      '',
      `RLS habilitado em **${rls.length} tabelas**: ${rls.map((t) => `\`${t}\``).join(', ')}.`,
      '',
      'Nesta arquitetura a política nega tudo para `anon`. Quem lê e escreve é o',
      'motor, com a `service_role` — que **ignora RLS por definição** e por isso só',
      'existe no servidor. O navegador usa a `anon key` para uma coisa: obter o',
      'token do operador logado.',
      '',
    );
  }

  const politicas = [...sql.matchAll(/create policy\s+"?([^"\n]+?)"?\s+on\s+([\w.]+)/gi)];
  if (politicas.length) {
    linhas.push('| Política | Tabela |', '|---|---|');
    for (const [, nome, tabela] of politicas) linhas.push(`| ${nome} | \`${tabela}\` |`);
    linhas.push('');
  }

  const funcoes = [...sql.matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\(/gi)].map((m) => m[1]);
  if (funcoes.length) {
    linhas.push('### Funções', '', ...funcoes.map((f) => `- \`${f}\``), '');
  }
  const gatilhos = [...sql.matchAll(/create trigger\s+(\w+)/gi)].map((m) => m[1]);
  if (gatilhos.length) {
    linhas.push('### Gatilhos', '', ...gatilhos.map((g) => `- \`${g}\``), '');
  }
  return md(linhas);
}

/** Comentário `--` imediatamente acima da declaração. Colado: sem linha vazia. */
function comentarioAcimaDe(texto, declaracao) {
  const i = texto.toLowerCase().indexOf(declaracao.toLowerCase());
  if (i < 0) return '';
  const antes = texto.slice(0, i).split('\n');
  const colhido = [];
  for (let j = antes.length - 2; j >= 0; j--) {
    const l = antes[j].trim();
    if (l.startsWith('--')) colhido.unshift(l.replace(/^--+\s?/, ''));
    else break; // linha vazia ou código encerram o bloco: o comentário é o COLADO
  }
  return colhido.join(' ').trim();
}

// ---------------------------------------------------------------------------
// Integrações e infraestrutura — nomes e comentários, NUNCA valores
// ---------------------------------------------------------------------------

export function integracoes() {
  if (!existe('.env.example')) return '';
  const texto = ler('.env.example');

  const linhas = [
    '## Integrações e variáveis de ambiente',
    '',
    'Derivado de `.env.example`. **Este documento traz apenas o NOME de cada',
    'variável e o comentário que a acompanha no repositório — nenhum valor.** Os',
    'valores vivem em `.env.local` (nunca versionado) e no painel do host.',
    '',
  ];

  const blocos = [];
  let secao = 'Geral';
  let comentario = [];

  for (const bruta of texto.split('\n')) {
    const l = bruta.trimEnd();
    const cabecalho = /^#\s*-{2,}\s*(.+?)\s*-{2,}\s*$/.exec(l);
    if (cabecalho) {
      secao = cabecalho[1];
      comentario = [];
      continue;
    }
    if (/^#\s*=+\s*$/.test(l) || /^#\s*$/.test(l)) {
      continue;
    }
    if (l.startsWith('#')) {
      const conteudo = l.replace(/^#\s?/, '');
      // Uma variável comentada inteira (`# IARA_CHAVE_PROVA=`) é uma variável
      // opcional documentada, não prosa.
      const desligada = /^([A-Z][A-Z0-9_]{2,})=(.*)$/.exec(conteudo);
      if (desligada) {
        blocos.push({ secao, nome: desligada[1], padrao: false, opcional: true, comentario: comentario.join(' ') });
        comentario = [];
      } else {
        comentario.push(conteudo);
      }
      continue;
    }
    const atribuicao = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);
    if (atribuicao) {
      blocos.push({
        secao,
        nome: atribuicao[1],
        padrao: atribuicao[2].trim().length > 0,
        opcional: false,
        comentario: comentario.join(' '),
      });
      comentario = [];
      continue;
    }
    if (!l.trim()) comentario = [];
  }

  const secoes = [...new Set(blocos.map((b) => b.secao))];
  for (const s of secoes) {
    linhas.push(`### ${s}`, '', '| Variável | Padrão no exemplo | Para que serve |', '|---|---|---|');
    for (const b of blocos.filter((x) => x.secao === s)) {
      const estado = b.opcional ? 'comentada (opcional)' : b.padrao ? 'declarado' : 'vazia — preencher';
      const nota = (b.comentario || '*(a preencher)*').replace(/\|/g, '/').replace(/\s+/g, ' ');
      linhas.push(`| \`${b.nome}\` | ${estado} | ${nota.slice(0, 400)} |`);
    }
    linhas.push('');
  }

  linhas.push(
    '> Onde obter cada valor está no próprio `.env.example`, junto da variável.',
    'Chaves de terceiro (Anthropic, Supabase, Convai, Meta/WhatsApp) saem do painel',
    'de cada fornecedor e vão para o cofre do host — nunca para um arquivo versionado.',
    '',
  );
  return md(linhas);
}

// ---------------------------------------------------------------------------
// Rotas HTTP e canais
// ---------------------------------------------------------------------------

export function rotas() {
  const linhas = [
    '## Superfície de rede',
    '',
    'Derivado de `servidor/principal.ts` e `servidor/canais/`.',
    '',
    '| Caminho | Origem no código | O que é |',
    '|---|---|---|',
  ];

  const principal = ler('servidor/principal.ts');
  const achadas = new Set();
  for (const m of principal.matchAll(/caminho(?:\.startsWith\(|\s*===\s*)'([^']+)'/g)) achadas.add(m[1]);
  for (const m of principal.matchAll(/caminho\.startsWith\('([^']+)'\)/g)) achadas.add(m[1]);

  const DESCRICAO = {
    '/saude': 'Healthcheck. É o caminho que o Railway consulta (`railway.toml`).',
    '/voz/': 'Áudio sintetizado, servido da memória do processo por hash.',
    '/barramento': 'WebSocket entre motor e projeção.',
    '/canais/whatsapp': 'Webhook da Cloud API oficial da Meta.',
  };

  for (const caminho of [...achadas].sort()) {
    linhas.push(`| \`${caminho}\` | \`servidor/principal.ts\` | ${DESCRICAO[caminho] ?? '*(a preencher)*'} |`);
  }

  if (existe('servidor/canais/PortaWhatsapp.ts')) {
    const alvo = /const CAMINHO = '([^']+)'/.exec(ler('servidor/canais/PortaWhatsapp.ts'))?.[1];
    if (alvo && !achadas.has(alvo)) {
      linhas.push(`| \`${alvo}\` | \`servidor/canais/PortaWhatsapp.ts\` | ${DESCRICAO[alvo] ?? 'Canal WhatsApp.'} |`);
    }
  }

  linhas.push(
    '',
    'As páginas do Next são servidas pelo mesmo processo em modo unificado. Em',
    '`IARA_MODO=headless` o motor não instancia o Next e responde apenas aos',
    'caminhos acima.',
    '',
    '### Páginas',
    '',
  );
  for (const pagina of paginasDoApp()) linhas.push(`- \`${pagina.rota}\` — \`${pagina.arquivo}\``);
  return md(linhas);
}

function paginasDoApp() {
  const encontradas = [];
  const varrer = (dir) => {
    if (!existsSync(dir)) return;
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      else if (nome === 'page.tsx') {
        const rel = relative(join(raiz, 'app'), caminho).replace(/\\/g, '/');
        const rota = '/' + rel.replace(/\/?page\.tsx$/, '');
        encontradas.push({ rota: rota === '/' ? '/' : rota, arquivo: `app/${rel}` });
      }
    }
  };
  varrer(join(raiz, 'app'));
  return encontradas.sort((a, b) => a.rota.localeCompare(b.rota));
}

// ---------------------------------------------------------------------------
// Rotinas em segundo plano
// ---------------------------------------------------------------------------

export function rotinas() {
  const linhas = [
    '## Rotinas em segundo plano',
    '',
    'Não há cron externo: o motor é um processo longo e agenda em si mesmo.',
    'Derivado de `servidor/nucleo/CicloAutonomo.ts` e `servidor/nucleo/Agenda.ts`.',
    '',
    '| Rotina | Cadência | Onde está definida |',
    '|---|---|---|',
  ];

  const ciclo = existe('servidor/nucleo/CicloAutonomo.ts') ? ler('servidor/nucleo/CicloAutonomo.ts') : '';
  const intervalo = /const INTERVALO_MS = ([\d_]+)/.exec(ciclo)?.[1];
  const hora = /const HORA_CONSOLIDACAO = (\d+)/.exec(ciclo)?.[1];

  if (intervalo) {
    linhas.push(
      `| Varredura do ciclo autônomo | a cada **${legivelMs(Number(intervalo.replace(/_/g, '')))}** | ` +
        '`CicloAutonomo.ts` → `INTERVALO_MS` |',
    );
  }
  if (hora) {
    linhas.push(
      `| Consolidação de memória | diária, às **${String(hora).padStart(2, '0')}:00** | ` +
        '`CicloAutonomo.ts` → `HORA_CONSOLIDACAO` |',
    );
  }
  return md(linhas);
}

// ---------------------------------------------------------------------------
// Regras de negócio — constante + o comentário COLADO nela
// ---------------------------------------------------------------------------

/**
 * Onde procurar. Lista fechada de propósito: varrer o repositório inteiro traria
 * constante de infraestrutura junto com regra de negócio, e uma tabela onde tudo
 * cabe não informa nada.
 */
const FONTES_DE_REGRA = [
  'servidor/nucleo/CicloAutonomo.ts',
  'servidor/nucleo/Agenda.ts',
  'servidor/nucleo/AgenteLocal.ts',
  'servidor/nucleo/kernel/FuncaoExecutiva.ts',
  'servidor/nucleo/kernel/CompiladorSnapshot.ts',
  'servidor/nucleo/kernel/Kernel.ts',
  'servidor/barramento/FilaTelemetria.ts',
  'servidor/barramento/PonteProjecao.ts',
  'servidor/barramento/SessaoOperador.ts',
  'servidor/barramento/Porta.ts',
];

export function regras() {
  const linhas = [
    '## Regras de negócio com valor no código',
    '',
    'Cada linha diz **onde a regra está definida** e **por que ela existe** — a',
    'justificativa é o comentário colado à declaração, não uma paráfrase. Valor cru',
    'foi convertido para unidade legível.',
    '',
    '| Regra | Valor | Onde | Por que existe |',
    '|---|---|---|---|',
  ];

  for (const arquivo of FONTES_DE_REGRA) {
    if (!existe(arquivo)) continue;
    const texto = ler(arquivo);
    const linhasArquivo = texto.split('\n');

    for (let i = 0; i < linhasArquivo.length; i++) {
      const m = /^const ([A-Z][A-Z0-9_]{2,}) = ([\d_.]+);/.exec(linhasArquivo[i]);
      if (!m) continue;

      const porque = comentarioColado(linhasArquivo, i);
      if (!porque) continue; // sem justificativa não vira regra documentada

      linhas.push(
        `| \`${m[1]}\` | ${legivel(m[1], m[2])} | \`${arquivo}\`:${i + 1} | ${porque.replace(/\|/g, '/')} |`,
      );
    }
  }
  return md(linhas);
}

/**
 * O comentário COLADO à declaração — e só ele.
 *
 * A armadilha que isto evita: subir o arquivo colhendo tudo até achar um
 * comentário traz o cabeçalho do módulo inteiro para dentro de uma célula de
 * tabela. Uma linha em branco entre o comentário e a declaração significa que
 * aquele comentário é de outra coisa.
 */
function comentarioColado(linhas, indice) {
  const colhido = [];
  let i = indice - 1;

  if (i >= 0 && /^\s*\*\//.test(linhas[i])) {
    // Bloco /** … */ terminando na linha imediatamente acima.
    i--;
    while (i >= 0 && !/^\s*\/\*/.test(linhas[i])) {
      colhido.unshift(linhas[i].replace(/^\s*\*\s?/, '').trim());
      i--;
    }
  } else {
    while (i >= 0 && /^\s*\/\/\s?/.test(linhas[i])) {
      colhido.unshift(linhas[i].replace(/^\s*\/\/\s?/, '').trim());
      i--;
    }
  }

  const frase = colhido.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!frase) return '';
  return frase.length > 300 ? frase.slice(0, 297) + '…' : frase;
}

const legivelMs = (ms) =>
  ms >= 3_600_000
    ? `${(ms / 3_600_000).toFixed(ms % 3_600_000 ? 1 : 0)} h`
    : ms >= 60_000
      ? `${(ms / 60_000).toFixed(ms % 60_000 ? 1 : 0)} min`
      : ms >= 1000
        ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s`
        : `${ms} ms`;

/**
 * Valor cru não comunica. `40` não diz nada; `40 ms` diz. `0.85` não diz nada;
 * `85%` diz. A unidade vem do NOME da constante, que é onde ela está declarada.
 */
function legivel(nome, bruto) {
  const n = Number(String(bruto).replace(/_/g, ''));
  if (Number.isNaN(n)) return `\`${bruto}\``;
  if (/_MS$/.test(nome)) return `**${legivelMs(n)}**`;
  if (/^HORA_/.test(nome)) return `**${String(n).padStart(2, '0')}:00**`;
  if (/^(CONFIANCA|DECAIMENTO|LIMIAR)/.test(nome) && n <= 1) return `**${(n * 100).toFixed(0)}%**`;
  if (/POR_MINUTO$/.test(nome)) return `**${n}/min**`;
  if (/^MAX/.test(nome)) return `**${n}** (máximo)`;
  return `**${n}**`;
}
