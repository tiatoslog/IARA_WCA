/**
 * Árvore de blocos → HTML autocontido.
 *
 * Autocontido é requisito, não gosto: este arquivo é aberto por duplo clique,
 * mandado por e-mail e às vezes salvo num pendrive. Fonte, folha de estilo e
 * script externos quebrariam nos três casos. Nenhuma requisição sai da página.
 */
import { puro } from './markdown.mjs';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Âncora estável a partir do texto da rubrica — é o alvo do sumário. */
export const ancora = (texto) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function linha(partes) {
  return partes
    .map((p) => {
      if (p.t === 'codigo') return `<code>${esc(p.v)}</code>`;
      if (p.t === 'forte') return `<strong>${esc(p.v)}</strong>`;
      if (p.t === 'enfase') return `<em>${esc(p.v)}</em>`;
      if (p.t === 'link') return `<a href="${esc(p.href)}">${esc(p.v)}</a>`;
      return esc(p.v);
    })
    .join('');
}

export function gerarHtml(blocos, { titulo, subtitulo }) {
  const corpo = [];
  const sumario = [];

  for (const b of blocos) {
    if (b.tipo === 'titulo') {
      const texto = puro(b.partes);
      const id = ancora(texto);
      if (b.nivel <= 2) sumario.push({ nivel: b.nivel, texto, id });
      corpo.push(`<h${b.nivel} id="${id}">${linha(b.partes)}</h${b.nivel}>`);
    } else if (b.tipo === 'paragrafo') {
      corpo.push(`<p>${linha(b.partes)}</p>`);
    } else if (b.tipo === 'citacao') {
      corpo.push(`<blockquote>${linha(b.partes)}</blockquote>`);
    } else if (b.tipo === 'regua') {
      corpo.push('<hr>');
    } else if (b.tipo === 'lista') {
      const tag = b.ordenada ? 'ol' : 'ul';
      corpo.push(`<${tag}>${b.itens.map((i) => `<li>${linha(i.partes)}</li>`).join('')}</${tag}>`);
    } else if (b.tipo === 'codigo') {
      corpo.push(`<pre><code>${esc(b.texto)}</code></pre>`);
    } else if (b.tipo === 'tabela') {
      const cab = b.cabecalho.map((c) => `<th>${linha(c)}</th>`).join('');
      const linhas = b.linhas
        .map((l) => `<tr>${b.cabecalho.map((_, i) => `<td>${linha(l[i] ?? [])}</td>`).join('')}</tr>`)
        .join('');
      corpo.push(`<div class="rolagem"><table><thead><tr>${cab}</tr></thead><tbody>${linhas}</tbody></table></div>`);
    }
  }

  const indice = sumario
    .map((s) => `<li class="n${s.nivel}"><a href="#${s.id}">${esc(s.texto)}</a></li>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body>
<header>
  <h1 class="capa">${esc(titulo)}</h1>
  <p class="sub">${esc(subtitulo ?? '')}</p>
</header>
<nav aria-label="Sumário"><h2>Sumário</h2><ol>${indice}</ol></nav>
<main>${corpo.join('\n')}</main>
</body>
</html>
`;
}

const ESTILO = `
:root{
  --tinta:#1b2322; --tinta-fraca:#5a554a; --papel:#faf9f6; --papel-fundo:#f1efe9;
  --verde:#1b5e5a; --verde-escuro:#16302e; --borda:#ddd8cc; --codigo:#f3f1ec;
}
@media (prefers-color-scheme: dark){
  :root{
    --tinta:#e6e3da; --tinta-fraca:#a29c8e; --papel:#161a19; --papel-fundo:#0f1312;
    --verde:#6fb5ad; --verde-escuro:#9ed3cc; --borda:#2b3230; --codigo:#1c2220;
  }
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--papel-fundo); color:var(--tinta);
  font:16px/1.65 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  padding:0 1rem 6rem;
}
header,nav,main{max-width:52rem; margin:0 auto; background:var(--papel);
  padding:1px 2.6rem; border:1px solid var(--borda); border-top:none}
header{margin-top:2.5rem; border-top:1px solid var(--borda); padding-top:3rem; padding-bottom:1.5rem}
h1.capa{font-size:2.6rem; line-height:1.15; margin:0; color:var(--verde-escuro); letter-spacing:-.02em}
.sub{color:var(--tinta-fraca); margin:.6rem 0 0; font-size:1.05rem}
nav{padding-top:1.4rem; padding-bottom:1.4rem; background:var(--papel)}
nav h2{font-size:.78rem; text-transform:uppercase; letter-spacing:.12em;
  color:var(--tinta-fraca); margin:0 0 .7rem}
nav ol{list-style:none; margin:0; padding:0; columns:2; column-gap:2.4rem}
nav li{break-inside:avoid; margin:.18rem 0; font-size:.9rem}
nav li.n2{padding-left:1rem; font-size:.85rem}
nav a{color:var(--verde); text-decoration:none}
nav a:hover{text-decoration:underline}
main{padding-top:2rem; padding-bottom:3rem}
h1,h2,h3,h4{line-height:1.25; color:var(--verde-escuro)}
main h1{font-size:1.8rem; margin:2.6rem 0 1rem; padding-bottom:.45rem; border-bottom:1px solid var(--borda)}
main h2{font-size:1.32rem; margin:2.1rem 0 .8rem; color:var(--verde)}
main h3{font-size:1.08rem; margin:1.6rem 0 .5rem}
main h4{font-size:.96rem; margin:1.3rem 0 .4rem; color:var(--tinta-fraca)}
p{margin:0 0 .95rem}
ul,ol{margin:0 0 1rem; padding-left:1.4rem}
li{margin:.25rem 0}
code{font:.87em/1.5 ui-monospace,"Cascadia Code",Consolas,monospace;
  background:var(--codigo); padding:.12em .38em; border-radius:4px}
pre{background:var(--codigo); border:1px solid var(--borda); border-radius:8px;
  padding:.9rem 1.1rem; overflow-x:auto; margin:0 0 1.1rem}
pre code{background:none; padding:0; font-size:.83rem; line-height:1.55}
blockquote{margin:0 0 1rem; padding:.1rem 0 .1rem 1rem;
  border-left:3px solid var(--borda); color:var(--tinta-fraca)}
hr{border:none; border-top:1px solid var(--borda); margin:2rem 0}
.rolagem{overflow-x:auto; margin:0 0 1.3rem}
table{border-collapse:collapse; width:100%; font-size:.9rem}
th,td{border:1px solid var(--borda); padding:.5rem .7rem; text-align:left; vertical-align:top}
th{background:var(--papel-fundo); font-weight:600}
a{color:var(--verde)}
@media print{
  body{background:#fff; padding:0}
  header,nav,main{border:none; max-width:none; padding:0}
  nav{page-break-after:always}
  pre,table,blockquote{page-break-inside:avoid}
}
`;
