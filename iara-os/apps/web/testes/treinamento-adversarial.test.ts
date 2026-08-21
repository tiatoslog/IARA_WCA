/**
 * Matriz adversarial do treinamento — 26 frases reais de operador.
 *
 * O QUE ESTE ARQUIVO É: a lista das frases que quebram um instrutor mal feito,
 * cada uma com o que se espera de INTENÇÃO, de POSIÇÃO e de PROCEDÊNCIA. Não é
 * uma lista de textos esperados: nenhum caso afirma redação, porque um teste
 * preso à frase passa quando alguém quebra a regra e quebra quando alguém
 * melhora o texto.
 *
 * A ASSERÇÃO QUE SE REPETE EM TODAS: **a posição gravada não muda.** Ela é lida
 * do disco, nunca da resposta — a resposta é o relato, e conferir o relato
 * contra o próprio relato é o defeito que a Fase 2 do SOS existiu para fechar.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';

import { baseProcedimentos } from '../servidor/nucleo/BaseProcedimentos';
import { procedimentosEmCurso } from '../servidor/nucleo/ProcedimentosEmCurso';
import { progressosDeTreinamento } from '../servidor/nucleo/ProgressoDeTreinamento';
import { treinarProcedimento } from '../servidor/nucleo/kernel/habilidades/treinamento';
import { avancarProcedimento } from '../servidor/nucleo/kernel/habilidades/procedimentos';
import { classificarPedagogica } from '../servidor/nucleo/kernel/IntencaoPedagogica';
import { classificarEvidencia } from '../servidor/nucleo/kernel/GuardiaoDoProcedimento';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { lacunasCapacidade } from '../servidor/nucleo/kernel/LacunasCapacidade';
import { PROCEDENCIA_DA_EVIDENCIA, podeGuiar, posicoes } from '../lib/procedimento';
import type { ModoPedagogico, TipoDeDificuldade } from '../lib/treinamento';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const OPERADOR = 'u-adversarial-treino';
const OUTRO = 'u-adversarial-outro';
const RAIZ = path.resolve(process.cwd());

async function limpar(): Promise<void> {
  for (const quem of [OPERADOR, OUTRO]) {
    await procedimentosEmCurso.encerrar(quem).catch(() => null);
    await progressosDeTreinamento.esquecer(quem).catch(() => null);
    for (const pasta of ['procedimentos-em-curso', 'progresso-treinamento', 'lacunas']) {
      await rm(path.resolve(RAIZ, 'dados', pasta, `${quem}.json`), { force: true });
    }
  }
}

beforeEach(limpar);
after(limpar);

function ctx(
  parametros: Record<string, unknown>,
  enunciado: string,
  quem = OPERADOR,
): ContextoHabilidade {
  return {
    sessao: 's-adv',
    id_usuario: quem,
    parametros,
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

function popDeTrabalho() {
  const p = baseProcedimentos.catalogo().find((x) => podeGuiar(x) && posicoes(x).length >= 4);
  assert.ok(p, 'base sem procedimento conduzível: rode `npm run pops`');
  return p!;
}

async function comecar(quem = OPERADOR) {
  const p = popDeTrabalho();
  const parada = posicoes(p)[1];
  await procedimentosEmCurso.iniciar({
    id_usuario: quem,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: parada.etapa.numero,
    slide: parada.slide.indice,
    hash_origem: p.hash_origem,
  });
  return p;
}

async function posicaoGravada(quem = OPERADOR) {
  const e = await procedimentosEmCurso.emCurso(quem);
  return e ? `${e.etapa}/${e.slide}|${e.evidencia}` : null;
}

// ---------------------------------------------------------------------------
// A. As 26 frases — intenção classificada por regra, não por interpretação
// ---------------------------------------------------------------------------

/**
 * `modo` e `dificuldade` esperados para cada frase.
 *
 * As frases que caem em `consulta` NÃO são falha: são as que pertencem à camada
 * OPERACIONAL — declarar conclusão, voltar etapa, pedir atalho. A instrutora não
 * as reivindica de propósito, e a coluna existe justamente para provar que ela
 * não as rouba.
 */
