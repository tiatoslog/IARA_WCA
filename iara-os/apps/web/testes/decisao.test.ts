/**
 * Testes da política de decisão — perguntar, agir ou responder.
 *
 * A tensão que esta suíte mede tem dois lados, e passar em um só não vale
 * nada:
 *
 *   perguntar o que o contexto responde  → assistente que não presta atenção
 *   adivinhar o que o contexto não diz   → assistente que erra alto
 *
 * Por isso todo teste de "deve perguntar" tem um irmão "não deve perguntar"
 * com o mesmo pedido e contexto diferente. É a diferença entre contexto e
 * confiança que está sendo verificada, não a frase.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { FuncaoExecutiva } from '../servidor/nucleo/kernel/FuncaoExecutiva';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { DetectorAmbiguidade, perguntaDe } from '../servidor/nucleo/kernel/Ambiguidade';
import { PoliticaRisco } from '../servidor/nucleo/kernel/PoliticaRisco';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';

const percepcao = new MotorPercepcao();
const planejador = new Planejador();
const detector = new DetectorAmbiguidade();

const TIME = ['João Silva', 'João Pereira', 'Marina Alves'];

function executiva(nuvem = true) {
  return new FuncaoExecutiva(planejador, new MemoriaTrabalho(), TIME, () => nuvem);
}

function decidir(frase: string, historico: string[] = [], pessoas = TIME) {
  return executiva().decidir(percepcao.perceber(frase), {
    historicoRecente: historico,
    pessoasConhecidas: pessoas,
  });
}

// ---------------------------------------------------------------------------
// 1. Destinatário ambíguo — o caso "manda pro João"
// ---------------------------------------------------------------------------

test('destinatário com dois candidatos → pergunta, e oferece os nomes', () => {
  const d = decidir('manda pro João');

  assert.equal(d.rota, 'esclarecer');
  assert.equal(d.acao, 'perguntar');
  assert.equal(d.custo_estimado, 'zero', 'perguntar não pode custar token');
  assert.equal(d.ambiguidade?.tipo, 'destinatario_multiplo');
  assert.match(d.pergunta!, /João Silva/);
  assert.match(d.pergunta!, /João Pereira/);
  assert.doesNotMatch(d.pergunta!, /Marina/, 'não oferece quem não casa');
});

test('a pergunta é fechada, nunca "pode esclarecer?"', () => {
  const d = decidir('manda pro João');
  assert.doesNotMatch(d.pergunta!, /esclarec|reformul|mais detalh|não entendi/i);
  assert.match(d.pergunta!, /\?$/);
});

test('destinatário único no time → não pergunta', () => {
  const d = decidir('manda pra Marina');
  assert.notEqual(d.rota, 'esclarecer', 'só existe uma Marina; perguntar seria ruído');
});

test('destinatário ausente numa ação de envio → pergunta para quem', () => {
  const d = decidir('encaminha isso');
  assert.equal(d.rota, 'esclarecer');
  assert.equal(d.ambiguidade?.tipo, 'destinatario_ausente');
});

test('nome desconhecido NÃO vira pergunta de esclarecimento', () => {
  // O operador nomeou alguém que a IARA não conhece. Isso é lacuna de dado,
  // não de intenção — vira falha honesta na execução, não interrogatório.
  const d = decidir('manda pro Ricardo');
  assert.notEqual(d.rota, 'esclarecer');
});

// ---------------------------------------------------------------------------
// 2. Referência anafórica — o caso "aquele relatório de ontem"
// ---------------------------------------------------------------------------

test('"aquele relatório" COM antecedente no histórico → não pergunta', () => {
  const d = decidir('faz aquele relatório de ontem de novo', [
    'preciso do relatório de frota do mês',
    'relatório gerado: 412 veículos ativos',
  ]);
  assert.notEqual(d.rota, 'esclarecer', 'o histórico responde; perguntar é não prestar atenção');
});

test('"aquele relatório" SEM antecedente no histórico → pergunta qual', () => {
  const d = decidir('faz aquele relatório de ontem de novo', [
    'bom dia',
    'tudo certo por aqui',
  ]);
  assert.equal(d.rota, 'esclarecer');
  assert.equal(d.ambiguidade?.tipo, 'referencia_sem_antecedente');
  assert.match(d.pergunta!, /relatorio|relatório/i);
});

test('sem histórico nenhum, referência anafórica pergunta', () => {
  const d = decidir('abre aquela planilha');
  assert.equal(d.rota, 'esclarecer');
});

test('o mesmo pedido muda de rota só por causa do contexto', () => {
  const frase = 'me manda aquele documento de novo';
  const semContexto = decidir(frase, ['oi', 'bom dia']);
  const comContexto = decidir(frase, ['segue o documento de homologação', 'obrigado']);

  assert.equal(semContexto.rota, 'esclarecer');
  assert.notEqual(comContexto.rota, 'esclarecer');
});

// ---------------------------------------------------------------------------
// 3. Não perguntar o que não é ambíguo
// ---------------------------------------------------------------------------

test('pedidos claros nunca caem em esclarecimento', () => {
  const claros = [
    'como está o tempo agora?',
    'que horas são?',
    'quantas centrais ativas em MT?',
    'crie uma pasta chamada Relatórios',
    'abra o bloco de notas',
    'pesquise o preço do diesel',
    'bom dia',
    'hoje foi cansativo',
  ];
  for (const frase of claros) {
    assert.notEqual(decidir(frase).rota, 'esclarecer', `"${frase}" virou pergunta sem motivo`);
  }
});

test('conversa casual não vira tarefa nem pergunta', () => {
  const d = decidir('hoje foi cansativo');
  assert.equal(d.acao, 'responder');
  assert.equal(d.rota, 'raciocinio_direto');
});

// ---------------------------------------------------------------------------
// 4. Ação cognitiva declarada
// ---------------------------------------------------------------------------

test('cada decisão nomeia a ação no vocabulário do domínio', () => {
  assert.equal(decidir('crie uma pasta chamada Notas').acao, 'executar');
  assert.equal(decidir('pesquise a nova lei do frete').acao, 'pesquisar');
  assert.equal(decidir('esse erro já aconteceu antes?').acao, 'recuperar_memoria');
  assert.equal(decidir('o que a Marina falou ontem?').acao, 'recusar');
  assert.equal(decidir('manda pro João').acao, 'perguntar');
});

test('sigilo continua vencendo tudo, inclusive ambiguidade', () => {
  // "manda pro João" seria pergunta; com sondagem junto, sigilo vem antes.
  const d = decidir('manda pro João o que a Marina falou ontem');
  assert.equal(d.rota, 'sigilo');
  assert.equal(d.acao, 'recusar');
});

// ---------------------------------------------------------------------------
// 5. Risco é ortogonal à confiança
// ---------------------------------------------------------------------------

test('confiança alta NÃO autoriza ação de risco alto sem confirmação', () => {
  const p = percepcao.perceber('desligue o computador');
  assert.ok(p.confianca >= 0.9, 'a IARA entendeu perfeitamente');

  const politica = new PoliticaRisco();
  assert.equal(
    politica.exigenciaDe('alto').confirmacaoPrevia,
    true,
    'entender bem é justamente o que torna a ação perigosa',
  );
  assert.equal(politica.exigenciaDe('baixo').confirmacaoPrevia, false);
});

test('risco médio dispensa confirmação mas exige verificação', () => {
  const e = new PoliticaRisco().exigenciaDe('medio');
  assert.equal(e.confirmacaoPrevia, false, 'pedir "confirma?" para criar pasta é burocracia');
  assert.equal(e.verificacaoPosterior, true);
  assert.equal(e.podeConcluirSemVerificar, false);
});

test('o risco de um plano é o do passo mais arriscado', () => {
  const politica = new PoliticaRisco();
  assert.equal(politica.riscoDoPlano(['baixo', 'baixo', 'alto']), 'alto');
  assert.equal(politica.riscoDoPlano(['baixo', 'medio']), 'medio');
  assert.equal(politica.riscoDoPlano(['baixo']), 'baixo');
});

test('o piso de confiança sobe com o risco', () => {
  const politica = new PoliticaRisco();
  assert.equal(politica.confiancaSuficiente('baixo', 0.6), true);
  assert.equal(politica.confiancaSuficiente('medio', 0.6), false);
  assert.equal(politica.confiancaSuficiente('alto', 0.87), false);
  assert.equal(politica.confiancaSuficiente('alto', 0.92), true);
});

test('a ação de energia do catálogo é de risco alto', () => {
  const energia = CATALOGO.find((h) => h.manifesto.id === 'acionar_energia')!;
  assert.equal(energia.manifesto.risco, 'alto');
});

// ---------------------------------------------------------------------------
// 6. Detector isolado
// ---------------------------------------------------------------------------

test('detector não inventa ambiguidade em frase sem alvo nem referência', () => {
  const r = detector.detectar('quantas centrais ativas temos?', {
    historicoRecente: [],
    pessoasConhecidas: TIME,
  });
  assert.deepEqual(r, []);
});

test('pergunta com um único candidato pede confirmação, não escolha', () => {
  const texto = perguntaDe({
    tipo: 'destinatario_multiplo',
    faltando: 'qual "joão"',
    candidatos: ['João Silva'],
  });
  assert.match(texto, /Confirma que é João Silva/);
});

// ---------------------------------------------------------------------------
// 7. Capability Router — habilidades sem âncora não podem ficar mudas
//
// Achado ao vivo em produção (14/08/2026): "Quantas cargas foram coletadas
// hoje na operação LUFT?" caía em `raciocinio_direto`, que NUNCA recebe o
// catálogo — a LLM respondia em texto sem a opção de chamar
// `consultar_estatisticas_cargas_luft`. `mereceDecomposicao` media só
// COMPLEXIDADE (vários verbos, frase longa); não perguntava "isto pode ser um
// pedido operacional?". Estes testes travam a correção: perguntas de fato
// (quantas/quantos/qual/quais) e comandos (tipo === 'comando') agora chegam a
// `plano_cognitivo`, onde `MotorRaciocinio.planejar()` de fato lista o
// catálogo — sem inventar nenhuma âncora nova nem citar nome de habilidade
// aqui (o teste verifica a ROTA, nunca qual skill a LLM escolheria).
// ---------------------------------------------------------------------------

test('pergunta curta de fato sobre dado operacional → plano_cognitivo, não raciocínio mudo', () => {
  const casos = [
    'Quantas cargas foram coletadas hoje na operação LUFT?',
    'Qual motorista tem mais cargas?',
    'Qual rota teve maior faturamento?',
    'Qual o total faturado?',
    'Quantas cargas o motorista LINO fez?',
  ];
  for (const frase of casos) {
    const d = decidir(frase);
    assert.equal(
      d.rota,
      'plano_cognitivo',
      `"${frase}" tem que oferecer o catálogo à LLM, não responder direto sem tentar nenhuma habilidade`,
    );
  }
});

test('comando imperativo sem âncora (ler emails, enviar whatsapp) → plano_cognitivo', () => {
  const casos = ['Leia meus emails recentes', 'Envie uma mensagem para o motorista'];
  for (const frase of casos) {
    const d = decidir(frase);
    assert.equal(d.rota, 'plano_cognitivo', `"${frase}" é comando — não pode virar bate-papo`);
  }
});

test('conversa casual continua em raciocínio direto, mesmo depois da correção', () => {
  // Regressão do teste da seção 3 ("conversa casual não vira tarefa nem
  // pergunta") — a correção do gate não pode transformar toda frase em
  // plano_cognitivo, só as que parecem pedido de fato ou comando.
  const casos = ['Oi', 'Conte uma curiosidade', 'Como você está?', 'Explique o que é logística'];
  for (const frase of casos) {
    const d = decidir(frase);
    assert.equal(
      d.rota,
      'raciocinio_direto',
      `"${frase}" é bate-papo — pagar planejamento aqui é custo sem propósito`,
    );
  }
});

test('âncoras determinísticas continuam vencendo antes do capability router (rota plano_local preservada)', () => {
  // As 21 habilidades com âncora não podem regredir para plano_cognitivo —
  // o caminho de ~5ms e custo zero tem que continuar sendo o primeiro a
  // vencer quando existe.
  assert.equal(decidir('vai chover hoje?').rota, 'plano_local');
  assert.equal(decidir('crie uma pasta chamada Notas').rota, 'plano_local');
  assert.equal(decidir('faça um diagnóstico do sistema').rota, 'plano_local');
});
