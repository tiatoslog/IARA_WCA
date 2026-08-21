/**
 * INVENTÁRIO REAL DO CATÁLOGO — extraído do sistema, nunca escrito à mão.
 *
 * Uma lista digitada por alguém é uma segunda verdade ao lado do código, e ela
 * envelhece em silêncio: a habilidade some do catálogo e continua no relatório,
 * ou entra no catálogo e nunca aparece na auditoria. Este arquivo importa o
 * `CATALOGO` e descreve o que ele DE FATO contém.
 */

import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';
import { ACOES_DESKTOP } from '../../lib/execucao';

interface Linha {
  id: string;
  nome: string;
  risco: string;
  permissoes: string[];
  operacao: string;
  parametros: string[];
  obrigatorios: string[];
  temExemplos: boolean;
  temVerificador: boolean;
  temSemantica: string;
  precisaBraco: boolean;
  precisaRede: boolean;
  precisaLlm: boolean;
}

const acoesDesktop = new Set<string>(ACOES_DESKTOP as readonly string[]);

const linhas: Linha[] = CATALOGO.map((h) => {
  const m = h.manifesto as unknown as Record<string, unknown>;
  const esquema = (m.esquema ?? {}) as Record<string, { obrigatorio?: boolean }>;
  const permissoes = ((m.permissoes ?? []) as string[]).slice();
  const id = String(m.id);
  return {
    id,
    nome: String(m.nome ?? ''),
    risco: String(m.risco ?? '(sem risco declarado)'),
    permissoes,
    operacao: String(m.operacao ?? '(sem operação semântica)'),
    parametros: Object.keys(esquema),
    obrigatorios: Object.entries(esquema)
      .filter(([, c]) => c?.obrigatorio)
      .map(([k]) => k),
    temExemplos: Array.isArray(m.exemplos) && (m.exemplos as unknown[]).length > 0,
    temVerificador: typeof (h as unknown as Record<string, unknown>).verificar === 'function',
    temSemantica: String(m.semantica ?? '—'),
    /* "Precisa do braço" não é um campo declarado: deriva-se de a habilidade
       falar o vocabulário do `ExecutorDesktop`. Melhor derivar do que confiar
       num rótulo que ninguém é obrigado a manter. */
    precisaBraco: acoesDesktop.has(id) || /desktop|aplicativo|tela|arquivo|pasta|sistema/i.test(id),
    precisaRede: permissoes.includes('rede'),
    precisaLlm: permissoes.includes('llm'),
  };
});

console.log(`TOTAL DE HABILIDADES NO CATÁLOGO: ${linhas.length}`);
console.log(`AÇÕES DE DESKTOP (contrato do braço): ${acoesDesktop.size} — ${[...acoesDesktop].join(', ')}`);
console.log('');
console.log(
  [
    'id',
    'risco',
    'operacao',
    'permissoes',
    'obrigatorios',
    'exemplos',
    'verificador',
    'semantica',
  ].join('\t'),
);
for (const l of linhas.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(
    [
      l.id,
      l.risco,
      l.operacao,
      l.permissoes.join('+') || '—',
      l.obrigatorios.join('+') || '—',
      l.temExemplos ? 'sim' : 'NAO',
      l.temVerificador ? 'sim' : 'NAO',
      l.temSemantica,
    ].join('\t'),
  );
}

console.log('');
console.log('=== SEM VERIFICADOR (quem não tem como provar o próprio efeito) ===');
for (const l of linhas.filter((x) => !x.temVerificador)) console.log(`  ${l.id}  [${l.risco}]  ${l.operacao}`);

console.log('');
console.log('=== POR PERMISSÃO ===');
for (const p of ['escrita', 'externo', 'rede', 'banco', 'memoria', 'llm']) {
  const q = linhas.filter((l) => l.permissoes.includes(p)).map((l) => l.id);
  console.log(`  ${p}: ${q.length} — ${q.join(', ') || '(nenhuma)'}`);
}

console.log('');
console.log('=== POR RISCO ===');
for (const r of ['baixo', 'medio', 'alto']) {
  const q = linhas.filter((l) => l.risco === r).map((l) => l.id);
  console.log(`  ${r}: ${q.length} — ${q.join(', ') || '(nenhuma)'}`);
}
