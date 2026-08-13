/**
 * A CAMADA ANALÍTICA — evidência, hipótese, plano, veredito.
 *
 * O que estes testes protegem não é aritmética: é a distinção do §4. Uma IARA
 * que confunde o que MEDIU com o que SUPÔS erra de um jeito particularmente
 * caro, porque erra com segurança — e a pessoa do outro lado age sobre um
 * diagnóstico que soava apurado.
 *
 * Por isso os casos mais importantes daqui não são os que confirmam uma
 * hipótese, e sim os que a REBAIXAM: memória alta sem processo grande, máquina
 * saturada sem dono, expectativa que não pôde ser medida de novo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  avaliarResultado,
  criarHipotese,
  ehConclusivo,
  enunciarHipotese,
  ordenarHipoteses,
  pontuarPlano,
  recomendar,
  riscoDoPlano,
  type Evidencia,
  type PlanoDeAcao,
} from '../servidor/nucleo/kernel/Investigacao';
import {
  FAIXAS,
  anomaliasDe,
  confrontar,
  diagnosticarLentidao,
  evidenciasDe,
  investigarLentidao,
  planosParaLentidao,
  redigirInvestigacao,
} from '../servidor/nucleo/kernel/MotorAnalise';
import { interpretarMedicao, interpretarProcessos, type Medicao } from '../servidor/nucleo/SondasDesempenho';
import { aplicativoFechavelDoProcesso } from '../servidor/nucleo/AgenteLocal';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';

// ---------------------------------------------------------------------------
// Fábrica de medições
// ---------------------------------------------------------------------------

const INSTANTE = '2026-08-13T12:00:00.000Z';

function medicao(parcial: Partial<Medicao> = {}): Medicao {
  return {
    instante: INSTANTE,
    cpu_pct: 20,
    memoria_pct: 50,
    memoria_total_gb: 16,
    memoria_livre_gb: 8,
    disco_livre_pct: 40,
    disco_livre_gb: 200,
    ligado_ha_h: 3,
    nucleos: 8,
    processos: [],
    lacunas: [],
    ...parcial,
  };
}

const evidencia = (parcial: Partial<Evidencia> = {}): Evidencia => ({
  metrica: 'cpu_total',
  fonte: 'sonda_desempenho',
  valor: 90,
  unidade: '%',
  procedencia: 'fato',
  relevancia: 'direta',
  instante: INSTANTE,
  ...parcial,
});

// ---------------------------------------------------------------------------
// 1. Confiança é calculada, nunca afirmada
// ---------------------------------------------------------------------------

test('hipótese sem medição nenhuma é baixa, mesmo com muita sustentação', () => {
  const h = criarHipotese({
    enunciado: 'algo está errado',
    sustentada_por: [
      evidencia({ procedencia: 'inferencia' }),
      evidencia({ metrica: 'memoria_uso', procedencia: 'hipotese' }),
      evidencia({ metrica: 'disco_livre', procedencia: 'inferencia' }),
    ],
  });
  assert.equal(h.confianca, 'baixa');
});

test('alta exige DUAS medições de métricas distintas; uma só dá média', () => {
  const uma = criarHipotese({ enunciado: 'x', sustentada_por: [evidencia()] });
  assert.equal(uma.confianca, 'media');

  const duas = criarHipotese({
    enunciado: 'x',
    sustentada_por: [evidencia(), evidencia({ metrica: 'processo_cpu' })],
  });
  assert.equal(duas.confianca, 'alta');

  // Duas leituras da MESMA métrica não são dois pontos independentes.
  const repetida = criarHipotese({
    enunciado: 'x',
    sustentada_por: [evidencia(), evidencia({ valor: 91 })],
  });
  assert.equal(repetida.confianca, 'media');
});

test('cada evidência contrária rebaixa um nível; duas vão direto para baixa', () => {
  const base = [evidencia(), evidencia({ metrica: 'processo_cpu' })];
  assert.equal(
    criarHipotese({ enunciado: 'x', sustentada_por: base, enfraquecida_por: [evidencia({ metrica: 'disco_livre' })] })
      .confianca,
    'media',
  );
  assert.equal(
    criarHipotese({
      enunciado: 'x',
      sustentada_por: base,
      enfraquecida_por: [evidencia({ metrica: 'disco_livre' }), evidencia({ metrica: 'ligado_ha' })],
    }).confianca,
    'baixa',
  );
});

test('o enunciado sempre carrega a marca de hipótese — nunca sai como fato', () => {
  const h = criarHipotese({ enunciado: 'o chrome causa a lentidão', sustentada_por: [evidencia()] });
  const frase = enunciarHipotese(h);
  assert.match(frase, /minha leitura é que/);
  assert.notEqual(frase, h.enunciado);
});

// ---------------------------------------------------------------------------
// 2. Hipótese só nasce de anomalia
// ---------------------------------------------------------------------------

test('máquina dentro da faixa não produz anomalia nem hipótese nenhuma', () => {
  const d = diagnosticarLentidao(
    medicao({ processos: [{ nome: 'chrome', pid: 10, cpu_pct: 4, memoria_mb: 500 }] }),
  );
  assert.equal(d.anomalias.length, 0);
  assert.equal(d.hipoteses.length, 0);
  assert.equal(ehConclusivo(d), false);
  // Mas as evidências existem: medir e não achar nada é um resultado.
  assert.ok(d.evidencias.some((e) => e.metrica === 'cpu_total'));
});

test('CPU saturada com processo dominante vira hipótese de confiança alta', () => {
  const d = diagnosticarLentidao(
    medicao({
      cpu_pct: 94,
      processos: [
        { nome: 'chrome', pid: 10, cpu_pct: 61, memoria_mb: 900 },
        { nome: 'explorer', pid: 11, cpu_pct: 2, memoria_mb: 120 },
      ],
    }),
  );
  assert.equal(d.anomalias.length, 1);
  assert.equal(d.anomalias[0].severidade, 'grave');
  assert.equal(d.hipoteses[0].confianca, 'alta');
  assert.match(d.hipoteses[0].enunciado, /chrome/);
});

test('CPU saturada SEM dono não acusa o maior da lista', () => {
  const d = diagnosticarLentidao(
    medicao({
      cpu_pct: 93,
      processos: [
        { nome: 'servico_a', pid: 10, cpu_pct: 9, memoria_mb: 200 },
        { nome: 'servico_b', pid: 11, cpu_pct: 8, memoria_mb: 180 },
      ],
    }),
  );
  assert.match(d.hipoteses[0].enunciado, /não há um culpado único/);
  assert.doesNotMatch(d.hipoteses[0].enunciado, /servico_a está contribuindo/);
});

test('memória alta sem processo grande é rebaixada pela própria medição de processos', () => {
  const d = diagnosticarLentidao(
    medicao({
      memoria_pct: 95,
      processos: [{ nome: 'servico', pid: 10, cpu_pct: 1, memoria_mb: 300 }],
    }),
  );
  const h = d.hipoteses[0];
  assert.match(h.enunciado, /nenhum processo isolado responde por ela/);
  assert.equal(h.enfraquecida_por.length, 1);
  // Uma medição a favor, uma contra: `media` rebaixada para `baixa`.
  assert.equal(h.confianca, 'baixa');
  assert.equal(ehConclusivo(d), false);
});

test('sem sonda de processos a hipótese admite que não sabe apontar quem', () => {
  const d = diagnosticarLentidao(medicao({ cpu_pct: 95, processos: null, lacunas: ['sem sonda'] }));
  assert.match(d.hipoteses[0].enunciado, /não consegui ver quais processos/);
  assert.equal(d.hipoteses[0].confianca, 'media');
  assert.deepEqual(d.lacunas, ['sem sonda']);
});

test('as faixas são exercidas nos dois lados da fronteira', () => {
  const dentro = anomaliasDe(evidenciasDe(medicao({ cpu_pct: FAIXAS.cpu.moderada - 0.1 })));
  const fora = anomaliasDe(evidenciasDe(medicao({ cpu_pct: FAIXAS.cpu.moderada })));
  assert.equal(dentro.length, 0);
  assert.equal(fora.length, 1);
  assert.equal(fora[0].severidade, 'moderada');
});

test('disco é medido ao contrário — pouco livre é a anomalia', () => {
  const a = anomaliasDe(evidenciasDe(medicao({ disco_livre_pct: 3 })));
  assert.equal(a.length, 1);
  assert.equal(a[0].severidade, 'grave');
});

test('disco não medido não vira evidência nem anomalia', () => {
  const d = diagnosticarLentidao(medicao({ disco_livre_pct: null, disco_livre_gb: null }));
  assert.equal(
    d.evidencias.some((e) => e.metrica === 'disco_livre'),
    false,
  );
  assert.equal(d.anomalias.length, 0);
});

test('hipóteses saem ordenadas da mais confiável para a menos', () => {
  const forte = criarHipotese({
    enunciado: 'forte',
    sustentada_por: [evidencia(), evidencia({ metrica: 'processo_cpu' })],
  });
  const fraca = criarHipotese({ enunciado: 'fraca', sustentada_por: [] });
  assert.deepEqual(
    ordenarHipoteses([fraca, forte]).map((h) => h.enunciado),
    ['forte', 'fraca'],
  );
});

// ---------------------------------------------------------------------------
// 3. Planos e recomendação
// ---------------------------------------------------------------------------

const plano = (parcial: Partial<PlanoDeAcao>): PlanoDeAcao => ({
  id: 'A',
  rotulo: 'r',
  objetivo: 'o',
  passos: [],
  risco: 'baixo',
  esforco: 'baixo',
  beneficio: 'medio',
  resultado_esperado: null,
  rollback: null,
  ...parcial,
});

test('a recomendação prefere o benefício quase igual com risco menor — e diz isso', () => {
  const seguro = plano({ id: 'A', rotulo: 'seguro', beneficio: 'alto', risco: 'baixo', esforco: 'baixo' });
  const agressivo = plano({ id: 'B', rotulo: 'agressivo', beneficio: 'alto', risco: 'alto', esforco: 'medio' });
  const r = recomendar([agressivo, seguro]);
  assert.equal(r.escolhido.id, 'A');
  assert.equal(r.descartados.length, 1);
  assert.ok(pontuarPlano(seguro) > pontuarPlano(agressivo));
});

test('quando o descartado entrega mais, a justificativa explica a troca', () => {
  const r = recomendar([
    plano({ id: 'A', rotulo: 'seguro', beneficio: 'medio', risco: 'baixo', esforco: 'baixo' }),
    plano({ id: 'B', rotulo: 'agressivo', beneficio: 'alto', risco: 'alto', esforco: 'alto' }),
  ]);
  assert.equal(r.escolhido.id, 'A');
  assert.match(r.justificativa, /entrega mais/);
  assert.match(r.justificativa, /menor risco/);
});

test('recomendar sem alternativa nenhuma é erro de quem chamou, não resultado', () => {
  assert.throws(() => recomendar([]), /nenhuma alternativa/);
});

test('o risco de um plano é o do passo mais arriscado, nunca a média', () => {
  assert.equal(riscoDoPlano([{ risco: 'baixo' }, { risco: 'alto' }, { risco: 'baixo' }]), 'alto');
});

test('"não fazer nada" é sempre uma das alternativas oferecidas', () => {
  const m = medicao({ cpu_pct: 95, processos: [{ nome: 'chrome', pid: 1, cpu_pct: 70, memoria_mb: 900 }] });
  const planos = planosParaLentidao(m, diagnosticarLentidao(m), aplicativoFechavelDoProcesso);
  assert.ok(planos.some((p) => /observar/.test(p.rotulo)));
});

test('processo fora da allowlist vira instrução ao operador, não plano que a IARA não sabe executar', () => {
  const m = medicao({
    cpu_pct: 95,
    processos: [{ nome: 'algum_erp', pid: 1, cpu_pct: 70, memoria_mb: 900 }],
  });
  const planos = planosParaLentidao(m, diagnosticarLentidao(m), aplicativoFechavelDoProcesso);
  const primeiro = planos[0];
  assert.match(primeiro.rotulo, /você encerra/);
  assert.equal(primeiro.passos[0].habilidade, null);
  assert.match(primeiro.passos[0].descricao, /não tenho autorização/);
});

test('processo da allowlist vira plano executável com rollback declarado', () => {
  const m = medicao({
    cpu_pct: 95,
    processos: [{ nome: 'chrome', pid: 1, cpu_pct: 70, memoria_mb: 900 }],
  });
  const planos = planosParaLentidao(m, diagnosticarLentidao(m), aplicativoFechavelDoProcesso);
  const primeiro = planos[0];
  assert.equal(primeiro.passos[0].habilidade, 'fechar_aplicativo');
  assert.equal(primeiro.passos[0].reversivel, true);
  assert.match(String(primeiro.rollback), /abrir o Google Chrome de novo/);
  assert.equal(primeiro.resultado_esperado?.metrica, 'cpu_total');
});

test('o Explorador nunca é oferecido para fechamento — derrubá-lo apaga a área de trabalho', () => {
  assert.equal(aplicativoFechavelDoProcesso('explorer.exe'), null);
  assert.equal(aplicativoFechavelDoProcesso('explorer'), null);
  assert.deepEqual(aplicativoFechavelDoProcesso('chrome'), { rotulo: 'Google Chrome' });
  // Casamento por nome de imagem, não por substring da frase: o processo abaixo
  // contém "arquivos" e não pode virar o Explorador.
  assert.equal(aplicativoFechavelDoProcesso('arquivos_backup'), null);
});

test('reiniciar só é proposto quando há razão medida', () => {
  const semRazao = medicao({ cpu_pct: 95, processos: [{ nome: 'chrome', pid: 1, cpu_pct: 70, memoria_mb: 900 }] });
  const planosSem = planosParaLentidao(
    semRazao,
    diagnosticarLentidao(semRazao),
    aplicativoFechavelDoProcesso,
  );
  assert.equal(planosSem.some((p) => /reiniciar/.test(p.rotulo)), false);

  const comRazao = medicao({ memoria_pct: 95, ligado_ha_h: 400 });
  const planosCom = planosParaLentidao(
    comRazao,
    diagnosticarLentidao(comRazao),
    aplicativoFechavelDoProcesso,
  );
  const reiniciar = planosCom.find((p) => /reiniciar/.test(p.rotulo));
  assert.ok(reiniciar);
  assert.equal(reiniciar.risco, 'alto');
});

test('nenhum plano proposto executa sozinho: todo passo aponta habilidade do catálogo ou nada', () => {
  const m = medicao({
    cpu_pct: 95,
    memoria_pct: 95,
    disco_livre_pct: 2,
    ligado_ha_h: 400,
    processos: [{ nome: 'chrome', pid: 1, cpu_pct: 70, memoria_mb: 4000 }],
  });
  const ids = new Set(CATALOGO.map((h) => h.manifesto.id));
  for (const p of planosParaLentidao(m, diagnosticarLentidao(m), aplicativoFechavelDoProcesso)) {
    for (const passo of p.passos) {
      if (passo.habilidade === null) continue;
      assert.ok(ids.has(passo.habilidade), `habilidade inexistente no catálogo: ${passo.habilidade}`);
    }
  }
});

test('sem a allowlist injetada, a análise nunca promete fechar nada', () => {
  /**
   * O padrão conservador de `PodeFechar`. Um chamador que esqueça de passar o
   * resolvedor recebe planos de INSTRUÇÃO, nunca um passo `fechar_aplicativo`
   * que a IARA não tem como cumprir.
   */
  const m = medicao({ cpu_pct: 95, processos: [{ nome: 'chrome', pid: 1, cpu_pct: 70, memoria_mb: 900 }] });
  const planos = planosParaLentidao(m, diagnosticarLentidao(m));
  assert.equal(
    planos.some((p) => p.passos.some((s) => s.habilidade === 'fechar_aplicativo')),
    false,
  );
  assert.match(planos[0].rotulo, /você encerra/);
});

