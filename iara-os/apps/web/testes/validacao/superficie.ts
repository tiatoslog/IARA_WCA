/**
 * BATERIA — PORTÃO DE REGRESSÃO CONTÍNUA.
 *
 * É a lacuna que manteve a plataforma em L4: *"o que impede não é segurança, é
 * avaliação contínua — a campanha adversarial só roda quando alguém a chama."*
 * O risco real não é o sistema de hoje; é o de amanhã:
 *
 *     hoje funciona → alguém acrescenta uma habilidade → ela contorna a política
 *     → nenhuma bateria sabia que ela existia
 *
 * O que esta bateria faz é estreito e suficiente: ela conhece a SUPERFÍCIE
 * AVALIÁVEL — habilidades, integrações, portas de saída, provedores — e falha
 * quando a superfície muda sem que alguém declare a mudança. Não é uma opinião
 * sobre o que foi acrescentado: é a recusa de deixar entrar coisa que nenhuma
 * bateria viu.
 *
 * POR QUE A DECLARAÇÃO É UM ARQUIVO, e não um número no código: o `git diff` da
 * declaração é a evidência de que alguém olhou. Um contador embutido subiria com a
 * mão de quem acrescentou a habilidade — e seria assinado pela mesma pessoa que
 * precisava de revisão.
 *
 * O LIMITE, declarado: isto é PORTÃO, não GATILHO. Ele impede superfície nova sem
 * declaração; não roda campanha adversarial sozinho. Fica dentro de `npm test`
 * porque a suíte é a única coisa que roda todo dia aqui — em CI de verdade, o
 * gatilho seria o pipeline.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';
import { INTEGRACOES } from '../../servidor/nucleo/kernel/integracoes';
import { BATERIAS } from './registro';

const ARQUIVO_DECLARADO = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  'superficie-declarada.json',
);

/**
 * UMA LINHA POR ITEM, com os campos que MUDAM O RISCO — não com tudo.
 *
 * Assinatura da habilidade inclui risco, semântica e a existência de verificador,
 * porque são as três coisas que decidem por quais portas ela passa. O texto de
 * descrição fica fora: mexer na prosa de uma habilidade não pode reprovar a
 * suíte, ou o portão vira ruído e alguém o desliga.
 */
export interface Superficie {
  readonly habilidades: readonly string[];
  readonly integracoes: readonly string[];
  readonly baterias: readonly string[];
  /** Portas por onde texto sai do processo para uma pessoa. */
  readonly portas_de_saida: readonly string[];
}

/** As portas de saída são declaradas à mão porque não há registro delas no código. */
const PORTAS_DE_SAIDA: readonly string[] = [
  'socket:SessaoOperador.enviar',
  'whatsapp:entregarTexto',
  'jornal:RegistroOperacoes.gravar',
];

export function superficieAtual(): Superficie {
  return {
    habilidades: CATALOGO.map(
      (h) =>
        `${h.manifesto.id}|${h.manifesto.risco}|${h.manifesto.idempotencia}|` +
        `verificador=${typeof (h as { verificar?: unknown }).verificar === 'function'}`,
    ).sort(),
    integracoes: INTEGRACOES.map(
      (i) => `${i.id}|${i.risco}|${i.semantica}|verificador=${typeof i.verificar === 'function'}`,
    ).sort(),
    baterias: BATERIAS.map((b) => `${b.id}|obrigatoria=${b.obrigatoria}|critica=${b.critica}`).sort(),
    portas_de_saida: [...PORTAS_DE_SAIDA].sort(),
  };
}

export function superficieDeclarada(): Superficie {
  try {
    return JSON.parse(readFileSync(ARQUIVO_DECLARADO, 'utf8')) as Superficie;
  } catch {
    /* Declaração ausente NÃO é "nada mudou": é o portão sem referência, e o
       resultado tem de ser reprovação com instrução — não um verde por omissão. */
    return { habilidades: [], integracoes: [], baterias: [], portas_de_saida: [] };
  }
}

export interface DeltaSuperficie {
  readonly eixo: keyof Superficie;
  readonly entrou: readonly string[];
  readonly saiu: readonly string[];
}

export function compararSuperficie(
  atual: Superficie = superficieAtual(),
  declarada: Superficie = superficieDeclarada(),
): readonly DeltaSuperficie[] {
  const eixos: (keyof Superficie)[] = [
    'habilidades',
    'integracoes',
    'baterias',
    'portas_de_saida',
  ];
  return eixos
    .map((eixo) => ({
      eixo,
      entrou: atual[eixo].filter((x) => !declarada[eixo].includes(x)),
      saiu: declarada[eixo].filter((x) => !atual[eixo].includes(x)),
    }))
    .filter((d) => d.entrou.length > 0 || d.saiu.length > 0);
}

/**
 * As frases são instrução, não reclamação: quem vê isto vermelho precisa saber o
 * que fazer, e o que fazer NÃO é "atualizar o arquivo" — é rodar as baterias e
 * depois atualizar o arquivo.
 */
export function violacoesDeSuperficie(deltas: readonly DeltaSuperficie[]): readonly string[] {
  return deltas.flatMap((d) => [
    ...d.entrou.map(
      (x) =>
        `${d.eixo}: "${x}" entrou sem declaração — rode as baterias afetadas e depois ` +
        '`npm run superficie -- --aceitar`',
    ),
    ...d.saiu.map(
      (x) => `${d.eixo}: "${x}" saiu — se a remoção é intencional, aceite a superfície nova`,
    ),
  ]);
}

/** Grava a superfície atual como declarada. É o `--aceitar`, e deixa diff no git. */
export function aceitarSuperficie(): Superficie {
  const atual = superficieAtual();
  writeFileSync(ARQUIVO_DECLARADO, `${JSON.stringify(atual, null, 2)}\n`, 'utf8');
  return atual;
}
