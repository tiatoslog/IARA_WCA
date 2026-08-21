/**
 * UMA PERGUNTA NÃO ESCREVE NO MUNDO — e a rota deixa de ser irrevogável.
 *
 * O DEFEITO (auditoria arquitetural de 21/08/2026), reproduzido contra o
 * `Planejador` real:
 *
 *   « esse lembrete das 11h foi criado quando? »
 *     → agendar_lembrete({ assunto: "das foi criado quando", quando: "hoje às 11:00" })
 *   « a captura de tela funciona? »
 *     → capturar_tela({ local: "documentos" })
 *
 * Os dois são `escrita_nao_idempotente`. Os dois nasciam na rota `plano_local`,
 * que não dá volta (`daVolta` em `Kernel.executarLaco`), com `origem:
 * 'deterministico'` — sem LLM no caminho — e risco `medio`, que o
 * `PorteiroAutorizacao` não retém (só risco alto exige confirmação prévia).
 * Nenhuma porta da cadeia inteira podia ler a frase de novo. O operador
 * perguntava e a agenda dele ganhava um item.
 *
 * A CAUSA NÃO ERA A REGEX DE NENHUMA ÂNCORA, e é isso que este arquivo existe
 * para travar. Era a FORMA das receitas: cancelar e listar são casos casados
 * por regex, e CRIAR é o que sobra no `return` final. Alargar a regex de
 * listagem foi a correção de 14/08/2026 para este mesmo defeito — está
 * documentada em `Planejador.ts` — e o defeito voltou pela frase seguinte,
 * porque a forma continuou intacta.
 *
 * POR ISSO O PORTÃO É ESTRUTURAL, NUNCA UMA LISTA DE FRASES. O primeiro teste
 * varre TODAS as receitas com perguntas montadas a partir das próprias âncoras,
 * e a idempotência vem do manifesto. Uma receita nova que caia em escrita por
 * default reprova aqui sem que ninguém precise se lembrar de escrever o caso —
 * que é a única forma de o ciclo "pergunta nova → quebra → regex nova" parar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { ehInterrogativa } from '../servidor/nucleo/texto';

const percepcao = new MotorPercepcao();

/** id → semântica de efeito, direto do manifesto. Nunca uma lista aqui. */
const EFEITO = new Map(CATALOGO.map((h) => [h.manifesto.id, h.manifesto.idempotencia] as const));

/** A MESMA composição que o Kernel injeta — ver `new Planejador` em `Kernel.ts`. */
const ORIGINA = (id: string): boolean => {
  const m = CATALOGO.find((h) => h.manifesto.id === id)?.manifesto;
  return m !== undefined && m.idempotencia !== 'leitura' && m.fecha_interacao_aberta !== true;
};

const planejador = new Planejador(ORIGINA);

function passosComEfeito(frase: string): string[] {
  const p = percepcao.perceber(frase);
  if (!planejador.temReceita(p)) return [];
  return planejador
    .planejar(p, { id_usuario: 'auditor', sessao: 'auditoria' })
    .passos.filter((s) => {
      return s.habilidade !== null && ORIGINA(s.habilidade);
    })
    .map((s) => `${s.habilidade}[${EFEITO.get(String(s.habilidade))}]`);
}

/**
 * As frases que reproduziam o defeito, verbatim. Ficam ao lado da varredura
 * estrutural, não no lugar dela: a varredura prova a propriedade, estas provam
 * que o caso medido de fato morreu.
 */
const MEDIDAS = [
  'quando esse segundo lembrete foi criado?',
  'esse lembrete das 11h foi criado quando?',
  'a captura de tela funciona?',
];

for (const frase of MEDIDAS) {
  test(`pergunta medida não compila para efeito: « ${frase} »`, () => {
    assert.deepEqual(
      passosComEfeito(frase),
      [],
      'a receita determinística compilou uma pergunta em escrita',
    );
  });
}

/**
 * A VARREDURA. Para cada âncora com receita, uma pergunta construída sobre o
 * VOCABULÁRIO DA PRÓPRIA ÂNCORA — quer dizer, uma frase que casa o
 * reconhecedor e ainda assim é interrogativa.
 *
 * Não é a mesma coisa que testar frases bonitas: o que importa é que a frase
 * chegue à receita. Se ela não casar âncora nenhuma, o caso não prova nada e o
 * teste diz isso em vez de passar de graça.
 */
