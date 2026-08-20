/**
 * A CAMADA ANALÍTICA DENTRO DO KERNEL REAL — a bateria contra o teatro.
 *
 * O QUE ESTA BATERIA TEM DE PROVAR, e não é "os módulos passam":
 *
 *   habilidade emite evidência tipada → o kernel a coleta → a crítica roda →
 *   e o resultado MUDA A RESPOSTA QUE SAI.
 *
 * `testes/critica-analitica.test.ts` prova que `criticar()` funciona.
 * `testes/holdout/` prova que ela decide certo. Nenhum dos dois prova que ela
 * está LIGADA — e um motor de crítica perfeito que ninguém chama é exatamente o
 * "feature theater" que esta casa já viu: arquivo criado, classe criada, teste
 * unitário passando, e o comportamento em produção idêntico ao de antes.
 *
 * Por isso as asserções aqui olham para o que SAI: o texto de
 * `TAREFA_CONCLUIDA`, quantas vezes a síntese foi chamada, o que o kernel
 * mandou como autoridade de sistema, e a linha de auditoria.
 *
 * As três últimas entraram DEPOIS, cada uma fechando um buraco que a auditoria
 * independente achou por mutação: a instrução ao redator, o rodapé completo e a
 * trilha podiam ser apagados sem que um teste reclamasse. Este cabeçalho já
 * afirmou que a linha de auditoria era verificada quando ela não era — o
 * mesmo modo de falhar que a camada inteira existe para combater, cometido
 * dentro do próprio teste.
 *
 * O DUBLÊ DO RACIOCÍNIO É COOPERATIVO DE PROPÓSITO — ele sempre devolve uma
 * síntese fluente e afirmativa. É assim que se mede uma trava: dando ao modelo
 * toda a chance de mentir e conferindo se o código o impediu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { TETOS_PADRAO } from '../servidor/nucleo/kernel/OrcamentoDoTurno';
import { medirCobertura } from '../servidor/nucleo/kernel/Cobertura';
import { linhaDeAuditoria, montarDossie } from '../servidor/nucleo/kernel/DossieAnalitico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Evidencia } from '../servidor/nucleo/kernel/Investigacao';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import type { Plano } from '../servidor/nucleo/kernel/Evento';

const PEDIDO = 'analise a margem da operação e depois compare com o ano passado';

function memoriaVazia(): MemoriaOperacional {
  return {
    registrar: async () => undefined,
    historico: async () => [],
    insightsPendentes: async () => [],
    consumirInsight: async () => undefined,
    gravarInsight: async () => undefined,
    consolidar: async () => undefined,
    carregarGlobal: async () => '',
  } as unknown as MemoriaOperacional;
}

/** Habilidade de laboratório que declara evidência tipada, como a da margem. */
function habilidadeComEvidencia(evidencias: readonly Evidencia[], texto = 'a margem foi 31,4%') {
  const habilidade: Habilidade = {
    manifesto: {
      id: 'lab.medir',
      nome: 'lab.medir',
      descricao: 'mede uma métrica de laboratório e declara a cobertura dela',
      dominio: 'operacoes',
      capacidade: 'conhecimento',
      permissoes: ['banco'],
      timeout_ms: 30_000,
      custo: 'zero',
      risco: 'baixo',
      idempotencia: 'leitura',
      esquema: {},
    },
    async executar() {
      return { texto, detalhe: 'lab', resolveu: true, evidencias };
    },
  };
  return habilidade;
}

const passoDeMedida: Plano = {
  objetivo: 'lab',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'medir', habilidade: 'lab.medir', parametros: {} }],
};

const terminou: Plano = {
  objetivo: 'lab',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'responder', habilidade: null, parametros: {} }],
};

const SINTESE_CONFIANTE =
  'A margem da operação foi 31,4%. Está tudo sob controle e pode levar esse número para a diretoria.';