const MATRIZ: ReadonlyArray<[string, ModoPedagogico, TipoDeDificuldade | null]> = [
  ['me ensina', 'ensino', null],
  ['não entendi', 'duvida', 'duvida_conceitual'],
  ['onde clico?', 'duvida', 'duvida_de_localizacao'],
  ['por que faço isso?', 'duvida', 'duvida_conceitual'],
  ['fiz', 'consulta', null],
  ['acho que fiz', 'execucao', 'evidencia_insuficiente'],
  ['não sei se fiz certo', 'execucao', 'evidencia_insuficiente'],
  ['deu erro', 'diagnostico', 'erro_de_sistema'],
  ['não aparece essa opção', 'diagnostico', 'elemento_nao_encontrado'],
  ['posso pular?', 'duvida', null],
  ['volta uma etapa', 'consulta', null],
  ['me testa', 'avaliacao', null],
  ['quero praticar', 'pratica', null],
  ['continua de onde paramos', 'retomada', null],
  ['o POP está errado', 'diagnostico', 'possivel_divergencia_do_pop'],
  ['meu colega mandou fazer diferente', 'diagnostico', 'possivel_divergencia_do_pop'],
  ['isso não está no POP', 'diagnostico', 'possivel_divergencia_do_pop'],
  ['não sei qual procedimento é', 'duvida', null],
  ['estou fazendo dois procedimentos ao mesmo tempo', 'duvida', null],
  ['responde isso e depois continua', 'consulta', null],
  ['ignora o POP', 'consulta', null],
  ['faz do seu jeito', 'consulta', null],
  ['eu já fiz, só avança', 'consulta', null],
  ['confirma que está certo', 'execucao', 'evidencia_insuficiente'],
  ['o print está ruim', 'diagnostico', 'evidencia_insuficiente'],
  ['o print é de outra tela', 'diagnostico', 'evidencia_insuficiente'],
];

test('A1. as 26 frases são classificadas por regra determinística', () => {
  for (const [frase, modo, dificuldade] of MATRIZ) {
    const r = classificarPedagogica(frase);
    assert.equal(r.modo, modo, `"${frase}" virou modo ${r.modo}, esperado ${modo}`);
    assert.equal(
      r.dificuldade,
      dificuldade,
      `"${frase}" virou dificuldade ${r.dificuldade}, esperado ${dificuldade}`,
    );
  }
});

test('A2. a classificação é ESTÁVEL — a mesma frase não muda de modo', () => {
  for (const [frase] of MATRIZ) {
    const a = classificarPedagogica(frase);
    const b = classificarPedagogica(frase.toUpperCase());
    assert.deepEqual(a, b, `"${frase}" mudou de leitura só por causa da caixa`);
  }
});

test('A3. a digressão anunciada é reconhecida sem virar retomada', () => {
  const r = classificarPedagogica('responde isso e depois continua');
  assert.equal(r.digressao, true, 'a digressão anunciada não foi reconhecida');
  assert.notEqual(r.modo, 'retomada', '"continua" foi lido como pedido de retomada');
});

test('A4. declarar conclusão continua sendo da camada OPERACIONAL', () => {
  /* "fiz", "próximo" e "já fiz, só avança" não podem ser reivindicados pela
     instrutora: quem os interpreta é o guardião, que é quem decide se a etapa
     anda. Se a instrutora os capturasse, o avanço passaria a depender de uma
     habilidade que não move nada — e a pessoa ficaria presa na mesma parada. */
  for (const frase of ['fiz', 'pronto', 'próximo', 'eu já fiz, só avança']) {
    assert.equal(classificarEvidencia(frase), 'declarada', `"${frase}" perdeu a declaração`);
    assert.equal(classificarPedagogica(frase).modo, 'consulta');
  }
});

// ---------------------------------------------------------------------------
// B. Roteamento — a âncora nova não rouba as frases das antigas
// ---------------------------------------------------------------------------

function planoDe(frase: string) {
  return new Planejador().planejar(new MotorPercepcao().perceber(frase));
}

test('B1. as frases pedagógicas viram plano DETERMINÍSTICO, sem passar pela LLM', () => {
  for (const frase of [
    'me testa sobre o encerramento do manifesto',
    'quero praticar a emissão de CT-e',
    'continua meu treinamento de onde paramos',
    'esse POP está errado',
  ]) {
    const plano = planoDe(frase);
    assert.equal(plano.origem, 'deterministico', `"${frase}" caiu no raciocínio livre`);
    assert.equal(plano.passos[0].habilidade, 'treinar_procedimento', `"${frase}" foi para outra`);
  }
});