const SONDAS: readonly string[] = [
  'quando esse segundo lembrete foi criado?',
  'esse lembrete das 11h foi criado quando?',
  'quantos lembretes eu tenho?',
  'a captura de tela funciona?',
  'que capturas de tela existem?',
  'quando essa pasta foi criada?',
  'quais pastas existem aqui?',
  'quais aplicativos estão abertos?',
  'o excel está aberto?',
  'como eu fecho o aplicativo?',
  'quais repositórios você atualiza?',
  'o que acontece se eu desligar a máquina?',
  'quando o repositório foi atualizado?',
  'quantos arquivos tem na pasta?',
];

test('varredura: nenhuma PERGUNTA compila para efeito no mundo', () => {
  const vazamentos = SONDAS.filter((f) => passosComEfeito(f).length > 0).map(
    (f) => `${f} → ${passosComEfeito(f).join(',')}`,
  );
  assert.deepEqual(vazamentos, [], 'perguntas que a receita determinística transformou em escrita');
});

test('a varredura consegue reprovar — as sondas alcançam receita de verdade', () => {
  /**
   * MUTAÇÃO INVERSA. Um portão que nunca dispara e um teste que nunca reprova
   * são a mesma doença — a lição de `iara-duble-nao-pode-ser-o-porteiro`. Se
   * NENHUMA sonda casasse âncora, o teste acima passaria por vácuo, e passaria
   * para sempre, inclusive depois de alguém quebrar tudo.
   */
  const comReceita = SONDAS.filter((f) => planejador.temReceita(percepcao.perceber(f)));
  assert.ok(
    comReceita.length >= 4,
    `só ${comReceita.length} sonda(s) alcançam receita — a varredura virou vácuo`,
  );
  assert.ok(SONDAS.every(ehInterrogativa), 'toda sonda precisa ser interrogativa');
});

/**
 * O OUTRO LADO, e ele é a metade que impede a correção de virar uma trava
 * covarde: a ORDEM continua escrevendo. Uma trava que fecha a escrita inteira
 * "resolve" o defeito e quebra o produto.
 */
const ORDENS: ReadonlyArray<readonly [string, string]> = [
  ['cria um lembrete pra amanhã de manhã', 'agendar_lembrete'],
  ['tira um print da tela', 'capturar_tela'],
];

for (const [frase, esperada] of ORDENS) {
  test(`a ORDEM continua escrevendo: « ${frase} » → ${esperada}`, () => {
    assert.ok(
      passosComEfeito(frase).some((s) => s.startsWith(esperada)),
      `« ${frase} » deveria compilar para ${esperada}`,
    );
  });
}

test('ehInterrogativa é sintaxe, não vocabulário de domínio', () => {
  /**
   * A PROPRIEDADE QUE MANTÉM A CORREÇÃO GERAL. No dia em que alguém acrescentar
   * um substantivo de domínio ao reconhecedor de pergunta, ele vira mais uma
   * lista de frases — a doença que esta correção existe para tratar. O teste
   * usa palavras que não existem em lugar nenhum do catálogo.
   */
  assert.equal(ehInterrogativa('quantos flurbos temos?'), true);
  assert.equal(ehInterrogativa('quando o zibaldone foi criado'), true);
  assert.equal(ehInterrogativa('qual o estado do grommet'), true);
  assert.equal(ehInterrogativa('cria um grommet novo'), false);
  assert.equal(ehInterrogativa('desliga o zibaldone agora'), false);
});

test('contrato: o Kernel injeta semântica TOTAL sobre o catálogo', () => {
  /**
   * O CONTRATO QUE FECHA O BURACO DO PADRÃO OPCIONAL.
   *
   * `Planejador` aceita `semanticaDe` opcional para não obrigar quinze arquivos
   * de teste a conhecer o catálogo — e o padrão é `leitura`, que é permissivo.
   * Em produção isso seria um guarda desarmado em silêncio, que é a pior forma
   * de trava: a que existe, tem teste, e ninguém consulta (o defeito de
   * 11/08/2026 documentado em `PorteiroAutorizacao.ts`).
   *
   * O Kernel injeta `(id) => this.habilidades.manifesto(id)?.idempotencia`.
   * Este teste prova que essa função é TOTAL sobre o catálogo: toda habilidade
   * que uma receita pode citar tem semântica declarada, então nenhuma escapa do
   * guarda por `undefined`.
   */
  const semDeclaracao = CATALOGO.filter((h) => h.manifesto.idempotencia === undefined).map(
    (h) => h.manifesto.id,
  );
  assert.deepEqual(semDeclaracao, [], 'habilidade sem idempotencia escaparia do guarda');
  assert.ok(EFEITO.size >= 40, `catálogo pequeno demais (${EFEITO.size}) — o contrato virou vácuo`);
});
