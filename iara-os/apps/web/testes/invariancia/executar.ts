/**
 * ARNÊS DE INVARIÂNCIA SEMÂNTICA — `npm run invariancia`.
 *
 * A PERGUNTA, e ela é diferente da que `npm test` responde:
 *
 *     npm test              → "o sistema continua correto?"
 *     npm run invariancia   → "o sistema entende variações humanas
 *                              semanticamente equivalentes?"
 *
 * As duas métricas não se misturam de propósito. A suíte funcional trava
 * comportamento e tem de ficar verde; esta MEDE uma taxa, e uma taxa que nasce
 * verde não é portão nenhum — é um arnês desenhado para se aplaudir.
 *
 * ---------------------------------------------------------------------------
 * ARNÊS A e ARNÊS B
 * ---------------------------------------------------------------------------
 *
 *   ARNÊS A — CONSISTÊNCIA. As paráfrases de uma mesma intenção produzem a
 *             mesma interpretação? Compara cada formulação com a limpa.
 *
 *   ARNÊS B — CORREÇÃO. A interpretação está CERTA? Compara contra um gabarito
 *             escrito à mão em `testes/compreensao/gabarito.ts`, sem consultar
 *             a implementação.
 *
 * As duas perguntas são independentes, e é por isso que as duas existem: um
 * sistema que responde `conversar` para TODAS as frases é perfeitamente
 * consistente (arnês A em 100%) e completamente errado (arnês B em zero).
 *
 * ---------------------------------------------------------------------------
 * ANTES E DEPOIS
 * ---------------------------------------------------------------------------
 *
 * O arnês roda as duas camadas sobre os MESMOS casos e publica o delta. Trocar
 * os casos junto com a camada produziria um número que não mede nada — que é o
 * modo mais comum de uma migração parecer bem-sucedida.
 *
 * O QUE ELE PUBLICA (nunca um `PASSOU`): taxa por família, taxa por DIMENSÃO,
 * LACUNA onde não há fonte determinística, pares negativos, ambiguidade
 * preservada. Dimensão nunca desaparece dentro de uma média: duas leituras podem
 * concordar no objetivo e discordar no período, e a nota única de 80% esconde
 * exatamente a metade que faz a IARA responder certo sobre a semana errada.
 *
 * SEM REDE, SEM LLM, SEM DISCO, RELÓGIO CONGELADO. Ver `contrato.ts`.
 */

import {
  DIMENSOES,
  INDETERMINADO,
  interpretar,
  type Camada,
  type ContratoSemanticoMedido,
  type Dimensao,
} from './contrato';
import { CASOS_AMBIGUOS, CENARIOS, PARES_NEGATIVOS } from './cenarios';
import { DISTINTOS, NAO_COLAPSAM } from '../compreensao/gabarito';
import { rodarArnesC, type Elo } from './arnesC';

const pct = (n: number, d: number): string => (d === 0 ? '  — ' : `${((100 * n) / d).toFixed(0)}%`);
const taxa = (n: number, d: number): string => `${n}/${d}`.padEnd(7) + pct(n, d).padStart(5);

/** `LACUNA` ≠ verde. A dimensão que a referência não produz não é medida. */
type Veredito = 'convergiu' | 'divergiu' | 'lacuna';

function comparar(
  referencia: ContratoSemanticoMedido,
  medido: ContratoSemanticoMedido,
  d: Dimensao,
): Veredito {
  /**
   * A REFERÊNCIA MANDA. Se a formulação limpa já sai `indeterminado` numa
   * dimensão, não existe significado a preservar ali — e contar "os dois não
   * souberam" como acordo produziria o falso verde por vácuo que este
   * repositório já pagou para ver ("0 contornos" que eram 0 por construção).
   */
  if (referencia[d] === INDETERMINADO) return 'lacuna';
  return referencia[d] === medido[d] ? 'convergiu' : 'divergiu';
}

interface Contagem {
  convergiu: number;
  medido: number;
  lacuna: number;
}

