/**
 * NENHUMA HABILIDADE INACESSÍVEL — e nenhuma acessível por acidente.
 *
 * O DEFEITO (Arnês C, 21/08/2026). A trava de compatibilidade lia a operação de
 * uma habilidade do PREFIXO DO ID. Acerta em 45 de 47, porque o CLAUDE.md
 * obriga `verbo_objeto` — e falha em silêncio nas outras duas:
 *
 *     « como está o PC agora? »  →  informacoes_sistema INCOMPATÍVEL
 *
 * `informacoes_sistema` começa por substantivo, a inferência devolvia `null`, e
 * a trava recusava a habilidade por não conseguir classificá-la. Uma trava que
 * não sabe classificar barra o inocente, e o sintoma aparece longe da causa: a
 * habilidade certa some da lista sem explicação.
 *
 * ESTE ARQUIVO É O PORTÃO DO CATÁLOGO. Ele não olha frase nenhuma — olha se
 * cada habilidade registrada está em condição de ser encontrada, admitida e
 * escolhida. Existência no registro não é funcionalidade.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { auditarCatalogo } from '../invariancia/auditoriaCatalogo';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const aud = auditarCatalogo();
const MANIFESTOS = CATALOGO.map((h) => h.manifesto);

test('nenhuma habilidade fica sem operação legível', () => {
  /**
   * O PORTÃO. Habilidade cuja operação nem é declarada nem é inferível é
   * habilidade que a trava de compatibilidade RECUSA — inacessível na prática,
   * por mais bem escrita que esteja.
   *
   * A correção é declarar `operacao_semantica` no manifesto. Não existe exceção
   * aceitável aqui: uma lista de isentas seria a própria trava se recusando a
   * medir o que ela mesma barra.
   */
  assert.deepEqual(
    aud.ausentes,
    [],
    `habilidades sem operação legível: ${aud.ausentes.join(', ')}.\n` +
      `    Declare \`operacao_semantica\` no manifesto — o \`id\` não diz o que elas fazem.`,
  );
});

test('nenhuma habilidade declara uma operação e nomeia outra', () => {
  /**
   * Conflito não é erro automático — a declaração vence a inferência, por
   * projeto. Mas é sempre suspeito: ou o nome mente sobre o que a habilidade
   * faz, ou a declaração está errada. Os dois merecem ser vistos por gente.
   */
  assert.deepEqual(aud.conflitantes, [], `declaração e id discordam: ${aud.conflitantes.join('; ')}`);
});

test('toda habilidade do catálogo é alcançável pelos próprios exemplos', () => {
  /**
   * O TESTE DE ACESSIBILIDADE REAL, e ele é mais duro que "tem manifesto".
   *
   * Cada habilidade declara `exemplos` — frases de operador que DEVEM alcançá-la.
   * Se a própria frase que o autor escreveu como exemplo não recupera a
   * habilidade, ela nasceu inalcançável e nenhum teste de existência acusa isso.
   *
   * A régua é a descoberta, não o objetivo final: exemplo tem de produzir a
   * habilidade entre os CANDIDATOS. Qual delas vence é decisão de ranqueamento,
   * e habilidades irmãs disputam legitimamente.
   */
  const descoberta = new DescobertaCapacidades(MANIFESTOS);
  const mudas: string[] = [];

  for (const m of MANIFESTOS) {
    const exemplos = m.exemplos ?? [];
    if (exemplos.length === 0) continue;
    const alcancam = exemplos.filter((e) =>
      descoberta.descobrirCandidatos(e).some((c) => c.habilidade === m.id),
    );
    if (alcancam.length === 0) mudas.push(`${m.id} (${exemplos.length} exemplo[s], nenhum alcança)`);
  }

  assert.deepEqual(
    mudas,
    [],
    `habilidades que os próprios exemplos não alcançam:\n    ${mudas.join('\n    ')}`,
  );
});

test('conceito declarado alcança de fato a habilidade que o declarou', () => {
  /**
   * Declarar um conceito e não ser recuperável por ele é pior que não declarar:
   * cria a impressão de cobertura sem a cobertura. Cada termo declarado tem de
   * levar de volta à habilidade que o escreveu.
   */
  const conceitual = new IndiceConceitual(MANIFESTOS);
  const quebrados: string[] = [];

  for (const m of MANIFESTOS) {
    for (const c of m.conceitos ?? []) {
      for (const termo of [c.nome, ...c.termos]) {
        const achou = conceitual.recuperar(termo).some((r) => r.capacidades.includes(m.id));
        if (!achou) quebrados.push(`${m.id} declara "${termo}" e não é recuperada por ele`);
      }
    }
  }

  assert.deepEqual(quebrados, [], quebrados.join('\n    '));
});

test('a auditoria publica números, não um veredito', () => {
  /**
   * A METADE QUE IMPEDE ESTE ARQUIVO DE VIRAR TEATRO. Os testes acima são
   * portões — passam ou falham. A auditoria é MEDIDA, e o que ela mede hoje é
   * uma lacuna real que ninguém deve poder esquecer:
   *
   *   37 de 47 habilidades não declaram conceito nem entidade.
   *
   * Elas funcionam — são alcançáveis pelas palavras exatas do manifesto — e não
   * têm rede: nenhuma tolerância a sinônimo ou a erro de digitação. Não é
   * defeito; é dívida declarada, e é ela que explica a maior parte das falhas
   * de compreensão que o Arnês C ainda mede.
   *
   * O teste trava a FORMA da auditoria, não o número: se alguém remover a
   * contagem, isto fica vermelho.
   */
  assert.equal(aud.total, MANIFESTOS.length);
  assert.equal(aud.explicitas + aud.inferidas + aud.ausentes.length, aud.total);
  assert.ok(aud.semConceitos.length > 0, 'se um dia isto for zero, apague este teste e comemore');
});