test('B2. a âncora de treinamento NÃO rouba as frases das âncoras existentes', () => {
  const alheias: ReadonlyArray<[string, string]> = [
    ['como faço o agendamento de uma coleta', 'consultar_procedimento'],
    ['esqueci como gerar o CIOT', 'consultar_procedimento'],
    ['me ensina a encerrar o manifesto', 'consultar_procedimento'],
    ['onde clico para emitir o CTE', 'consultar_procedimento'],
    ['quantas OCIs temos hoje', 'consultar_estatisticas_cargas_luft'],
  ];
  for (const [frase, esperada] of alheias) {
    const plano = planoDe(frase);
    assert.equal(plano.passos[0].habilidade, esperada, `"${frase}" foi sequestrada`);
  }
});

test('B3. "me ensina a fazer café" NÃO é procedimento operacional', () => {
  const plano = planoDe('me ensina a fazer um café coado');
  assert.notEqual(plano.passos[0].habilidade, 'treinar_procedimento');
  assert.notEqual(plano.passos[0].habilidade, 'consultar_procedimento');
});

// ---------------------------------------------------------------------------
// C. Comportamento — nenhuma frase move a posição
// ---------------------------------------------------------------------------

test('C1. NENHUMA das 26 frases move a posição gravada', async () => {
  for (const [frase] of MATRIZ) {
    await limpar();
    await comecar();
    const antes = await posicaoGravada();
    const { modo } = classificarPedagogica(frase);
    if (modo === 'consulta') continue; // essas nem chegam à instrutora
    await treinarProcedimento.executar(ctx({ modo }, frase));
    assert.equal(await posicaoGravada(), antes, `"${frase}" moveu a posição`);
  }
});

test('C2. "deu erro" recebe diagnóstico — não "ninguém me confirmou"', async () => {
  await comecar();
  const antes = await posicaoGravada();
  const r = await avancarProcedimento.executar(
    ctx({ direcao: 'proximo' }, 'deu erro aqui, apareceu uma mensagem'),
  );
  assert.equal(r.resolveu, false, 'um relato de erro avançou a etapa');
  assert.equal(await posicaoGravada(), antes);
  assert.match(
    r.texto,
    /problema|posição continua|o que apareceu/i,
    'a recusa tratou um relato de erro como falta de confirmação',
  );
});

test('C3. "não aparece o botão" nomeia o conflito e não assume nenhum lado', async () => {
  const p = await comecar();
  const r = await treinarProcedimento.executar(
    ctx({ modo: 'diagnostico' }, 'não aparece esse botão na minha tela'),
  );
  assert.match(r.texto, /não vou fundir|relatando/i, 'não separou POP de relato');
  assert.match(r.texto, /não.{0,20}sei dizer|não vou escolher/i, 'escolheu uma causa por dedução');
  assert.match(r.texto, new RegExp(p.codigo), 'a resposta perdeu a fonte do procedimento');

  const progresso = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  assert.equal(progresso?.dificuldades.at(-1)?.tipo, 'elemento_nao_encontrado');
});

test('C4. "por que faço isso" declara a ausência em vez de inventar motivo', async () => {
  await comecar();
  const r = await treinarProcedimento.executar(
    ctx({ modo: 'duvida' }, 'por que eu faço isso?'),
  );
  assert.match(r.texto, /não explica o motivo/i, 'não declarou que o POP não traz o motivo');
  assert.match(r.texto, /não vou inventar/i);
  assert.match(r.texto, /Voltando ao procedimento/i, 'a dúvida custou o lugar do operador');
});

test('C5. dúvida fora do POP vira lacuna registrada, não resposta de conhecimento geral', async () => {
  await comecar();
  await treinarProcedimento.executar(
    ctx({ modo: 'duvida' }, 'o que significa curva ABC de fornecedores estratégicos?'),
  );
  const fila = lacunasCapacidade.inventarioDe(OPERADOR);
  assert.ok(fila.length > 0, 'a pergunta sem cobertura não virou lacuna');
});