// ---------------------------------------------------------------------------
// 4. Verificação pós-ação (§14)
// ---------------------------------------------------------------------------

const esperadoCpu = { metrica: 'cpu_total', comparador: '<' as const, valor: 70, unidade: '%' };

test('o veredito distingue resolvido, parcial, ineficaz e regredido', () => {
  assert.equal(avaliarResultado(esperadoCpu, 38, 82), 'resolvido');
  assert.equal(avaliarResultado(esperadoCpu, 75, 82), 'parcial');
  assert.equal(avaliarResultado(esperadoCpu, 82, 82), 'acao_ineficaz');
  assert.equal(avaliarResultado(esperadoCpu, 89, 82), 'regrediu');
});

test('sem medição depois, o veredito é "não verificável" — nunca sucesso por omissão', () => {
  assert.equal(avaliarResultado(esperadoCpu, null, 82), 'nao_verificavel');
  assert.equal(avaliarResultado(null, 38, 82), 'nao_verificavel');
});

test('a direção desejada sai do comparador — para disco, subir é melhorar', () => {
  const esperadoDisco = { metrica: 'disco_livre', comparador: '>' as const, valor: 15, unidade: '%' };
  assert.equal(avaliarResultado(esperadoDisco, 20, 3), 'resolvido');
  assert.equal(avaliarResultado(esperadoDisco, 8, 3), 'parcial');
  assert.equal(avaliarResultado(esperadoDisco, 1, 3), 'regrediu');
});

