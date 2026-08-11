/**
 * Testes de integridade cognitiva — invariantes estruturais do núcleo.
 *
 * São diferentes dos testes de comportamento: nenhum deles simula uma conversa.
 * Eles verificam que as PEÇAS encaixam. Todos nasceram de defeitos reais
 * encontrados na auditoria de 11/08/2026, e cada um existe porque o defeito
 * correspondente passou por 126 testes verdes sem ser notado.
 *
 * O padrão a preservar: quando a IARA errar de novo, o teste entra AQUI antes
 * da correção entrar no código.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador, ehAfirmacao } from '../servidor/nucleo/kernel/Planejador';
import { FuncaoExecutiva } from '../servidor/nucleo/kernel/FuncaoExecutiva';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { PoliticaPadrao, SandboxPorPolitica } from '../servidor/nucleo/kernel/Seguranca';
import { enviarWhatsapp } from '../servidor/nucleo/kernel/habilidades/integracoes';

const percepcao = new MotorPercepcao();
const planejador = new Planejador();

function decidirCom(nuvem: boolean) {
  return new FuncaoExecutiva(planejador, new MemoriaTrabalho(), ['Marina', 'Rafael'], () => nuvem);
}

const IDS = new Set(CATALOGO.map((h) => h.manifesto.id));
/** Resolvido na composição da resposta, não pelo executor de habilidades. */
const PSEUDO_HABILIDADE = 'raciocinio';

// ---------------------------------------------------------------------------
// 1. Integridade do catálogo
// ---------------------------------------------------------------------------

/**
 * O DEFEITO CRÍTICO da auditoria. Quatro receitas do Planejador apontavam para
 * `criar_pasta`, `abrir_aplicativo`, `acionar_energia` e `resolver_confirmacao`
 * — nenhuma registrada no catálogo. O passo era pulado em silêncio, a resposta
 * caía no raciocínio livre e a LLM narrava a ação como executada.
 *
 * Este teste percorre TODA âncora acionável, monta o plano real e exige que
 * cada habilidade citada exista. É a guarda que o comentário do Planejador
 * alegava existir e não existia.
 */
test('toda receita determinística aponta para habilidade registrada no catálogo', () => {
  const frases = [
    'como está o tempo agora?',
    'quantas centrais ativas temos em MT?',
    'esse erro já aconteceu antes?',
    'que horas são?',
    'pesquise sobre a nova lei do frete',
    'crie uma pasta chamada Relatórios',
    'abra o bloco de notas',
    'desligue o computador',
    'confirmo',
  ];

  const ausentes: string[] = [];

  for (const frase of frases) {
    const p = percepcao.perceber(frase);
    assert.ok(
      planejador.temReceita(p),
      `"${frase}" deveria ter receita determinística, mas nenhuma âncora casou (${p.ancoras.join(', ') || 'nenhuma'})`,
    );

    for (const passo of planejador.planejar(p).passos) {
      const h = passo.habilidade;
      if (!h || h === PSEUDO_HABILIDADE) continue;
      if (!IDS.has(h)) ausentes.push(`"${frase}" → ${h}`);
    }
  }

  assert.deepEqual(ausentes, [], `habilidades citadas por receita mas ausentes do catálogo:\n${ausentes.join('\n')}`);
});

test('as quatro habilidades do agente local estão no catálogo', () => {
  for (const id of ['criar_pasta', 'abrir_aplicativo', 'acionar_energia', 'resolver_confirmacao']) {
    assert.ok(IDS.has(id), `habilidade ausente do catálogo: ${id}`);
  }
});