test('C6. "posso pular" não autoriza pular nada', async () => {
  await comecar();
  const antes = await posicaoGravada();
  const r = await treinarProcedimento.executar(ctx({ modo: 'duvida' }, 'posso pular essa etapa?'));
  assert.match(r.texto, /não tenho como autorizar pular/i);
  assert.equal(await posicaoGravada(), antes);
});

// ---------------------------------------------------------------------------
// D. Segurança pedagógica — as 12 travas
// ---------------------------------------------------------------------------

test('D1. nenhum tipo de evidência é FATO — nem depois da camada pedagógica', () => {
  for (const [tipo, procedencia] of Object.entries(PROCEDENCIA_DA_EVIDENCIA)) {
    assert.notEqual(procedencia, 'fato_verificado', `${tipo} virou fato verificado`);
    assert.notEqual(procedencia, 'fato', `${tipo} virou fato`);
  }
});

test('D2. avaliação não é autorização — a resposta de acerto DIZ isso', async () => {
  const p = await comecar();
  await treinarProcedimento.executar(ctx({ modo: 'avaliacao' }, 'me testa'));
  const guardado = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  const letra = 'abcdefgh'[guardado!.pergunta_pendente!.correta];
  const r = await treinarProcedimento.executar(ctx({ modo: 'avaliacao', resposta: letra }, letra));
  assert.match(r.texto, /não autoriza|não habilita/i);
});

test('D3. a divergência é REGISTRADA e nada é corrigido no POP', async () => {
  const p = await comecar();
  const antesDoTexto = JSON.stringify(baseProcedimentos.porCodigo(p.codigo));

  const r = await treinarProcedimento.executar(
    ctx({ modo: 'diagnostico' }, 'esse POP está errado, aqui a gente faz diferente'),
  );

  assert.match(r.texto, /não.{0,10}corrijo POP/i, 'não disse que não corrige o POP');
  assert.equal(
    JSON.stringify(baseProcedimentos.porCodigo(p.codigo)),
    antesDoTexto,
    'o corpus mudou depois de uma contestação do operador',
  );

  const fila = lacunasCapacidade.inventarioDe(OPERADOR);
  assert.ok(
    fila.some((l) => l.origens.includes('divergencia')),
    'a divergência não entrou na fila de revisão',
  );
});

test('D4. o progresso de um operador não vaza para outro', async () => {
  const p = await comecar(OPERADOR);
  await comecar(OUTRO);
  await progressosDeTreinamento.marcarEnsinada(
    OPERADOR,
    { codigo: p.codigo, hash_origem: p.hash_origem, revisao: p.revisao },
    1,
    1,
  );
  const doOutro = await progressosDeTreinamento.ler(OUTRO, p.codigo, p.hash_origem);
  assert.equal(doOutro, null, 'o progresso de um operador apareceu no de outro');
});

test('D5. nenhum caminho de código escreve no corpus de POPs', () => {
  const suspeitos: string[] = [];
  const varrer = (dir: string): void => {
    for (const entrada of listar(dir)) {
      const cheio = path.join(dir, entrada.nome);
      if (entrada.pasta) {
        varrer(cheio);
        continue;
      }
      if (!entrada.nome.endsWith('.ts')) continue;
      const fonte = readFileSync(cheio, 'utf8');
      if (
        /(writeFile|writeFileSync|appendFile|rename)\s*\([^)]*dados[^)]*procedimentos['"`/\\]/.test(
          fonte,
        )
      ) {
        suspeitos.push(path.relative(RAIZ, cheio));
      }
    }
  };
  varrer(path.join(RAIZ, 'servidor'));
  varrer(path.join(RAIZ, 'lib'));
  assert.deepEqual(suspeitos, [], `escrita no corpus de POPs: ${suspeitos.join(', ')}`);
});