test('o confronto compara a métrica que o plano prometeu, com antes e depois', () => {
  const antes = medicao({ cpu_pct: 88 });
  const depois = medicao({ cpu_pct: 31 });
  const c = confrontar({ medicao: antes, esperado: esperadoCpu }, depois);
  assert.ok(c);
  assert.equal(c.veredito, 'resolvido');
  assert.equal(c.antes, 88);
  assert.equal(c.depois, 31);
  assert.match(c.esperado, /abaixo de 70%/);
});

test('sem investigação anterior não há confronto — e isso não é falha', () => {
  assert.equal(confrontar(null, medicao()), null);
  assert.equal(confrontar({ medicao: medicao(), esperado: null }, medicao()), null);
});

test('métrica esperada que não pôde ser medida agora vira não verificável', () => {
  const esperadoDisco = { metrica: 'disco_livre', comparador: '>' as const, valor: 15, unidade: '%' };
  const c = confrontar(
    { medicao: medicao({ disco_livre_pct: 3 }), esperado: esperadoDisco },
    medicao({ disco_livre_pct: null }),
  );
  assert.ok(c);
  assert.equal(c.veredito, 'nao_verificavel');
});

// ---------------------------------------------------------------------------
// 5. Redação — fato antes de hipótese, e a pergunta no fim
// ---------------------------------------------------------------------------

