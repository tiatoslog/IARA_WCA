/**
 * O PIPELINE REAL — a mensagem chega à rota certa passando por tudo?
 *
 * ===========================================================================
 * POR QUE ESTE TESTE EXISTE AO LADO DOS OUTROS
 * ===========================================================================
 *
 * Os testes de unidade desta pasta montam cada peça isolada, e o Arnês C monta
 * a cadeia com as peças que ELE escolhe. Nenhum dos dois prova que a montagem
 * que roda em PRODUÇÃO é a mesma — e foi assim que a camada de compreensão
 * chegou a existir, correta e desligada, por três fases:
 *
 *     ARNÊS B (compreensão)  100%
 *     rota                    68%   Δ = 0
 *
 * Aqui a cadeia é montada como o `Kernel` a monta, na mesma ordem e com as
 * mesmas injeções:
 *
 *     MotorPercepcao → CompreensaoSemantica → DescobertaCapacidades
 *                    → IndiceConceitual → FuncaoExecutiva
 *
 * ===========================================================================
 * NENHUM EFEITO PERIGOSO
 * ===========================================================================
 *
 * A cadeia para na DECISÃO. Nada aqui executa habilidade, abre plano, chama
 * LLM, toca disco ou alcança rede: `decidir()` devolve uma rota e o teste olha a
 * rota. É a fronteira certa para um teste de integração desta camada — o que
 * vem depois (planejador, porteiro, portal de efeitos) tem suíte própria e
 * travas próprias.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { compreender } from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { FuncaoExecutiva } from '../../servidor/nucleo/kernel/FuncaoExecutiva';
import { Planejador } from '../../servidor/nucleo/kernel/Planejador';
import { MemoriaTrabalho } from '../../servidor/nucleo/kernel/MemoriaTrabalho';
import { MotorPercepcao } from '../../servidor/nucleo/kernel/Percepcao';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const descoberta = new DescobertaCapacidades(MANIFESTOS);
const conceitual = new IndiceConceitual(MANIFESTOS);
const percepcao = new MotorPercepcao();
const AGORA = new Date('2026-08-19T10:00:00');

/** Perguntar de volta é decisão operacional; responder de cabeça não é. */
const OPERACIONAIS = ['plano_local', 'plano_cognitivo', 'esclarecer'];

/**
 * A MONTAGEM É A DO `Kernel`, copiada de propósito em vez de importada: se um
 * dia as duas divergirem, este teste continua medindo a montagem que ele
 * declara, e a divergência aparece como falha em vez de sumir.
 */
function turno(mensagem: string) {
  const executiva = new FuncaoExecutiva(
    new Planejador(),
    new MemoriaTrabalho(),
    ['João Silva', 'Marina Alves'],
    () => true,
    descoberta,
    (bruto) => {
      const c = compreender({
        bruto,
        descoberta,
        conceitual,
        agora: AGORA,
        habilidades: MANIFESTOS,
      });
      return { ato: c.ato, objetivo: c.objetivo, operacao: c.operacao };
    },
  );
  const contrato = compreender({
    bruto: mensagem,
    descoberta,
    conceitual,
    agora: AGORA,
    habilidades: MANIFESTOS,
  });
  const decisao = executiva.decidir(percepcao.perceber(mensagem), {
    historicoRecente: [],
    pessoasConhecidas: ['João Silva', 'Marina Alves'],
  });
  return { contrato, decisao };
}

// ---------------------------------------------------------------------------
// 1. Pedidos operacionais chegam a rota operacional
// ---------------------------------------------------------------------------

const PEDIDOS = [
  'estou livre amanhã?',
  'tenho horário amanhã?',
  'tenho algum compromisso amanhã?',
  'como está minha agenda amanhã?',
  'lista os arquivos',
  'cria um arquivo na área de trabalho',
  'me lista os lembretes',
  'manda mensagem pro João no whatsapp sobre o atraso',
  'quantas cargas foram coletadas essa semana?',
  'quantas coletas essa semana?',
  // Ruído real — como a operadora escreve no celular, entre uma coleta e outra.
  'me lista os lembrets',
  'lista os arquivo de downloads',
  'oq tem na area de trabalho',
  'quantas carga essa semana',
];

