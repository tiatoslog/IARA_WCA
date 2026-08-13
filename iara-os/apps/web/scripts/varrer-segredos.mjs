/**
 * A ÚLTIMA BARREIRA ANTES DO GIT.
 *
 * Varre o que está para ser commitado (staged) — e, com `--tudo`, a árvore
 * rastreada inteira — procurando credencial real. Se achar, o commit é
 * bloqueado e NENHUM valor é impresso: só arquivo, linha e o padrão que bateu.
 *
 * Por que existe, se o histórico já foi auditado limpo em 13/08/2026: porque
 * "está limpo" é um fato sobre o passado. Esta varredura é sobre o próximo
 * commit — o único sobre o qual ainda dá para fazer alguma coisa barata.
 * Credencial que entrou no Git está comprometida MESMO depois de removida do
 * arquivo; a resposta vira revogar, rotacionar e reescrever história. Barrar
 * antes custa um segundo.
 *
 * Uso:
 *   node scripts/varrer-segredos.mjs          # o que está staged
 *   node scripts/varrer-segredos.mjs --tudo   # árvore rastreada inteira
 *
 * Falso positivo tem saída honesta: os testes usam valores FABRICADOS com a
 * marca `F`/`Z` repetida ou a palavra "falsa"/"fake" — o filtro abaixo os
 * reconhece pela repetição, não por lista de exceção por arquivo, porque uma
 * lista de exceções é onde a próxima credencial real se esconde.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PADROES = [
  ['chave Anthropic', /sk-ant-[A-Za-z0-9_-]{30,}/g],
  ['JWT assinado', /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g],
  ['token GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ['token Slack', /xox[abprs]-[A-Za-z0-9-]{20,}/g],
  ['chave AWS', /AKIA[0-9A-Z]{16}/g],
  ['chave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['URL com senha embutida', /(postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/g],
  ['chave OpenAI', /sk-proj-[A-Za-z0-9_-]{30,}/g],
];

/**
 * Um valor fabricado de teste tem entropia de brinquedo: o mesmo caractere
 * repetido 8+ vezes seguidas. Nenhum gerador de credencial real produz isso.
 */
const ehFabricado = (trecho) => /(.)\1{7,}/.test(trecho);

const git = (args) =>
  execFileSync('git', args, { maxBuffer: 1024 * 1024 * 128, encoding: 'utf8' });

const tudo = process.argv.includes('--tudo');

let alvo;
if (tudo) {
  alvo = git(['ls-files'])
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.(png|jpg|jpeg|gif|webp|glb|gltf|mp3|wav|ico|woff2?|ttf|pdf|zip)$/i.test(f))
    .map((f) => {
      // Da árvore de trabalho, não do índice: `git show :caminho` resolve
      // relativo à raiz do repositório e este script roda num subdiretório.
      try {
        return { origem: f, texto: readFileSync(f, 'utf8') };
      } catch {
        return null; // apagado localmente, ou binário sem decodificação
      }
    })
    .filter(Boolean);
} else {
  // Só as LINHAS ADICIONADAS do diff staged: o que este commit introduz.
  const diff = git(['diff', '--cached', '--unified=0']);
  let arquivo = '(diff)';
  const linhas = [];
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ b/')) arquivo = l.slice(6);
    else if (l.startsWith('+') && !l.startsWith('+++')) linhas.push({ origem: arquivo, texto: l.slice(1) });
  }
  alvo = linhas;
}

const achados = [];
for (const { origem, texto } of alvo) {
  for (const [nome, re] of PADROES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texto)) !== null) {
      if (ehFabricado(m[0])) continue;
      achados.push({ origem, nome });
    }
  }
}

if (achados.length === 0) {
  console.log(
    tudo
      ? '[varredura] árvore rastreada limpa: nenhuma credencial de formato conhecido.'
      : '[varredura] staged limpo: nenhuma credencial de formato conhecido.',
  );
  process.exit(0);
}

console.error('[varredura] COMMIT BLOQUEADO — possível credencial real:');
for (const a of achados) console.error(`  · ${a.nome} em ${a.origem}`);
console.error(
  '\nNenhum valor foi impresso, de propósito. Se é credencial real: NÃO commite;\n' +
    'remova do arquivo, e considere-a COMPROMETIDA se já circulou (revogar e\n' +
    'rotacionar). Se é valor de teste: fabrique-o com um caractere repetido\n' +
    '(ex.: "F".repeat(48)), que é a marca que esta varredura reconhece.',
);
process.exit(1);
