/**
 * AS TRÊS ABAS — 2026, 2025 e 2024 no mesmo arquivo.
 *
 * O QUE BLOQUEOU ISSO POR TRÊS MESES foi um comentário, não um obstáculo. Ele
 * afirmava que as abas antigas têm "outro desenho de colunas (VALOR na 17; nas
 * antigas, na 25, com um bloco AGENDAMENTO no meio)", e a frase virou o motivo
 * de a IARA recusar qualquer pergunta sobre 2025. Ninguém a conferiu.
 *
 * MEDIDO em 19/08/2026 por `testes/gate/mapear-abas.mjs`, contra o arquivo real:
 *
 *   campo             2026      2025      2024
 *   OCI                  4         4         4
 *   ORIGEM (POSTO)       5         5         5
 *   DESTINO (CENTRAL)    7         7         7
 *   MOTORISTA           10        10        10
 *   DATA COLETA         11        11        11
 *   DATA DESCARGA       12        12        12
 *   VALOR               23        24        24
 *   status              21     não existe  não existe
 *
 * Nove dos onze campos nos MESMOS índices. Diverge só o que vem depois do bloco
 * AGENDAMENTO (colunas 13–20), que existe nas antigas e não em 2026. E nenhum
 * dos números do comentário — nem 17, nem 25 — existe na planilha.
 *
 * O bloqueio era muito maior que o obstáculo: ler as antigas custou um mapa de
 * duas linhas por ano.
 *
 * O QUE ESTE ARQUIVO GUARDA, e não é o layout (esse é fato sobre o arquivo, e
 * `mapear-abas.mjs` é quem o mede): é a SEMÂNTICA que o layout implica —
 * `status` ausente não é status vazio, `ano` não se deriva da data, e o universo
 * padrão continua sendo o ano vivo mesmo agora que há três.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANOS_LIDOS,
  ANO_VIVO,
  anoCitado,
  anoForaDoAlcance,
  contarDistintos,
  type AnoLido,
  type CargaCompleta,
} from '../servidor/nucleo/ClientePlanilhaOcis';

test('o alcance são três abas, e o ano vivo é uma delas', () => {
  assert.deepEqual([...ANOS_LIDOS], ['2026', '2025', '2024']);
  assert.ok((ANOS_LIDOS as readonly string[]).includes(ANO_VIVO));
});

// ---------------------------------------------------------------------------
// O ano citado x o ano recusado — duas perguntas, duas funções
// ---------------------------------------------------------------------------

test('anoCitado devolve o ano quando a leitura o alcança', () => {
  assert.equal(anoCitado('quantas cargas em 2025?'), '2025');
  assert.equal(anoCitado('qual a margem em 2024?'), '2024');
  assert.equal(anoCitado('quantas cargas em 2026?'), '2026');
});

test('anoCitado ignora ano fora do alcance — quem recusa é anoForaDoAlcance', () => {
  assert.equal(anoCitado('quantas cargas em 2023?'), null);
  assert.equal(anoForaDoAlcance('quantas cargas em 2023?'), '2023');
});

test('sem ano na frase, ninguém inventa um', () => {
  assert.equal(anoCitado('quantos motoristas temos?'), null);
  assert.equal(anoForaDoAlcance('quantos motoristas temos?'), null);
});

/**
 * O NÚMERO DE OCI NÃO É ANO. "1920155" carrega "2015" no miolo, e um `\d{4}`
 * sem fronteira transformaria consulta de OCI em recusa — ou pior, em troca
 * silenciosa de aba.
 */
test('número de OCI não vira ano nem em anoCitado nem em anoForaDoAlcance', () => {
  for (const frase of ['me mostra a OCI 191597', 'a carga 2020156 chegou?', 'OCI 190949 e 192852']) {
    assert.equal(anoCitado(frase), null, `"${frase}" virou ano em anoCitado`);
    assert.equal(anoForaDoAlcance(frase), null, `"${frase}" virou recusa`);
  }
});

// ---------------------------------------------------------------------------
// A semântica que o layout implica
// ---------------------------------------------------------------------------

/**
 * `status` NÃO EXISTE nas abas antigas — e isso não é "status vazio".
 *
 * Uma carga de 2024 não tem status desconhecido: ela tem status inexistente.
 * Chamar as duas coisas de `SEM_STATUS` faria a IARA responder "4000 cargas sem
 * status preenchido" para um ano em que ninguém deixou de preencher nada.
 */