interface Medicao {
  readonly camada: Camada;
  readonly familias: readonly {
    nome: string;
    familia: string;
    convergiu: number;
    total: number;
    referenciaCerta: boolean;
    divergencias: readonly string[];
  }[];
  readonly dimensoes: ReadonlyMap<Dimensao, Contagem>;
  readonly lacunas: readonly string[];
  readonly totalConv: number;
  readonly totalCasos: number;
  readonly negativos: { ok: number; total: number; colapsos: readonly string[] };
  readonly ambiguos: { ok: number; total: number; escondidos: readonly string[] };
}

function medir(camada: Camada): Medicao {
  const ler = (f: string) => interpretar(f, camada);

  const familias: Medicao['familias'][number][] = [];
  const dimensoes = new Map<Dimensao, Contagem>(
    DIMENSOES.map((d) => [d, { convergiu: 0, medido: 0, lacuna: 0 }]),
  );
  const lacunas: string[] = [];
  let totalConv = 0;
  let totalCasos = 0;

  for (const cenario of CENARIOS) {
    const referencia = ler(cenario.limpa);
    let convergiu = 0;
    const divergencias: string[] = [];

    for (const v of cenario.variacoes) {
      const medido = ler(v.frase);
      const vereditos = DIMENSOES.map((d) => [d, comparar(referencia, medido, d)] as const);

      for (const [d, veredito] of vereditos) {
        const acc = dimensoes.get(d)!;
        if (veredito === 'lacuna') acc.lacuna += 1;
        else {
          acc.medido += 1;
          if (veredito === 'convergiu') acc.convergiu += 1;
        }
      }

      /**
       * A FORMULAÇÃO CONVERGE quando NENHUMA dimensão medível divergiu. Régua
       * dura de propósito: acertar o objetivo e errar o período é responder a
       * pergunta certa sobre a semana errada, que na operação é indistinguível
       * de responder errado.
       */
      const divergiu = vereditos.filter(([, x]) => x === 'divergiu').map(([d]) => d);
      if (divergiu.length === 0) convergiu += 1;
      else divergencias.push(`${v.registro.padEnd(9)} « ${v.frase} » → ${divergiu.join(', ')}`);
    }

    for (const d of DIMENSOES) {
      if (referencia[d] === INDETERMINADO) lacunas.push(`${cenario.nome} · ${d}`);
    }

    totalConv += convergiu;
    totalCasos += cenario.variacoes.length;
    familias.push({
      nome: cenario.nome,
      familia: cenario.familia,
      convergiu,
      total: cenario.variacoes.length,
      /**
       * Se a formulação LIMPA — a frase de manual, a mais fácil que existe — já
       * não cai na família que um humano diz que ela é, a intenção inteira está
       * perdida antes de qualquer paráfrase, e o relatório tem de dizer isso.
       */
      referenciaCerta: referencia.objetivo === cenario.familia,
      divergencias,
    });
  }

  let negOk = 0;
  const colapsos: string[] = [];
  for (const p of PARES_NEGATIVOS) {
    const [a, b] = [ler(p.a), ler(p.b)];
    if (a[p.dimensao] !== b[p.dimensao]) negOk += 1;
    else colapsos.push(`[${p.dimensao}] « ${p.a} » ≡ « ${p.b} » → "${a[p.dimensao]}" — ${p.porque}`);
  }

  let ambOk = 0;
  const escondidos: string[] = [];
  for (const c of CASOS_AMBIGUOS) {
    const r = ler(c.frase);
    if (r.ambiguidade === 'disputada') ambOk += 1;
    else escondidos.push(`« ${c.frase} » margem=${r.margem.toFixed(2)} — ${c.porque}`);
  }

  return {
    camada,
    familias,
    dimensoes,
    lacunas,
    totalConv,
    totalCasos,
    negativos: { ok: negOk, total: PARES_NEGATIVOS.length, colapsos },
    ambiguos: { ok: ambOk, total: CASOS_AMBIGUOS.length, escondidos },
  };
}

// ---------------------------------------------------------------------------
// ARNÊS B — correção contra gabarito externo
// ---------------------------------------------------------------------------