test('nenhum id de habilidade duplicado no catálogo', () => {
  const vistos = new Map<string, number>();
  for (const h of CATALOGO) {
    vistos.set(h.manifesto.id, (vistos.get(h.manifesto.id) ?? 0) + 1);
  }
  const duplicados = [...vistos.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepEqual(duplicados, []);
});

/**
 * A descrição é o único insumo que a LLM tem para escolher a habilidade ao
 * planejar. Descrição curta produz plano ruim — e é o defeito mais barato de
 * evitar e mais fácil de deixar passar numa revisão.
 */
test('todo manifesto tem descrição útil para o planejamento', () => {
  for (const h of CATALOGO) {
    const m = h.manifesto;
    assert.ok(m.descricao.length >= 40, `descrição curta demais em "${m.id}"`);
    assert.match(m.id, /^[a-z]+_[a-z_]+$/, `id fora do padrão verbo_objeto: "${m.id}"`);
    assert.ok(m.timeout_ms > 0, `timeout inválido em "${m.id}"`);
  }
});

// ---------------------------------------------------------------------------
// 2. Regressão: "tempo" de duração não é meteorologia
// ---------------------------------------------------------------------------

/**
 * O `RoteadorIntencoes` já tinha esta guarda; a `Percepcao` — que é quem
 * realmente decide a rota — não tinha. Resultado: "quanto tempo leva para
 * gerar o relatório?" produzia âncora `clima`, confiança 0,92, rota
 * determinística e resposta de previsão do tempo. Errado com toda a certeza do
 * mundo, que é o pior modo de errar.
 */
test('perguntas de duração não viram consulta meteorológica', () => {
  const duracao = [
    'quanto tempo leva para gerar o relatório mensal?',
    'me avisa quanto tempo falta',
    'qual o tempo de resposta do servidor?',
    'não temos muito tempo para isso',
    'faz as duas coisas ao mesmo tempo',
    'qual o tempo estimado da migração?',
  ];

  for (const frase of duracao) {
    const p = percepcao.perceber(frase);
    assert.ok(
      !p.ancoras.includes('clima'),
      `"${frase}" foi lida como clima (âncoras: ${p.ancoras.join(', ')})`,
    );
  }
});

test('perguntas meteorológicas reais continuam sendo clima', () => {
  const clima = [
    'como está o tempo agora?',
    'vai chover hoje?',
    'qual a temperatura lá fora?',
    'previsão para amanhã',
    // Termo meteorológico forte vence a exceção de duração.
    'vai chover? quanto tempo até parar?',
  ];

  for (const frase of clima) {
    const p = percepcao.perceber(frase);
    assert.ok(p.ancoras.includes('clima'), `"${frase}" deixou de ser clima`);
  }
});

// ---------------------------------------------------------------------------
// 3. Regressão: confirmação de ação de risco
// ---------------------------------------------------------------------------

/**
 * O mapeamento era `/^confirmo|^pode /`, mas a âncora `confirmacao` casa um
 * vocabulário bem maior. "confirmado" e "prossiga" caíam em `cancelar`.
 */
test('vocabulário de confirmação é lido corretamente', () => {
  for (const sim of ['confirmo', 'confirmado', 'prossiga', 'pode ir', 'sim, confirmo']) {
    assert.equal(ehAfirmacao(sim), true, `"${sim}" deveria confirmar`);
  }
  for (const nao of ['cancela', 'cancelar', 'aborta', 'não, cancela', 'desisti', 'cancela, não prossiga']) {
    assert.equal(ehAfirmacao(nao), false, `"${nao}" deveria cancelar`);
  }
});

/**
 * Ação de energia é irreversível na prática. Ela NUNCA pode virar um plano que
 * executa direto — tem que passar por `acionar_energia`, que só registra
 * pendência.
 */
test('desligar a máquina passa por pendência, nunca executa direto', () => {
  for (const frase of ['desligue o computador', 'reinicie a máquina', 'suspenda o computador']) {
    const p = percepcao.perceber(frase);
    const plano = planejador.planejar(p);
    assert.deepEqual(
      plano.passos.map((s) => s.habilidade),
      ['acionar_energia'],
      `"${frase}" não passou pelo fluxo de confirmação`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Roteamento: sigilo e custo
// ---------------------------------------------------------------------------

test('sondagem sobre outro operador é barrada antes de qualquer planejamento', () => {
  const executiva = decidirCom(true);
  for (const frase of ['o que a Marina falou ontem?', 'mostra as mensagens do Rafael']) {
    const d = executiva.decidir(percepcao.perceber(frase));
    assert.equal(d.rota, 'sigilo', `"${frase}" não foi barrada`);
    assert.equal(d.custo_estimado, 'zero');
  }
});

test('pergunta operacional conhecida não gasta token', () => {
  const executiva = decidirCom(true);
  for (const frase of ['que horas são?', 'como está o tempo?', 'quantas centrais ativas em MS?']) {
    const d = executiva.decidir(percepcao.perceber(frase));
    assert.equal(d.rota, 'plano_local', `"${frase}" saiu do caminho local`);
    assert.equal(d.custo_estimado, 'zero');
  }
});

// ---------------------------------------------------------------------------
// 5. Permissões: agir no mundo em nome do operador
// ---------------------------------------------------------------------------

/**
 * `integracoes.ts` sempre afirmou que habilidades que alcançam terceiros não
 * são concedidas ao papel `operador`. Não era verdade: `enviar_whatsapp` pedia
 * `escrita`, e `escrita` é do operador. Estava latente só porque a habilidade
 * não tem token. Este teste é o que impede a prosa e o código de divergirem de
 * novo.
 */
test('operador não pode acionar habilidade que alcança terceiros', () => {
  const politica = new PoliticaPadrao();
  const sandbox = new SandboxPorPolitica(politica);

  assert.throws(
    () => sandbox.verificar('enviar_whatsapp', enviarWhatsapp.manifesto.permissoes, 'operador'),
    /externo/,
    'papel operador conseguiu enviar mensagem em nome do operador',
  );

  assert.doesNotThrow(() =>
    sandbox.verificar('enviar_whatsapp', enviarWhatsapp.manifesto.permissoes, 'administrador'),
  );
});

test('agente local continua disponível ao operador', () => {
  const sandbox = new SandboxPorPolitica(new PoliticaPadrao());
  for (const id of ['criar_pasta', 'abrir_aplicativo', 'acionar_energia', 'resolver_confirmacao']) {
    const m = CATALOGO.find((h) => h.manifesto.id === id)!.manifesto;
    assert.doesNotThrow(
      () => sandbox.verificar(id, m.permissoes, 'operador'),
      `operador perdeu acesso a ${id}`,
    );
  }
});

test('sem nuvem configurada, nenhuma rota promete tokens', () => {
  const executiva = decidirCom(false);
  const d = executiva.decidir(percepcao.perceber('elabore uma estratégia de redução de custo'));
  assert.equal(d.custo_estimado, 'zero');
  assert.equal(d.rota, 'raciocinio_direto');
});