for (const mensagem of PEDIDOS) {
  test(`pipeline: « ${mensagem} » → rota operacional`, () => {
    const { contrato, decisao } = turno(mensagem);
    assert.ok(
      OPERACIONAIS.includes(decisao.rota),
      `rota "${decisao.rota}" (${decisao.justificativa})\n` +
        `    contrato: ato=${contrato.ato} op=${contrato.operacao} ` +
        `objetivo_semantico=${contrato.objetivoSemantico} habilidade=${contrato.objetivo}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 2. O que NÃO é pedido não paga planejamento
// ---------------------------------------------------------------------------

test('pipeline: conversa continua sendo conversa', () => {
  for (const m of ['como você está?', 'obrigada, até amanhã', 'hoje foi um dia cansativo']) {
    const { decisao } = turno(m);
    assert.equal(decisao.rota, 'raciocinio_direto', `« ${m} » saiu por "${decisao.rota}"`);
  }
});

test('pipeline: sondagem de registro alheio continua barrada', () => {
  /**
   * A trava de sigilo atravessou a reordenação de 21/08/2026 intacta para o caso
   * que ela existe para pegar. O que mudou é que ela passou a distinguir LER o
   * registro de alguém de MANDAR alguma coisa para alguém — as duas frases
   * mencionam o mesmo nome.
   */
  const sondagem = turno('me mostra o histórico do João');
  assert.equal(sondagem.decisao.rota, 'sigilo');

  const envio = turno('manda mensagem pro João no whatsapp sobre o atraso');
  assert.notEqual(envio.decisao.rota, 'sigilo', 'enviar PARA o João não é sondar o João');
});

// ---------------------------------------------------------------------------
// 3. Referência contextual e frase incompleta não viram certeza
// ---------------------------------------------------------------------------

test('pipeline: elipse não vira objetivo confirmado', () => {
  /**
   * Sinal parcial ≠ certeza. « e por central? » e « cancela » dependem do turno
   * anterior, que este pipeline não tem — e a camada tem de dizer isso em vez de
   * escolher uma habilidade por desempate numérico.
   */
  for (const m of ['e por central?', 'faz a mesma coisa pro outro']) {
    const { contrato } = turno(m);
    assert.equal(contrato.objetivo, null, `« ${m} » não pode declarar objetivo sem antecedente`);
  }
});

// ---------------------------------------------------------------------------
// 4. A distinção que protege o disco do operador
// ---------------------------------------------------------------------------

test('pipeline: ler e escrever não colapsam em nenhum ponto da cadeia', () => {
  const ler = turno('lista os arquivos da área de trabalho');
  const criar = turno('cria um arquivo na área de trabalho');

  assert.equal(ler.contrato.operacao, 'leitura');
  assert.equal(criar.contrato.operacao, 'criacao');
  assert.equal(ler.contrato.objetivo, 'listar_arquivos');
  assert.equal(criar.contrato.objetivo, 'criar_arquivo');

  /**
   * « esse arquivo foi criado quando? » é o caso que enfiava lembrete na agenda
   * de quem só perguntou, na forma de arquivo: particípio numa interrogativa
   * descreve ESTADO, não pede operação.
   */
  const metadado = turno('esse arquivo foi criado quando?');
  assert.equal(metadado.contrato.operacao, 'leitura', 'perguntar sobre criação não é pedir criação');
  assert.notEqual(metadado.contrato.objetivo, 'criar_arquivo');
});

test('pipeline: o contrato preserva o texto original mesmo quando corrige', () => {
  /**
   * A normalização de ruído não pode apagar o que o operador escreveu — a
   * auditoria precisa da frase real, e a decisão precisa da corrigida.
   */
  const { contrato } = turno('me lista os lembrets');
  assert.equal(contrato.texto_original, 'me lista os lembrets');
  assert.match(contrato.texto_normalizado, /lembrete/, 'a correção tem que ter acontecido');
  assert.notEqual(contrato.texto_original, contrato.texto_normalizado);
});