/**
 * O GABARITO NÃO É RECALCULADO AQUI. Ele vive em `testes/compreensao/gabarito.ts`,
 * escrito à mão a partir do português. Este bloco só o executa e conta.
 *
 * `DISTINTOS` fixa `ato`/`operacao`/`objeto`/`referente` por frase; o arnês B
 * mede quantas dessas afirmações o sistema sustenta. `NAO_COLAPSAM` mede o lado
 * simétrico — o que tem de continuar diferente.
 */
function arnesB(camada: Camada): { certos: number; total: number; erros: string[] } {
  const erros: string[] = [];
  let certos = 0;
  let total = 0;

  for (const caso of DISTINTOS) {
    const r = interpretar(caso.frase, camada);
    /**
     * O gabarito fala em `ato`/`operacao`, que a camada lexical não produz.
     * Medi-la contra eles daria zero por AUSÊNCIA de dimensão, não por erro —
     * e um zero desses infla o delta sem significar nada. Só `operacao` e
     * `referente` atravessam as duas camadas de forma comparável.
     */
    if (caso.operacao !== undefined) {
      total += 1;
      const esperado = caso.operacao ?? INDETERMINADO;
      if (r.operacao === esperado) certos += 1;
      else erros.push(`[operacao] « ${caso.frase} » esperado ${esperado}, veio ${r.operacao}`);
    }
    if (caso.referente !== undefined) {
      total += 1;
      const esperado = caso.referente ?? INDETERMINADO;
      if (r.referente === esperado) certos += 1;
      else erros.push(`[referente] « ${caso.frase} » esperado ${esperado}, veio ${r.referente}`);
    }
  }

  for (const par of NAO_COLAPSAM) {
    if (par.dimensao === 'objetivo') continue;
    total += 1;
    const [a, b] = [interpretar(par.a, camada), interpretar(par.b, camada)];
    const chave = par.dimensao === 'ato' ? 'rota' : 'operacao';
    if (a[chave] !== b[chave]) certos += 1;
    else erros.push(`[${chave}] « ${par.a} » ≡ « ${par.b} » → "${a[chave]}" — ${par.porque}`);
  }

  return { certos, total, erros };
}

// ---------------------------------------------------------------------------