test('o relatório separa o que foi medido do que é hipótese, e termina perguntando', () => {
  const m = medicao({
    cpu_pct: 94,
    processos: [{ nome: 'chrome', pid: 10, cpu_pct: 61, memoria_mb: 900 }],
  });
  const texto = redigirInvestigacao(investigarLentidao(m, null, aplicativoFechavelDoProcesso));

  const medido = texto.indexOf('O que eu MEDI agora');
  const fora = texto.indexOf('O que está FORA da faixa');
  const acho = texto.indexOf('O que eu ACHO que explica');
  assert.ok(medido >= 0 && fora > medido && acho > fora, 'a ordem fato → anomalia → hipótese quebrou');
  assert.match(texto, /Posso executar o plano [A-Z]\?/);
  // E diz COMO responder: uma pergunta que o operador não sabe responder não
  // fecha ciclo nenhum.
  assert.match(texto, /Responda "executar o plano [A-Z]"/);
});

test('plano que depende do operador não termina pedindo autorização', () => {
  /**
   * Pedir "posso executar?" para um plano que a IARA não executa é pedir
   * permissão para não fazer nada. O `algum_erp` está fora da allowlist.
   */
  const m = medicao({
    cpu_pct: 95,
    processos: [{ nome: 'algum_erp', pid: 1, cpu_pct: 70, memoria_mb: 900 }],
  });
  const texto = redigirInvestigacao(investigarLentidao(m, null, aplicativoFechavelDoProcesso));
  assert.doesNotMatch(texto, /Posso executar/);
  assert.match(texto, /Esse plano depende de você/);
  assert.match(texto, /meça de novo/);
});

