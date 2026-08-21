/**
 * O PONTO VERDE NÃO PODE ACENDER SOZINHO.
 *
 * `app/globals.css` declara o contrato do sinal, em voz alta, logo acima da
 * classe:
 *
 *     "O ponto é REATIVO: verde só quando existe um socket vivo agora. Ele não
 *      respira, não pulsa e não tem animação de ambiente — dizer 'atendendo'
 *      sobre uma máquina desligada é exatamente a mistura que faz a tela
 *      mentir."
 *
 * É a mesma regra que abre o `CLAUDE.md`: *todo evento visual nasce de um fato
 * observado agora; se um objeto acende, é porque a capacidade correspondente
 * está em uso*.
 *
 * O DEFEITO QUE ESTE ARQUIVO FECHA foi visto pela operadora na tela, em
 * 20/08/2026, e as duas frases estavam no MESMO painel, a três linhas de
 * distância:
 *
 *     Status
 *       ○ Nenhum computador conectado agora
 *     O programa
 *       ● Instalada em Homeoffice — na versão atual
 *
 * A máquina estava desligada desde 16 de agosto. O ponto verde da segunda linha
 * era `className="maquina-sinal ligado"` escrito à mão — sem estado nenhum
 * atrás — porque ali ele queria dizer "instalada", e não "conectada". Duas
 * ideias no mesmo símbolo: quem lê a tela vê a luz, não a legenda.
 *
 * A conferência é ESTÁTICA de propósito. Um teste de navegador precisaria de
 * uma máquina pareada e desligada para reproduzir; este falha no segundo em que
 * alguém escrever o literal de novo, que é onde o defeito nasce.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.resolve(import.meta.dirname, '..');

function arquivosDeInterface(): string[] {
  const achados: string[] = [];
  const andar = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        andar(p);
      } else if (e.name.endsWith('.tsx')) {
        achados.push(p);
      }
    }
  };
  for (const raiz of ['components', 'app']) andar(path.join(RAIZ, raiz));
  return achados;
}

test('SN-01. nenhum componente acende o sinal de máquina por literal', () => {
  /**
   * O que é proibido é a CONSTANTE. `className={x.conectada ? '… ligado' : '…'}`
   * continua legítimo — ali a luz é consequência de um fato. O que não pode é
   * `className="maquina-sinal ligado"`, que acende sempre, inclusive sobre uma
   * máquina que ninguém viu desde a semana passada.
   */
  const literal = /className\s*=\s*["'][^"']*maquina-sinal[^"']*\bligado\b[^"']*["']/;
  const infratores: string[] = [];

  for (const arquivo of arquivosDeInterface()) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const [i, linha] of fonte.split(/\r?\n/).entries()) {
      if (literal.test(linha)) {
        infratores.push(`${path.relative(RAIZ, arquivo)}:${i + 1} → ${linha.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    infratores,
    [],
    'o sinal de máquina foi aceso por literal, sem estado atrás:\n' + infratores.join('\n'),
  );
});

test('SN-02. o contrato do sinal continua escrito no CSS', () => {
  /* Se alguém apagar o comentário que declara a regra, este teste cai junto —
     a regra e a explicação dela morrem no mesmo commit ou em nenhum. */
  const css = readFileSync(path.join(RAIZ, 'app', 'globals.css'), 'utf8');
  assert.ok(
    /verde só quando existe um socket vivo agora/i.test(css),
    'o contrato do ponto sumiu de globals.css',
  );
});

test('SN-03. painel flutuante com desfoque tem PISO opaco', () => {
  /**
   * "corrija o glass do menu, está impossível de ver" — operadora, 20/08/2026,
   * com a tela na frente.
   *
   * `.menu-perfil` tinha `background: var(--c-vidro-alto)` — branco a 5,5% — e
   * `backdrop-filter`. Sobre o fundo escuro da sala isso lê como um painel
   * discreto, que era o desenho. Mas o menu FLUTUA: o que passa por baixo dele
   * é o balão da conversa, o hero, um print colado. Fundo claro atrás, desfoque
   * clareia o painel, e o texto some dentro dele.
   *
   * Um vidro que herda a cor do que passa por baixo não tem contraste — tem
   * sorte. Medido depois do piso: 15,87:1.
   *
   * ================= O ESCOPO DA REGRA =================
   *
   * Só vale para painel FORA DO FLUXO (`position: absolute` ou `fixed`), e a
   * distinção não é técnica — é sobre o que passa por baixo.
   *
   * `.painel-presenca` e `.painel-conversa` também são vidro com desfoque, e
   * continuam sem piso DE PROPÓSITO: eles são filhos de layout (`flex: none`)
   * assentados sobre a sala, que é um fundo escuro conhecido e controlado. O
   * `CLAUDE.md` é explícito de que a sala aparecer através deles é a identidade
   * do produto. Dar piso a eles seria tapar a sala para resolver um problema
   * que eles não têm.
   *
   * O menu é outra coisa: ele é posicionado por cima do que estiver ali —
   * balão, hero, print colado. É o "arbitrário" que exige o chão.
   *
   * A primeira redação deste teste não fazia essa distinção e acusou os dois
   * painéis da sala. Um detector largo demais não protege nada: ele ensina a
   * próxima pessoa a ignorá-lo.
   */
  const css = readFileSync(path.join(RAIZ, 'app', 'globals.css'), 'utf8');

  /* Cada bloco que usa backdrop-filter, com o corpo da regra. */
  const blocos = [...css.matchAll(/([.#][\w-]+(?:[^{]*)?)\{([^}]*backdrop-filter[^}]*)\}/g)];
  assert.ok(blocos.length > 0, 'nenhum painel com backdrop-filter — a regra ficou sem sujeito');

  const semPiso: string[] = [];
  for (const [, seletor, corpo] of blocos) {
    /* Fora do fluxo? Só aí o fundo é imprevisível. */
    if (!/position:\s*(absolute|fixed)/.test(corpo)) continue;
    /* Piso = uma cor de fundo com alfa alto, ou sólida. `rgba(...,0.0x)`
       sozinho é vidro sem chão. */
    const fundos = [...corpo.matchAll(/background[^;]*;/g)].map((m) => m[0]);
    if (fundos.length === 0) continue; // sem fundo próprio: herda, e não flutua sozinho
    const texto = fundos.join(' ');
    const temOpaco =
      /rgba?\([^)]*,\s*0?\.[5-9]\d*\s*\)/.test(texto) ||
      /rgba?\([^)]*,\s*1\s*\)/.test(texto) ||
      /#[0-9a-f]{3,8}/i.test(texto) ||
      /var\(--c-fundo/.test(texto);
    if (!temOpaco) semPiso.push(`${seletor.trim()} → ${texto.slice(0, 80)}`);
  }

  assert.deepEqual(
    semPiso,
    [],
    'painel com desfoque e sem cor de base opaca — o contraste vai depender do que passar por baixo:\n' +
      semPiso.join('\n'),
  );
});