function montar(habilidade: Habilidade) {
  const barramento = new BarramentoEventos('s-analitica');
  const concluidas: string[] = [];
  const trechos: string[] = [];
  let sinteses = 0;
  /** O que o kernel mandou como autoridade de sistema, turno a turno. */
  const personas: string[] = [];

  barramento.assinar('TAREFA_CONCLUIDA', (e) => concluidas.push(e.texto));
  barramento.assinar('RESPOSTA_TRECHO', (e) => trechos.push(e.texto));

  let volta = 0;
  const kernel = new Kernel({
    sessao: 's-analitica',
    idUsuario: 'u-analitica',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaVazia(),
    barramento,
    habilidadesExtras: [habilidade],
    tetosOrcamento: { ...TETOS_PADRAO },
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar() {
        volta += 1;
        return volta === 1 ? passoDeMedida : terminou;
      },
      /* COOPERATIVO: sempre entrega a frase mais afirmativa possível. Se a
         ressalva aparecer na resposta, ela não veio daqui. */
      /**
       * O DUBLÊ AGORA **LÊ** `overridePersona`.
       *
       * A varredura de mutação da auditoria independente mostrou que anular
       * `instrucaoDoDegrau` inteira não reprovava um único teste: o conserto que
       * deveria impedir a resposta de nascer se contradizendo embarcou com
       * cobertura ZERO, porque o dublê devolvia string fixa e ignorava o pedido.
       * Um dublê que não olha o que recebe não consegue provar nada sobre o que
       * foi mandado.
       */
      async responder(p: {
        aoReceberTexto: (t: string) => void;
        overridePersona?: string;
      }) {
        sinteses += 1;
        personas.push(p.overridePersona ?? '');
        p.aoReceberTexto(SINTESE_CONFIANTE);
        return { texto: SINTESE_CONFIANTE, tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  return { kernel, concluidas, trechos, personas, sinteses: () => sinteses };
}

const evidencia = (p: Partial<Evidencia> & { metrica: string }): Evidencia => ({
  fonte: 'planilha_lab',
  valor: 31.4,
  unidade: '%',
  procedencia: 'fato',
  relevancia: 'direta',
  instante: new Date().toISOString(),
  ...p,
});

// ===========================================================================
// 1. A camada ENGATA — e muda o texto que sai
// ===========================================================================

test('1.1 cobertura parcial vira ressalva NA RESPOSTA, mesmo com síntese afirmativa', async () => {
  const { kernel, concluidas, sinteses } = montar(
    habilidadeComEvidencia([
      evidencia({
        metrica: 'margem_bruta_pct',
        cobertura: medirCobertura({
          elegiveis: 4064,
          consideradas: 3579,
          motivo_ausencia: '39 rotas sem preço de trecho',
          recorte: [{ dimensao: 'ano', valor: '2024' }],
        }),
      }),
    ]),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(concluidas.length, 1, 'um turno, uma resposta');
  const resposta = concluidas[0];

  /* A síntese do dublê ENTRA — a camada não engole a resposta. */
  assert.ok(resposta.includes('31,4%'), 'o número apurado tem de continuar na resposta');
  /* E a ressalva entra JUNTO, sem o modelo ter colaborado. */
  assert.ok(
    resposta.length > SINTESE_CONFIANTE.length,
    'a resposta final tem de ser maior que a síntese: o rodapé foi concatenado por código',
  );
  assert.match(resposta, /3579 de 4064/, 'a cobertura medida tem de sair com o número');
  assert.equal(sinteses(), 1, 'a camada não pode custar uma chamada de modelo a mais');
});

test('1.2 sem evidência tipada, o turno sai IDÊNTICO ao de antes da camada', async () => {
  /**
   * O PORTÃO. `criticar([])` devolve degrau `nenhum`, que é a resposta certa
   * para "não apurei nada" e catastrófica para um turno comum. Se a camada
   * engajasse sem evidência, a IARA se absteria de dizer bom dia.
   */
  const semEvidencia: Habilidade = {
    manifesto: {
      id: 'lab.medir',
      nome: 'lab.medir',
      descricao: 'faz alguma coisa e não declara evidência nenhuma',
      dominio: 'operacoes',
      capacidade: 'conhecimento',
      permissoes: ['banco'],
      timeout_ms: 30_000,
      custo: 'zero',
      risco: 'baixo',
      idempotencia: 'leitura',
      esquema: {},
    },
    async executar() {
      return { texto: 'fiz o que foi pedido', detalhe: 'lab', resolveu: true };
    },
  };

  const { kernel, concluidas } = montar(semEvidencia);
  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(concluidas.length, 1);
  assert.equal(
    concluidas[0],
    SINTESE_CONFIANTE,
    'sem evidência tipada a resposta tem de ser exatamente a síntese — nem rodapé, nem abstenção',
  );
});

// ===========================================================================
// 2. A ABSTENÇÃO NÃO PASSA PELA LLM
// ===========================================================================

test('2.1 ausência apresentada como zero encerra o turno ANTES da síntese', async () => {
  /**
   * A DIFERENÇA ENTRE TRAVA E INSTRUÇÃO, medida.
   *
   * O dublê está pronto para escrever "está tudo sob controle". Se a resposta
   * contiver essa frase, a defesa era um pedido no prompt e o modelo o ignorou —
   * que foi o 56% medido em 17/08/2026. `sinteses() === 0` é a prova de que ele
   * nem chegou a ser consultado.
   */
  const { kernel, concluidas, sinteses } = montar(
    habilidadeComEvidencia(
      [
        evidencia({
          metrica: 'cargas_atrasadas',
          valor: 0,
          unidade: '',
          cobertura: medirCobertura({
            elegiveis: 30,
            consideradas: 0,
            motivo_ausencia: 'sem data de entrega lançada',
          }),
        }),
      ],
      'nenhuma carga atrasada encontrada',
    ),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 0, 'a abstenção não pode custar uma chamada de modelo');
  assert.equal(concluidas.length, 1, 'abster não é ficar mudo');
  const resposta = concluidas[0];
  assert.ok(
    !resposta.includes('sob controle'),
    'a frase confiante do modelo não pode ter alcançado o operador',
  );
  assert.match(resposta, /não tenho evidência suficiente/i);
  assert.match(resposta, /O que destravaria/, 'abster sem dizer o que falta é meia resposta');
  /* O que a habilidade RELATOU continua saindo: a abstenção nega a conclusão,
     não a existência do que foi lido. */
  assert.ok(resposta.includes('nenhuma carga atrasada encontrada'));
});

test('2.2 fontes discordando também encerra antes da síntese', async () => {
  const { kernel, concluidas, sinteses } = montar(
    habilidadeComEvidencia([
      evidencia({ metrica: 'motoristas', valor: 73, unidade: '', fonte: 'planilha_lab' }),
      evidencia({ metrica: 'motoristas', valor: 75, unidade: '', fonte: 'memoria_do_turno' }),
    ]),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 0);
  assert.match(concluidas[0], /discordam/i, 'o operador tem de saber que há duas versões');
});

// ===========================================================================
// 3. O que a camada NÃO pode quebrar
// ===========================================================================

test('2.3 evidência só de CONTEXTO não abstém — o falso positivo do portão', async () => {
  /**
   * O DEFEITO, achado pela auditoria independente (19/08/2026).
   *
   * `criticar` recusa, com razão, um conjunto só de `contextual`: contexto não
   * sustenta conclusão. Mas o portão do Kernel contava QUALQUER evidência, e a
   * combinação produzia o pior desfecho possível — uma habilidade que emitisse
   * só contexto num turno de COMANDO fazia o kernel abster-se. O efeito
   * acontecia no mundo e o operador recebia "não tenho evidência suficiente
   * para concluir".
   *
   * Este é o par que faltava: as duas peças estão certas isoladamente e
   * erravam juntas.
   */
  const { kernel, concluidas, sinteses } = montar(
    habilidadeComEvidencia(
      [
        evidencia({
          metrica: 'pasta_alvo',
          valor: 'C:/cargas',
          unidade: '',
          relevancia: 'contextual',
        }),
      ],
      'pasta apagada',
    ),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 1, 'a síntese TEM de rodar: não há nada a abster');
  assert.equal(
    concluidas[0],
    SINTESE_CONFIANTE,
    'turno sem evidência direta não é turno analítico — sai como sempre saiu',
  );
});

// ===========================================================================
// 4. O TETO CHEGA AO REDATOR — e só promete o que vai cumprir
// ===========================================================================

test('4.1 o degrau vai ao prompt da síntese, não só ao rodapé', async () => {
  /**
   * Sem esta asserção, `instrucaoDoDegrau` podia ser anulada inteira sem que
   * nenhum teste reclamasse — foi o que a varredura de mutação da auditoria
   * independente mediu. A LLM redigia às cegas e o código grampeava a
   * contestação embaixo, produzindo resposta que se contradiz dentro de si.
   */
  const { kernel, personas } = montar(
    habilidadeComEvidencia([
      evidencia({
        metrica: 'margem_bruta_pct',
        cobertura: medirCobertura({
          elegiveis: 4064,
          consideradas: 3579,
          recorte: [{ dimensao: 'ano', valor: '2024' }],
        }),
      }),
    ]),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(personas.length, 1);
  const persona = personas[0];
  assert.match(
    persona,
    /ressalva/i,
    'o redator tem de saber que uma ressalva vai ser acrescentada',
  );
  assert.match(
    persona,
    /REGISTROS QUE FORAM APURADOS|conjunto todo/i,
    'o degrau `descritiva` tem de virar instrução concreta, não jargão',
  );
});

test('4.2 no caso limpo a instrução NÃO promete ressalva que não vem', async () => {
  /**
   * O simétrico de 4.1, e o defeito que a segunda passada achou: o bloco de
   * abertura era incondicional e anunciava a ressalva mesmo quando
   * `rodapeDoDossie` devolve vazio. Um modelo cooperativo escreve "conforme a
   * ressalva abaixo" atrás de nada — a mesma auto-contradição que a instrução
   * existe para eliminar, com o sinal trocado.
   */
  const cobertura = medirCobertura({
    elegiveis: 412,
    consideradas: 412,
    recorte: [{ dimensao: 'mes', valor: '2026-08' }],
  });
  const { kernel, personas, concluidas } = montar(
    habilidadeComEvidencia([
      evidencia({ metrica: 'cargas', valor: 412, unidade: '', procedencia: 'fato_verificado', cobertura }),
      evidencia({ metrica: 'receita', valor: 733000, unidade: 'R$', fonte: 'tabela_lab', cobertura }),
      evidencia({ metrica: 'motoristas', valor: 41, unidade: '', fonte: 'cadastro_lab', cobertura }),
    ]),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(concluidas[0], SINTESE_CONFIANTE, 'nada a ressalvar → nada acrescentado');
  assert.equal(
    /ressalva/i.test(personas[0]),
    false,
    'sem rodapé, a instrução não pode prometer rodapé',
  );
});

test('4.3 o rodapé entrega as TRÊS partes — limitações e confiança inclusas', async () => {
  /**
   * A varredura de mutação da terceira passada mostrou que `rodapeDoDossie` tem
   * três partes e **duas delas podiam sumir sem nenhum teste reclamar**:
   * "Ficou de fora: …" e a linha de confiança. São, respectivamente, o que
   * declara o que não foi olhado e o que diz o quanto dá para confiar — o canal
   * inteiro da camada para o operador, apagável em silêncio.
   */
  const { kernel, concluidas } = montar(
    habilidadeComEvidencia([
      evidencia({
        metrica: 'margem_bruta_pct',
        cobertura: medirCobertura({
          elegiveis: 4064,
          consideradas: 3579,
          motivo_ausencia: '39 rotas sem preço de trecho',
          recorte: [{ dimensao: 'ano', valor: '2024' }],
        }),
      }),
    ]),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');
  const resposta = concluidas[0];

  assert.match(resposta, /3579 de 4064/, 'parte 1 — a ressalva de cobertura');
  assert.match(resposta, /Ficou de fora/, 'parte 2 — o que nem chegou a ser olhado');
  assert.match(resposta, /sem preço de trecho/, 'e o motivo, não só a contagem');
  assert.match(resposta, /Confian[çc]a m[ée]dia/i, 'parte 3 — o quanto dá para confiar');
  assert.match(resposta, /pesou contra/i, 'e por quê — senão a confiança é um rótulo');
});

test('4.4 a linha de auditoria carrega as ressalvas e a cobertura medida', async () => {
  /**
   * O cabeçalho deste arquivo afirmava, desde a primeira versão, que as
   * asserções olham "o texto de `TAREFA_CONCLUIDA`, a quantidade de vezes que a
   * síntese foi chamada, e a linha de auditoria". As duas primeiras eram
   * verdade; a terceira não existia — `linhaDeAuditoria` podia gravar
   * `ressalvas: []` sem sinal, e é o único canal da camada para a trilha.
   *
   * Comentário que afirma mais que o código ao lado é o modo de falhar que esta
   * sessão já corrigiu três vezes. Aqui ele vira asserção em vez de sumir.
   */
  const cobertura = medirCobertura({
    elegiveis: 4064,
    consideradas: 3579,
    recorte: [{ dimensao: 'ano', valor: '2024' }],
  });
  const dossie = montarDossie({
    analise_id: 'auditoria-kernel',
    pergunta: 'qual foi a margem da operação em 2024?',
    evidencias: [evidencia({ metrica: 'margem_bruta_pct', cobertura })],
    ferramentas: ['lab.medir'],
    agora: '2026-08-19T18:00:00.000Z',
  });

  const linha = JSON.parse(linhaDeAuditoria(dossie));
  assert.ok(
    linha.ressalvas.some((r: { codigo: string }) => r.codigo === 'cobertura_parcial'),
    'a trilha tem de guardar QUAIS contestações dispararam',
  );
  assert.equal(linha.evidencias[0].consideradas, 3579, 'e sobre quantos registros');
  assert.equal(linha.evidencias[0].elegiveis, 4064);
  assert.equal(linha.degrau_sustentado, 'descritiva');
  assert.equal(linha.veredicto, 'concluir_com_ressalva');
});

test('3.1 evidência limpa e completa não ganha rodapé nenhum', async () => {
  /* SE ESTE TESTE FALHAR, o motor virou alarme permanente: uma ressalva que
     aparece em toda resposta deixa de ser lida, inclusive quando importa. */
  const cobertura = medirCobertura({
    elegiveis: 412,
    consideradas: 412,
    recorte: [{ dimensao: 'mes', valor: '2026-08' }],
  });
  const { kernel, concluidas } = montar(
    habilidadeComEvidencia([
      evidencia({ metrica: 'cargas', valor: 412, unidade: '', procedencia: 'fato_verificado', cobertura }),
      evidencia({ metrica: 'receita', valor: 733000, unidade: 'R$', fonte: 'tabela_lab', cobertura }),
      evidencia({ metrica: 'motoristas', valor: 41, unidade: '', fonte: 'cadastro_lab', cobertura }),
    ]),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');
  assert.equal(concluidas[0], SINTESE_CONFIANTE, 'nada a ressalvar → nada acrescentado');
});