test('lacuna de medição sai na resposta em vez de sumir', () => {
  const texto = redigirInvestigacao(
    investigarLentidao(medicao({ cpu_pct: 95, processos: null, lacunas: ['não sei listar processos aqui'] })),
  );
  assert.match(texto, /O que eu NÃO consegui medir/);
  assert.match(texto, /não sei listar processos aqui/);
});

test('máquina sem anomalia não inventa causa e devolve a pergunta ao operador', () => {
  const texto = redigirInvestigacao(investigarLentidao(medicao()));
  assert.match(texto, /Nenhuma das medições que eu sei fazer está fora da faixa normal/);
  assert.doesNotMatch(texto, /Posso executar/);
  assert.match(texto, /Me diga o que está lento/);
});

test('quando nada está fora da faixa não existe recomendação', () => {
  assert.equal(investigarLentidao(medicao()).recomendacao, null);
});

// ---------------------------------------------------------------------------
// 6. Sondas — a aritmética que erra em silêncio
// ---------------------------------------------------------------------------

test('CPU de processo é fatia da máquina inteira, não de um núcleo', () => {
  // 4 s de processador em 1 s de janela sobre 8 núcleos = 50% da máquina.
  const p = interpretarProcessos(JSON.stringify([{ n: 'x', p: 1, c: 4, m: 1024 }]), 8, 1000);
  assert.ok(p);
  assert.equal(p[0].cpu_pct, 50);
  assert.equal(p[0].memoria_mb, 1024);
});