function main(): void {
  const argumentos = new Set(process.argv.slice(2));
  const detalhar = argumentos.has('--detalhe');

  /**
   * PRÉ-REQUISITO: DETERMINISMO. Uma taxa medida sobre um interpretador que
   * varia entre execuções não mede compreensão, mede ruído.
   */
  for (const camada of ['lexical', 'semantica'] as const) {
    for (const c of CENARIOS) {
      const [a, b] = [interpretar(c.limpa, camada), interpretar(c.limpa, camada)];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        console.error(`NÃO DETERMINÍSTICO (${camada}): « ${c.limpa} » — a taxa seria ruído.`);
        process.exit(2);
      }
    }
  }

  const antes = medir('lexical');
  const depois = medir('semantica');

  const delta = (a: number, b: number): string => {
    const d = b - a;
    return d === 0 ? '    =' : `${d > 0 ? '+' : ''}${d}`.padStart(5);
  };

  console.log('\n═══ INVARIÂNCIA SEMÂNTICA — ARNÊS A (consistência) ═══');
  console.log('mesma intenção + formulação diferente → mesma interpretação?\n');
  console.log('INTENÇÃO                                     ANTES        DEPOIS         Δ');
  for (let i = 0; i < antes.familias.length; i += 1) {
    const a = antes.familias[i];
    const b = depois.familias[i];
    const marca = b.referenciaCerta ? ' ' : '⚠';
    console.log(
      `${marca} ${a.nome.padEnd(42)} ${taxa(a.convergiu, a.total)}  ${taxa(b.convergiu, b.total)}  ${delta(a.convergiu, b.convergiu)}`,
    );
  }
  console.log(
    `  ${'TODAS (conjunção de TODAS as dimensões)'.padEnd(42)} ${taxa(antes.totalConv, antes.totalCasos)}  ${taxa(depois.totalConv, depois.totalCasos)}  ${delta(antes.totalConv, depois.totalConv)}`,
  );

  /**
   * O AGREGADO ACIMA NÃO É COMPARÁVEL, E DIZER ISSO É PARTE DO RESULTADO.
   *
   * "Converge" ali significa NENHUMA dimensão divergiu — uma conjunção. A camada
   * semântica ACRESCENTOU dimensões (`operacao`, que não existia) e ampliou a
   * cobertura de outras (`proposito` e `referente` saíram de 16 casos medidos
   * para 72). Uma conjunção sobre mais termos cai mesmo quando cada termo
   * melhora: é aritmética, não regressão.
   *
   * Publicar só o número de cima seria mentir para baixo; publicar só o de
   * dentro seria mentir para cima. Os dois ficam, e o comparável é este — a
   * conjunção sobre as três dimensões que existem nas DUAS camadas com a MESMA
   * fonte.
   */
  const comparaveis: readonly Dimensao[] = ['objetivo', 'periodo', 'rota'];
  const conjuncao = (m: Medicao): { ok: number; total: number } => {
    let ok = 0;
    let total = 0;
    for (const cenario of CENARIOS) {
      const ref = interpretar(cenario.limpa, m.camada);
      for (const v of cenario.variacoes) {
        const med = interpretar(v.frase, m.camada);
        total += 1;
        if (comparaveis.every((d) => comparar(ref, med, d) !== 'divergiu')) ok += 1;
      }
    }
    return { ok, total };
  };
  const cAntes = conjuncao(antes);
  const cDepois = conjuncao(depois);
  console.log(
    `  ${'COMPARÁVEL (objetivo+periodo+rota, mesma fonte)'.padEnd(42)} ${taxa(cAntes.ok, cAntes.total)}  ${taxa(cDepois.ok, cDepois.total)}  ${delta(cAntes.ok, cDepois.ok)}`,
  );
  console.log('  (⚠ = a formulação limpa já não cai na família que um humano declarou)');

  console.log('\nDIMENSÃO                     ANTES        DEPOIS         Δ   NÃO MEDIDO (depois)');
  for (const d of DIMENSOES) {
    const a = antes.dimensoes.get(d)!;
    const b = depois.dimensoes.get(d)!;
    const naoMedido = b.lacuna > 0 ? `${b.lacuna} sem referência` : '—';
    console.log(
      `  ${d.padEnd(26)} ${taxa(a.convergiu, a.medido)}  ${taxa(b.convergiu, b.medido)}  ${delta(a.convergiu, b.convergiu)}   ${naoMedido}`,
    );
  }

  console.log('\nPARES NEGATIVOS (intenções diferentes continuam diferentes)');
  console.log(
    `  antes ${taxa(antes.negativos.ok, antes.negativos.total)}   depois ${taxa(depois.negativos.ok, depois.negativos.total)}`,
  );
  for (const c of depois.negativos.colapsos) console.log(`  COLAPSOU  ${c}`);

  console.log('\nAMBIGUIDADE PRESERVADA (frase que não dá para decidir sozinha)');
  console.log(
    `  antes ${taxa(antes.ambiguos.ok, antes.ambiguos.total)}   depois ${taxa(depois.ambiguos.ok, depois.ambiguos.total)}`,
  );
  for (const e of depois.ambiguos.escondidos) console.log(`  ESCONDIDA ${e}`);

  // --- ARNÊS B -------------------------------------------------------------
  const bAntes = arnesB('lexical');
  const bDepois = arnesB('semantica');
  console.log('\n═══ ARNÊS B (correção contra gabarito externo) ═══');
  console.log('a interpretação está CERTA, não só estável?\n');
  console.log(`  antes  ${taxa(bAntes.certos, bAntes.total)}`);
  console.log(`  depois ${taxa(bDepois.certos, bDepois.total)}`);
  if (bDepois.erros.length > 0) {
    console.log('\n  ainda errado:');
    for (const e of bDepois.erros) console.log(`    ${e}`);
  }

  // --- ARNES C -------------------------------------------------------------
  const cadeias = rodarArnesC();
  const porElo: Record<Elo, number> = { compreensao: 0, admissao: 0, decisao: 0 };
  let inteiras = 0;
  for (const c of cadeias) { if (c.culpado) porElo[c.culpado] += 1; else inteiras += 1; }

  console.log('\n═══ ARNÊS C (a compreensão chega até a rota?) ═══');
  console.log('quando a IARA entende, ela escolhe a rota correspondente?\n');
  console.log(`  CADEIA INTEIRA        ${taxa(inteiras, cadeias.length)}`);
  console.log('\n  ONDE CADA FALHA MORREU  (primeiro elo que quebrou)');
  console.log(`    A compreensão       ${taxa(porElo.compreensao, cadeias.length)}   contrato saiu errado`);
  console.log(`    B admissão          ${taxa(porElo.admissao, cadeias.length)}   contrato ok, sem capacidade compatível`);
  console.log(`    C decisão           ${taxa(porElo.decisao, cadeias.length)}   contrato ok + candidato ok + rota errada`);

  if (detalhar) {
    console.log('\n  CADEIAS QUE QUEBRARAM');
    for (const c of cadeias) {
      if (!c.culpado) continue;
      console.log(`\n    « ${c.frase} »  [${c.registro}]`);
      console.log(`      contrato esperado   ${c.objetivoEsperado}`);
      console.log(`      contrato produzido  ${c.objetivoProduzido}   (ato ${c.ato}, op ${c.operacao})`);
      console.log(`      candidatos          ${c.candidatos.join(', ') || '(nenhum)'}`);
      console.log(`      admitido            ${c.candidatoAdmitido ?? '(nenhum)'}`);
      console.log(`      rota escolhida      ${c.rotaEscolhida}`);
      console.log(`      rota esperada       ${c.rotaEsperada}`);
      console.log(
        `      compreensão ${c.compreensao} | admissão ${c.admissao} | decisão ${c.decisao}  →  ${c.culpado.toUpperCase()}`,
      );
    }
  }

  // --- Lacunas -------------------------------------------------------------
  console.log('\nLACUNAS DECLARADAS (dimensão sem fonte determinística na referência)');
  const lac = [...new Set(depois.lacunas.map((l) => l.split(' · ')[1]))];
  if (depois.lacunas.length === 0) console.log('  nenhuma');
  else {
    for (const d of lac) {
      const quantas = depois.lacunas.filter((l) => l.endsWith(`· ${d}`)).length;
      console.log(`  LACUNA  ${d.padEnd(12)} — ${quantas} intenção(ões) sem valor de referência`);
    }
    if (detalhar) for (const l of depois.lacunas) console.log(`          ${l}`);
  }

  if (detalhar) {
    console.log('\nDIVERGÊNCIAS QUE SOBRARAM (camada semântica)');
    for (const l of depois.familias) {
      if (l.divergencias.length === 0) continue;
      console.log(`\n  ${l.nome}`);
      for (const d of l.divergencias) console.log(`    ${d}`);
    }
  } else {
    console.log('\n(--detalhe lista cada divergência e cada lacuna)');
  }

  /**
   * SEM PORTÃO POR PADRÃO. Este comando MEDE; travar a entrega numa taxa que
   * ainda não foi discutida transformaria o número numa meta a ser batida, e o
   * jeito mais fácil de bater é afrouxar até tudo casar com tudo — que é o
   * defeito que `PARES_NEGATIVOS` existe para acusar.
   */
  const minimo = [...argumentos].find((a) => a.startsWith('--minimo='));
  if (minimo) {
    const alvo = Number(minimo.split('=')[1]);
    const obtido = (100 * depois.totalConv) / depois.totalCasos;
    console.log(`\nPORTÃO: ${obtido.toFixed(0)}% contra mínimo de ${alvo}%`);
    if (obtido < alvo) process.exit(1);
  }
  console.log('');
}

main();
