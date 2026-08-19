/**
 * OS DETECTORES — o que a IARA já observava, traduzido para ocorrência.
 *
 * Este arquivo é deliberadamente magro, e a magreza é a tese: **a camada
 * proativa não descobre nada por conta própria.** Ela recebe fatos de quem já
 * tinha permissão para colhê-los e decide o que fazer com eles. Um detector que
 * medisse a máquina sozinho seria um segundo caminho até o braço, ao lado do que
 * já existe e já é auditado.
 *
 * Cada função aqui é um ADAPTADOR: pega o fato na forma em que o produtor já o
 * emitia e o veste com o contrato de `Ocorrencia`. Nada é inventado no caminho —
 * severidade, número e assunto vêm todos do produtor. O adaptador não sabe
 * medir, não sabe pontuar e não sabe falar.
 *
 * A ORDEM DE ENTRADA DE UM DETECTOR NOVO, para quem vier depois:
 *
 *   1. o fato já é observado em algum lugar? Então o detector é um adaptador de
 *      dez linhas aqui, e mais nada;
 *   2. o fato ainda não é observado? Então o trabalho é no produtor — e o
 *      produtor passa pelas mesmas portas de sempre (permissão, jornal,
 *      fronteira). Não aqui.
 *
 * O que este arquivo NÃO tem, e a ausência é declarada: nenhum detector de fonte
 * externa. Notícia, regulamentação e mudança de terceiro exigem
 * `FONTE → BUSCA → VERIFICAÇÃO → NORMALIZAÇÃO`, com referência conferível em
 * cada ocorrência. Uma ocorrência de fonte externa sem esse caminho seria a IARA
 * afirmando sobre o mundo a partir de nada — o defeito exato que
 * `Ocorrencia.natureza` existe para tornar impossível. Ver o test-plan, seção
 * "Fora de escopo".
 */

import type { Aviso } from '../kernel/Vigia';

/**
 * O VIGIA — a medição da máquina do operador vira ocorrência.
 *
 * `natureza: 'observado'` porque é medição de verdade: o número saiu de
 * `SondasDesempenho` pelo braço, na máquina da pessoa. `confianca: 'alta'` pela
 * mesma razão, e só por ela — a confiança aqui é sobre O QUE FOI MEDIDO, nunca
 * sobre a causa. O vigia não investigou nada, e a frase composta adiante diz
 * exatamente isso.
 *
 * `acionavel: true` porque existe caminho: o operador pode pedir a investigação,
 * que roda pelo fluxo normal, iniciada por ele.
 *
 * A CHAVE DE DEDUPLICAÇÃO É O ASSUNTO + A SEVERIDADE, e não o texto. Duas
 * medições consecutivas de memória grave descrevem números diferentes ("87%",
 * "91%") e são o MESMO fato para quem precisa ser avisado. Deixar a chave sair
 * do texto faria cada leitura virar fato novo — e a novidade, que é o sinal que
 * segura a repetição, nunca cairia.
 */
export function ocorrenciaDoVigia(aviso: Aviso): Record<string, unknown> {
  return {
    tipo: 'operacao.anomalia',
    origem: 'vigia',
    assunto: aviso.assunto,
    rotulo: aviso.assunto.replace(/_/g, ' '),
    resumo: `Uma coisa que notei sem você perguntar: ${aviso.descricao}.`,
    evidencia: [`O normal seria ${aviso.faixa_normal}`],
    confianca: 'alta',
    severidade: aviso.severidade,
    natureza: 'observado',
    acionavel: true,
    chave_dedup: `vigia:${aviso.assunto}:${aviso.severidade}`,
    fontes: [
      {
        nome: 'medição local',
        referencia: `braco:medir_desempenho:${aviso.assunto}`,
        instante: Date.now(),
      },
    ],
  };
}