test('delta negativo (pid reciclado) não vira consumo atribuído a ninguém', () => {
  const p = interpretarProcessos(JSON.stringify([{ n: 'x', p: 1, c: -3, m: 100 }]), 8, 1000);
  assert.equal(p?.[0].cpu_pct, 0);
});

test('um processo só chega como objeto, não como lista — e é aceito assim', () => {
  const p = interpretarProcessos(JSON.stringify({ n: 'x', p: 1, c: 1, m: 100 }), 4, 1000);
  assert.equal(p?.length, 1);
});

test('saída vazia ou ilegível é "não sei sondar", não lista vazia', () => {
  assert.equal(interpretarProcessos('', 8), null);
  assert.equal(interpretarProcessos('isto não é json', 8), null);
});

test('a lista guarda os maiores de memória, não só os de CPU', () => {
  const bruto = JSON.stringify([
    ...Array.from({ length: 10 }, (_, i) => ({ n: `cpu${i}`, p: i + 1, c: 8 - i * 0.1, m: 10 })),
    { n: 'devorador_de_ram', p: 99, c: 0, m: 6000 },
  ]);
  const p = interpretarProcessos(bruto, 8, 1000);
  assert.ok(p?.some((x) => x.nome === 'devorador_de_ram'));
});

test('medição vinda do braço é validada, não confiada — campo essencial ausente é null', () => {
  assert.equal(interpretarMedicao(null), null);
  assert.equal(interpretarMedicao({ cpu_pct: 10 }), null, 'faltam memoria_pct e nucleos');
  assert.equal(interpretarMedicao({ cpu_pct: 'muito', memoria_pct: 10, nucleos: 4 }), null);

  const ok = interpretarMedicao({ cpu_pct: 10, memoria_pct: 20, nucleos: 4, disco_livre_pct: null });
  assert.ok(ok);
  assert.equal(ok.disco_livre_pct, null, 'ausência de disco não pode virar zero');
  assert.equal(ok.processos, null);
});

test('processo sem nome é descartado em vez de entrar como string vazia', () => {
  const m = interpretarMedicao({
    cpu_pct: 10,
    memoria_pct: 20,
    nucleos: 4,
    processos: [{ nome: '', pid: 1 }, { nome: 'bom', pid: 2, cpu_pct: 5, memoria_mb: 100 }],
  });
  assert.equal(m?.processos?.length, 1);
  assert.equal(m?.processos?.[0].nome, 'bom');
});

// ---------------------------------------------------------------------------
// 7. Roteamento — a frase que abre o caderno
// ---------------------------------------------------------------------------

const percepcao = new MotorPercepcao();
const planejador = new Planejador();

test('"meu computador está muito lento" vira plano de investigação, custo zero', () => {
  const p = percepcao.perceber('Iara, meu computador está muito lento.');
  assert.ok(p.ancoras.includes('lentidao'));
  assert.equal(planejador.temReceita(p), true);
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'investigar_lentidao');
});

test('lentidão vence diagnóstico e leitura de sistema quando as três casam', () => {
  const p = percepcao.perceber('faça um diagnóstico: o desempenho do computador está lento');
  assert.ok(p.ancoras.includes('lentidao'));
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'investigar_lentidao');
});

test('"lento" sem a máquina por perto NÃO dispara investigação', () => {
  for (const frase of [
    'o cliente está lento para responder o orçamento',
    'esse processo de aprovação é muito lento',
    'a transportadora está devagar com a entrega',
  ]) {
    assert.equal(
      percepcao.perceber(frase).ancoras.includes('lentidao'),
      false,
      `falso positivo em: ${frase}`,
    );
  }
});

test('"quanto de memória" continua sendo leitura instantânea, não investigação', () => {
  const p = percepcao.perceber('quanto de memória meu computador está usando?');
  assert.equal(p.ancoras.includes('lentidao'), false);
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'informacoes_sistema');
});

test('"meça de novo" fecha o laço e volta para a investigação', () => {
  const p = percepcao.perceber('mede de novo');
  assert.ok(p.ancoras.includes('lentidao'));
});

test('a habilidade de investigação não age no mundo: risco baixo e leitura', () => {
  const h = CATALOGO.find((x) => x.manifesto.id === 'investigar_lentidao');
  assert.ok(h);
  assert.equal(h.manifesto.risco, 'baixo');
  assert.equal(h.manifesto.idempotencia, 'leitura');
  assert.deepEqual(h.manifesto.permissoes, []);
});