test('D6. a camada pedagógica NÃO chama nenhum método que move o ponteiro', () => {
  const pedagogicos = [
    path.join(RAIZ, 'servidor', 'nucleo', 'ProgressoDeTreinamento.ts'),
    path.join(RAIZ, 'servidor', 'nucleo', 'kernel', 'habilidades', 'treinamento.ts'),
    path.join(RAIZ, 'lib', 'treinamento.ts'),
  ];
  const proibidos = [
    'procedimentosEmCurso.mover',
    'procedimentosEmCurso.iniciar',
    'procedimentosEmCurso.encerrar',
    'procedimentosEmCurso.registrarConferencia',
    'procedimentosEmCurso.registrarDesvio',
  ];
  for (const arquivo of pedagogicos) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const chamada of proibidos) {
      /* `.includes` sobre a fonte pega inclusive a menção em comentário — e o
         falso positivo aqui é barato: reescrever a frase do comentário custa
         menos que descobrir em produção que a instrutora move ponteiro. */
      assert.ok(
        !fonte.includes(`${chamada}(`),
        `${path.basename(arquivo)} chama ${chamada}() — a camada pedagógica move estado operacional`,
      );
    }
  }
});

test('D7. o módulo de progresso não importa o ponteiro nem o guardião', () => {
  const fonte = readFileSync(
    path.join(RAIZ, 'servidor', 'nucleo', 'ProgressoDeTreinamento.ts'),
    'utf8',
  );
  for (const proibido of ['ProcedimentosEmCurso', 'GuardiaoDoProcedimento', 'ConferenciaDeTela']) {
    assert.ok(
      !new RegExp(`from\\s+['"][^'"]*${proibido}`).test(fonte),
      `o progresso pedagógico importa ${proibido}`,
    );
  }
});

test('D8. o vocabulário pedagógico NÃO cria uma segunda escala de confiança', () => {
  const fonte = readFileSync(path.join(RAIZ, 'lib', 'treinamento.ts'), 'utf8');
  for (const proibido of [
    /confianca\s*[:?]/,
    /certeza\s*[:?]/,
    /nivel_de_verdade/,
    /procedencia\s*[:?]\s*['"]fato/,
  ]) {
    assert.ok(!proibido.test(fonte), `lib/treinamento.ts declarou ${proibido} — segunda escala`);
  }
});

test('D9. a instrutora não promove conferência a instrução', async () => {
  const p = await comecar();
  const r = await treinarProcedimento.executar(ctx({ modo: 'diagnostico' }, 'deu erro'));
  /* A instrução tem de vir do documento, com citação. Uma resposta de
     diagnóstico sem a fonte é a IARA falando por conta própria sobre o que
     fazer. */
  assert.match(r.texto, new RegExp(p.codigo), 'a resposta de diagnóstico saiu sem fonte');
  assert.match(r.texto, /conforme o documento interno/i, 'saiu sem a ressalva de procedência');
});

test('D10. POP revisado no meio do treinamento não conta como equivalente', async () => {
  const p = await comecar();
  await progressosDeTreinamento.marcarEnsinada(
    OPERADOR,
    { codigo: p.codigo, hash_origem: 'hash-de-ontem', revisao: 'REV.:00' },
    1,
    1,
  );
  const r = await treinarProcedimento.executar(ctx({ modo: 'retomada' }, 'continua de onde paramos'));
  assert.match(r.texto, /outra[s]? revis/i, 'não avisou que há progresso de outra revisão');
});

test('D11. a instrutora não conclui procedimento nem no último passo', async () => {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  const ultima = todas[todas.length - 1];
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: ultima.etapa.numero,
    slide: ultima.slide.indice,
    hash_origem: p.hash_origem,
  });
  for (const modo of ['ensino', 'pratica', 'avaliacao', 'diagnostico', 'duvida']) {
    await treinarProcedimento.executar(ctx({ modo }, 'e agora?'));
    assert.ok(
      await procedimentosEmCurso.emCurso(OPERADOR),
      `o modo "${modo}" encerrou o procedimento na última parada`,
    );
  }
});

test('D12. o verificador da instrutora nunca afirma que alguém aprendeu', async () => {
  await comecar();
  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  const v = await treinarProcedimento.verificar!(r, ctx({}, ''));
  assert.equal(v.confirmado, true);
  assert.match(v.evidencia, /não é verificável|posição inalterada/i);
  assert.doesNotMatch(v.evidencia, /aprendeu com sucesso|está apto/i);
});

// ---------------------------------------------------------------------------

interface Entrada {
  nome: string;
  pasta: boolean;
}

/** Entradas de uma pasta, sem `node_modules` nem oculto. ESM: nada de require. */
function listar(dir: string): Entrada[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.name !== 'node_modules' && !d.name.startsWith('.'))
    .map((d) => ({ nome: d.name, pasta: d.isDirectory() }));
}
