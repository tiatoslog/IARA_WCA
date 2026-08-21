/**
 * Gera a documentação técnica do IARA OS. `npm run docs`
 *
 * Combina duas fontes que nunca se misturam:
 *
 *   DERIVADO   lido do repositório a cada execução (dependências, habilidades,
 *              banco, variáveis de ambiente, rotas, rotinas, regras de negócio).
 *              Não se edita: edita-se o código, e o documento acompanha.
 *
 *   MANUAL     `docs/manual/*.md`, escrito por quem conhece a operação. É o que
 *              o repositório NÃO sabe: por que o sistema existe, quem responde
 *              por ele, o que dá errado às três da manhã.
 *
 * Saída em `docs/gerado/`: Markdown, HTML, Word e PDF do mesmo conteúdo.
 *
 * Termina varrendo o documento pronto atrás de segredo e dado pessoal. Se achar,
 * FALHA — e a correção é na origem, nunca no documento gerado.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

import { analisar } from './markdown.mjs';
import { gerarHtml } from './html.mjs';
import { gerarDocx } from './docx.mjs';
import { gerarPdf } from './pdf.mjs';
import * as derivar from './derivar.mjs';

const APP = process.cwd();
const REPO = resolve(APP, '..', '..', '..');
const MANUAL = join(REPO, 'docs', 'manual');
const SAIDA = join(REPO, 'docs', 'gerado');

const TITULO = 'IARA OS — Documentação Técnica';

/**
 * A ordem do documento. Manual e derivado se alternam de propósito: quem lê
 * precisa do "por que" antes da tabela, e da tabela antes do "como operar".
 *
 * Um arquivo listado aqui e ausente do disco vira aviso, não erro: a seção
 * escrita à mão pode estar em elaboração, e travar a geração por isso deixaria
 * o time sem documento nenhum.
 */
const ROTEIRO = [
  { manual: '01-visao-geral.md' },
  { manual: '02-escopo.md' },
  { manual: '03-arquitetura.md' },
  { derivado: 'dependencias' },
  { derivado: 'rotas' },
  { derivado: 'habilidades' },
  { derivado: 'regras' },
  { derivado: 'banco' },
  { derivado: 'integracoes' },
  { derivado: 'rotinas' },
  { manual: '04-fluxos-operacionais.md' },
  { manual: '05-autenticacao.md' },
  { manual: '06-deploy.md' },
  { manual: '07-desenvolvimento-local.md' },
  { derivado: 'comandos' },
  { manual: '08-monitoramento.md' },
  { manual: '09-troubleshooting.md' },
  { manual: '10-backup-recuperacao.md' },
  { manual: '11-seguranca-lgpd.md' },
  { manual: '12-custos-e-contas.md' },
  { manual: '13-responsabilidades.md' },
  { manual: '14-roadmap.md' },
  { manual: '15-debitos-tecnicos.md' },
  { manual: '16-riscos.md' },
  { manual: '17-checklist-transferencia.md' },
];

async function montar() {
  const pedacos = [];
  const ausentes = [];

  for (const passo of ROTEIRO) {
    if (passo.manual) {
      const caminho = join(MANUAL, passo.manual);
      if (!existsSync(caminho)) {
        ausentes.push(passo.manual);
        continue;
      }
      pedacos.push(readFileSync(caminho, 'utf8').trim());
    } else {
      const texto = await derivar[passo.derivado]();
      if (texto && texto.trim()) pedacos.push(texto.trim());
    }
  }

  if (ausentes.length) {
    console.warn(`\n  aviso: seções manuais ausentes (${ausentes.length}): ${ausentes.join(', ')}`);
  }
  return pedacos.join('\n\n');
}

/**
 * Varredura final. Procura no DOCUMENTO PRONTO o que nunca pode sair daqui.
 *
 * Não procura a palavra "senha" — procura o formato de um segredo. Um documento
 * que fala sobre chaves é normal; um que CONTÉM uma chave é um incidente.
 */
const PROIBIDO = [
  { nome: 'chave da Anthropic', padrao: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { nome: 'JWT / chave Supabase', padrao: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { nome: 'string de conexão com senha', padrao: /(?:postgres|postgresql|mysql|mongodb)(?:\+\w+)?:\/\/[^\s:]+:[^\s@]+@/i },
  { nome: 'token do WhatsApp/Meta', padrao: /EAA[A-Za-z0-9]{20,}/ },
  { nome: 'chave de API genérica', padrao: /\b(?:api[_-]?key|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_-]{24,}/i },
  { nome: 'CPF', padrao: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
  { nome: 'CNPJ', padrao: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/ },
  { nome: 'telefone brasileiro', padrao: /\b(?:\+55\s?)?\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b/ },
  { nome: 'chave privada', padrao: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function varrer(markdown) {
  const achados = [];
  const linhas = markdown.split('\n');
  for (const { nome, padrao } of PROIBIDO) {
    for (let i = 0; i < linhas.length; i++) {
      const m = padrao.exec(linhas[i]);
      if (m) achados.push({ nome, linha: i + 1, trecho: m[0].slice(0, 24) + '…' });
    }
  }
  return achados;
}

function commitAtual() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'sem git';
  }
}

// ---------------------------------------------------------------------------

const markdown = await montar();
const achados = varrer(markdown);

if (achados.length) {
  console.error('\n  VARREDURA REPROVOU — o documento contém o que não pode sair daqui:\n');
  for (const a of achados) console.error(`    linha ${a.linha}: ${a.nome} (${a.trecho})`);
  console.error('\n  Corrija a ORIGEM (o código ou a seção manual), não o documento gerado.\n');
  process.exit(1);
}

mkdirSync(SAIDA, { recursive: true });

const commit = commitAtual();
const carimbo = `Gerado de \`npm run docs\` no commit \`${commit}\`. Não editar: as seções derivadas do código são reescritas a cada execução.`;
const subtitulo = `Atos Log · commit ${commit}`;

const completo = `# ${TITULO}\n\n> ${carimbo}\n\n${markdown}\n`;
const blocos = analisar(markdown);

const saidas = [
  ['IARA-OS-Documentacao.md', Buffer.from(completo, 'utf8')],
  ['IARA-OS-Documentacao.html', Buffer.from(gerarHtml(blocos, { titulo: TITULO, subtitulo }), 'utf8')],
  ['IARA-OS-Documentacao.docx', gerarDocx(blocos, { titulo: TITULO, subtitulo })],
  ['IARA-OS-Documentacao.pdf', gerarPdf(blocos, { titulo: TITULO, subtitulo })],
];

for (const [nome, dados] of saidas) writeFileSync(join(SAIDA, nome), dados);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`\n  ${blocos.length} blocos · varredura de segredos: limpa · commit ${commit}\n`);
for (const [nome, dados] of saidas) console.log(`    docs/gerado/${nome.padEnd(32)} ${kb(dados.length).padStart(8)}`);
console.log('');