test('o mapa das abas diz que status não existe em 2025 nem em 2024', () => {
  const fonte = readFileSync(
    new URL('../servidor/nucleo/ClientePlanilhaOcis.ts', import.meta.url),
    'utf8',
  );
  const mapa = fonte.slice(fonte.indexOf('const MAPA_DA_ABA'), fonte.indexOf('function paraCargaCompleta'));
  assert.match(mapa, /'2026':\s*\{\s*valor:\s*23,\s*status:\s*21\s*\}/, 'o mapa de 2026 mudou');
  assert.match(mapa, /'2025':\s*\{\s*valor:\s*24,\s*status:\s*null\s*\}/, 'o mapa de 2025 mudou');
  assert.match(mapa, /'2024':\s*\{\s*valor:\s*24,\s*status:\s*null\s*\}/, 'o mapa de 2024 mudou');
});

/**
 * `ano` VEM DA ABA, não da data de coleta. Uma OCI recebida em dezembro e
 * coletada em janeiro mora na aba do ano em que foi cadastrada. A aba é o fato;
 * a data é outro campo. Confundir os dois faria a contagem por ano discordar da
 * planilha que a operadora abre na tela — e a planilha vence sempre.
 */
test('o ano da carga é a aba, e pode discordar da data de coleta', () => {
  const carga: CargaCompleta = {
    ano: '2025',
    oci: 'OCI-X',
    origem: 'SP',
    uf_origem: 'SP',
    destino: 'MT',
    uf_destino: 'MT',
    motorista: 'LINO',
    data_rec_oci: '2025-12-28',
    /* Coletada já em 2026, mas cadastrada na aba de 2025. */
    data_coleta: '2026-01-03',
    data_descarga: '2026-01-04',
    status: '',
    status_normalizado: 'SEM_STATUS',
    valor: 1000,
  };
  assert.equal(carga.ano, '2025', 'a aba mandou');
  assert.ok(carga.data_coleta!.startsWith('2026'), 'a data é de outro ano, e tudo bem');
});

/**
 * O UNIVERSO PADRÃO CONTINUA SENDO O ANO VIVO.
 *
 * Ler três abas NÃO pode transformar "quantos motoristas temos?" numa contagem
 * dos três anos juntos: 53 viraria outro número sem ninguém pedir, e toda
 * resposta já verificada nesta auditoria mudaria de significado em silêncio.
 * Quem quer outro ano PEDE o ano; quem não pede recebe o vivo, e a resposta diz
 * qual é.
 */
test('a habilidade só troca de aba quando o ano é pedido', () => {
  const fonte = readFileSync(
    new URL('../servidor/nucleo/kernel/habilidades/cargasLuft.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    fonte,
    /anoCitado\(ctx\.enunciado\)\s*\|\|\s*ANO_VIVO/,
    'sem ano pedido, o universo tem de continuar sendo o ano vivo',
  );
  /* E a frase crua tem precedência sobre o parâmetro, porque o caso perigoso é
     a LLM largar o ano pelo caminho. */
  assert.match(fonte, /String\(ctx\.parametros\.ano/, 'o parâmetro de ano sumiu');
});

test('o rótulo e a procedência nomeiam a aba que respondeu, não a constante', () => {
  const fonte = readFileSync(
    new URL('../servidor/nucleo/kernel/habilidades/cargasLuft.ts', import.meta.url),
    'utf8',
  );
  assert.match(fonte, /todas as cargas de \$\{anoPedido\}/, 'o rótulo voltou a fixar o ano');
  assert.match(fonte, /fonte: anoPedido/, 'a procedência voltou a carimbar um ano fixo');
  /* Sem os comentários: a folha CITA `fonte: '2026'` ao contar o defeito de
     18/08, e essa citação é história, não código. Um portão que confunde as
     duas coisas reprova quem documentou o próprio erro. */
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/fonte: '20\d\d'/.test(codigo),
    "a procedência ficou com um ano cravado — carimbaria 2026 numa resposta de 2025",
  );
});

/**
 * A CONTAGEM NÃO MUDA DE REGRA POR CAUSA DA ABA. Ausência continua não sendo
 * entidade em 2024 do mesmo jeito que em 2026 — o defeito DIST-002 não tem ano.
 */
test('a política de nulo vale igual nas três abas', () => {
  const de = (ano: AnoLido, motorista: string): CargaCompleta => ({
    ano,
    oci: `OCI-${ano}-${motorista || 'vazio'}`,
    origem: 'SP',
    uf_origem: 'SP',
    destino: 'MT',
    uf_destino: 'MT',
    motorista,
    data_rec_oci: null,
    data_coleta: null,
    data_descarga: null,
    status: '',
    status_normalizado: 'SEM_STATUS',
    valor: null,
  });
  for (const ano of ANOS_LIDOS) {
    const r = contarDistintos([de(ano, 'LINO'), de(ano, 'LINO'), de(ano, '')], 'motorista');
    assert.equal(r.distintos, 1, `${ano}: a mesma pessoa contou duas vezes`);
    assert.equal(r.ausentes, 1, `${ano}: a ausência sumiu em vez de ser declarada`);
  }
});
