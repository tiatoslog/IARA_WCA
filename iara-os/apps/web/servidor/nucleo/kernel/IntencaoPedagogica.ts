/**
 * O que o operador está PEDINDO PEDAGOGICAMENTE — determinístico e puro.
 *
 * IRMÃO DE `IntencaoProcedimento.ts`, e a divisão entre os dois é de eixo, não
 * de tamanho:
 *
 *   `IntencaoProcedimento`  a resposta é a SEQUÊNCIA ou o PONTO?   (`localizar`/`executar`)
 *   este arquivo            a IARA ENSINA, PERGUNTA, DIAGNOSTICA ou RETOMA?
 *
 * As duas perguntas são ortogonais: "me ensina a encerrar o manifesto" pede a
 * sequência E pede ensino; "onde clico" pede o ponto E é uma dúvida de
 * localização. Fundir os dois eixos num enum só produziria valores como
 * `executar_ensinando` — e o terceiro caso que não coubesse viraria um `outro`.
 *
 * POR QUE ISTO NÃO PODE DEPENDER DA LLM. Se o modo pedagógico viesse de um campo
 * que a camada de raciocínio preenche, "deu erro" poderia chegar como `execucao`
 * e o guardião responderia *"ninguém me confirmou que ela foi feita"* a quem
 * acabou de relatar um problema. É o mesmo princípio de `classificarIntencao`: a
 * LLM pode passar o parâmetro, mas o caminho determinístico decide quando
 * reconhece a frase.
 *
 * O VOCABULÁRIO É IMPORTADO, nunca copiado. `Percepcao.ts` já pagou uma vez por
 * uma cópia de regra que não recebeu a correção da original.
 */

import { normalizar } from '../texto';
/* HESITACAO mora no GUARDIÃO, não aqui: "acho que fiz" é uma afirmação sobre
   EVIDÊNCIA, e evidência é da camada operacional. Este módulo a importa para
   escolher o modo; copiá-la seria a segunda fonte que diverge da primeira. */
import { HESITACAO } from './GuardiaoDoProcedimento';
import type { ModoPedagogico, TipoDeDificuldade } from '../../../lib/treinamento';

/**
 * "Continua de onde paramos" — a única família que fala do PASSADO.
 *
 * Primeira da ordem porque é a mais específica e a que mais sofre roubo: "parei
 * ontem, continua" tem `continua`, que é declaração de conclusão em
 * `GuardiaoDoProcedimento.DECLARA_CONCLUSAO`. Sem esta precedência, retomar um
 * treinamento avançaria uma etapa.
 */
export const PEDE_RETOMADA =
  /\b(continu\w+\s+(?:de\s+onde|dali|o\s+treinamento|meu\s+treinamento|do\s+ponto)|de\s+onde\s+paramos|onde\s+(?:eu\s+)?parei|retomar?\s+(?:o\s+)?(?:treinamento|procedimento)|voltar?\s+ao\s+treinamento|parei\s+(?:ontem|antes|na\s+etapa)|em\s+que\s+etapa\s+(?:eu\s+)?(?:estou|parei))\b/;

/** "Me testa" — avaliação pedida com todas as letras. */
export const PEDE_AVALIACAO =
  /\b(me\s+test\w+|quero\s+(?:ser\s+)?(?:testad\w+|avaliad\w+)|me\s+avali\w+|faz\s+um\s+teste|me\s+pergunt\w+|quer[oa]\s+ver\s+se\s+(?:eu\s+)?aprendi|testa\s+meu?\s+conhecimento|simulad\w+)\b/;

/** "Quero praticar" — a pessoa pede para tentar antes de ser ensinada. */
export const PEDE_PRATICA =
  /\b(quero\s+pratic\w+|vamos\s+pratic\w+|pratic\w+\s+comigo|(?:me\s+)?deixa\s+(?:eu\s+)?tentar|deixe?\s+eu\s+tentar|(?:me\s+)?deixa\s+fazer\s+sozinh\w+|quero\s+tentar\s+sozinh\w+|sem\s+me\s+dar\s+a\s+resposta)\b/;

/**
 * O OPERADOR CONTESTA O PROCEDIMENTO — a família mais delicada do arquivo.
 *
 * Não é dúvida nem erro: é uma afirmação sobre o DOCUMENTO, vinda de alguém que
 * está na operação e pode muito bem estar certo. A IARA não tem como decidir
 * quem tem razão — e é exatamente por isso que o caso precisa de classificação
 * própria em vez de cair em `duvida`, onde a resposta seria reexplicar o POP
 * para quem acabou de dizer que ele não bate com a realidade.
 */
export const CONTESTA_O_POP =
  /\b(o\s+pop\s+(?:esta|ta)\s+(?:errad\w+|desatualizad\w+|furad\w+)|esse\s+pop\s+(?:esta|ta)\s+errad\w+|(?:isso|isto)\s+(?:nao|n)\s+(?:esta|ta)\s+no\s+pop|nao\s+(?:esta|ta)\s+no\s+pop|(?:meu\s+)?colega\w*\s+(?:mand\w+|fal\w+|faz|dis\w+)|(?:aqui|a\s+gente|nos)\s+(?:faz|fazemos)\s+diferente|fazem\s+diferente|(?:o\s+)?procedimento\s+(?:esta|ta)\s+errad\w+|na\s+pratica\s+(?:e|nao\s+e)\s+(?:assim|diferente))\b/;

/**
 * "Não aparece esse botão" — o POP afirma que existe, a pessoa afirma que não.
 *
 * Separado de `RELATA_ERRO` porque a resposta é outra. Aqui não houve mensagem
 * de sistema nenhuma: há um conflito entre duas afirmações, e a IARA só pode
 * nomeá-lo. Responder "tente de novo" a isto é fingir que o conflito não existe.
 */
export const ELEMENTO_AUSENTE =
  /\b(nao\s+(?:aparece|apareceu|tem|existe|vejo|to\s+vendo|estou\s+vendo)\s+(?:ess[ea]|est[ea]|o|a|nenhum\w*)?\s*(?:bot[ao]\w*|campo|op[cç][ao]\w*|aba|menu|coluna|tela|link|icone)|(?:ess[ea]|est[ea])\s+(?:bot[ao]\w*|campo|op[cç][ao]\w*|aba|menu)\s+nao\s+(?:aparece|existe|tem)|nao\s+aparece\s+(?:isso|nada|essa\s+op[cç][ao]\w*))\b/;

/** O sistema respondeu algo. Relato, nunca diagnóstico do que aconteceu. */
export const RELATA_ERRO =
  /\b(deu\s+(?:erro|pau|ruim|problema)|apareceu\s+(?:uma?\s+)?(?:mensagem|erro|aviso|alerta|janela)|mensagem\s+de\s+erro|erro\s+(?:ao|na|no|de)\b|nao\s+(?:funcionou|foi|deixa|deixou|permite|permitiu|carreg\w+|salv\w+|grav\w+)|trav\w+|congel\w+|fica\s+carregando|caiu\s+o\s+sistema|deu\s+isso\s+aqui)\b/;

/** O print não serve — e quem diz é o operador, não a conferência. */
export const PRINT_RUIM =
  /\b(o?\s*print\s+(?:esta|ta)\s+(?:ruim|borrad\w+|cortad\w+|ilegivel)|(?:o\s+)?print\s+(?:e|era)\s+de\s+outra\s+tela|mandei\s+o\s+print\s+errad\w+|a\s+(?:foto|imagem)\s+(?:esta|ta)\s+ruim)\b/;

/** "Me ensina", "nunca fiz isso" — pede aprendizado, não localização. */
export const PEDE_ENSINO =
  /\b(me\s+(?:ensin\w+|treina|capacit\w+)|quero\s+aprender|nunca\s+(?:fiz|mexi|usei|trabalhei)|primeira\s+vez\s+que|sou\s+nov\w+\s+(?:aqui|nisso|na\s+empresa)|nao\s+sei\s+(?:fazer|nada\s+disso)|vamos\s+fazer\s+junt\w+|faz\s+comigo|me\s+acompanh\w+|do\s+zero|me\s+guie|me\s+guia)\b/;

/** "Não entendi", "o que é", "por que" — pede conceito, não passo. */
export const PEDE_CONCEITO =
  /\b(nao\s+entendi|nao\s+compreendi|nao\s+ficou\s+clar\w+|o\s+que\s+(?:e|significa|quer\s+dizer)\b|pra\s+que\s+serve|para\s+que\s+serve|por\s*que\s+(?:eu\s+)?(?:faco|fazer|preciso|devo|tenho)|qual\s+(?:o\s+)?(?:motivo|objetivo|sentido)|explica\s+(?:melhor|de\s+novo|isso)|me\s+explica\b)\b/;

/** "Onde fica", "não acho" — sabe o que fazer, não sabe onde. */
export const PEDE_LOCALIZACAO_PEDAGOGICA =
  /\b(onde\s+(?:clico|clicar|fica|esta|acho|encontro|preencho|e\s+isso|que\s+e)|nao\s+(?:acho|encontro|localizo)|cade\s+|em\s+que\s+(?:tela|aba|menu))\b/;

/** "Posso pular", "preciso fazer isso mesmo" — questiona a sequência. */
export const QUESTIONA_SEQUENCIA =
  /\b(posso\s+pul\w+|da\s+pra\s+pul\w+|precisa\s+mesmo|e\s+obrigatori\w+|posso\s+(?:fazer\s+)?depois|tem\s+como\s+(?:pul\w+|abrevi\w+))\b/;

/** "Qual procedimento é", "estou fazendo dois" — não sabe onde está. */
export const PERDIDO_NO_ESCOPO =
  /\b(nao\s+sei\s+qual\s+(?:pop|procedimento)|qual\s+procedimento\s+(?:e|eu\s+uso)|(?:estou|to)\s+fazendo\s+dois|dois\s+procedimentos|qual\s+dos\s+pops)\b/;

/**
 * "Responde isso e depois continua" — a digressão ANUNCIADA.
 *
 * Vale a pena reconhecer separado porque é a frase que prova o requisito de
 * contexto: a pessoa está dizendo, explicitamente, que a pergunta é um desvio e
 * que o treinamento continua. A resposta precisa fazer as duas coisas.
 */
export const DIGRESSAO_ANUNCIADA =
  /\b(responde?\s+(?:isso|essa|uma)\s*\w*\s*(?:e\s+)?(?:depois|dai)\s+(?:continu\w+|volt\w+|seguimos)|antes\s+de\s+continuar|so\s+uma\s+(?:duvida|pergunta)|pergunta\s+rapida)\b/;

export interface LeituraPedagogica {
  readonly modo: ModoPedagogico;
  /** `null` quando a fala não relata dificuldade nenhuma. */
  readonly dificuldade: TipoDeDificuldade | null;
  /** A pessoa avisou que isto é um desvio e que o treinamento continua. */
  readonly digressao: boolean;
}

/**
 * A ORDEM DAS PERGUNTAS É A REGRA, e ela vai da afirmação mais forte para a
 * mais fraca.
 *
 * Retomada antes de tudo porque `continua` também é declaração de conclusão.
 * Contestação antes de dúvida porque quem diz que o POP está errado não está
 * pedindo para o POP ser reexplicado. Hesitação antes de execução porque "acho
 * que fiz" contém "fiz". Cada precedência aqui existe por causa de uma frase
 * concreta que sem ela iria para o lugar errado — nenhuma é estética.
 */
export function classificarPedagogica(bruto: string): LeituraPedagogica {
  const t = normalizar(bruto ?? '');
  const digressao = DIGRESSAO_ANUNCIADA.test(t);

  if (PEDE_RETOMADA.test(t)) return { modo: 'retomada', dificuldade: null, digressao };
  if (PEDE_AVALIACAO.test(t)) return { modo: 'avaliacao', dificuldade: null, digressao };
  if (PEDE_PRATICA.test(t)) return { modo: 'pratica', dificuldade: null, digressao };

  if (CONTESTA_O_POP.test(t)) {
    return { modo: 'diagnostico', dificuldade: 'possivel_divergencia_do_pop', digressao };
  }
  if (ELEMENTO_AUSENTE.test(t)) {
    return { modo: 'diagnostico', dificuldade: 'elemento_nao_encontrado', digressao };
  }
  if (PRINT_RUIM.test(t)) {
    return { modo: 'diagnostico', dificuldade: 'evidencia_insuficiente', digressao };
  }
  if (RELATA_ERRO.test(t)) {
    return { modo: 'diagnostico', dificuldade: 'erro_de_sistema', digressao };
  }

  /* HESITAÇÃO É `execucao`, não `diagnostico`: a pessoa está no meio do
     procedimento e tentou reportar. O que muda é a EVIDÊNCIA, e quem decide
     isso é o guardião — este módulo só marca que houve hesitação, para o
     progresso registrar a dificuldade e a resposta dizer o que falta. */
  if (HESITACAO.test(t)) {
    return { modo: 'execucao', dificuldade: 'evidencia_insuficiente', digressao };
  }

  if (PERDIDO_NO_ESCOPO.test(t)) return { modo: 'duvida', dificuldade: null, digressao };
  if (QUESTIONA_SEQUENCIA.test(t)) return { modo: 'duvida', dificuldade: null, digressao };
  if (PEDE_CONCEITO.test(t)) {
    return { modo: 'duvida', dificuldade: 'duvida_conceitual', digressao };
  }
  if (PEDE_LOCALIZACAO_PEDAGOGICA.test(t)) {
    return { modo: 'duvida', dificuldade: 'duvida_de_localizacao', digressao };
  }

  if (PEDE_ENSINO.test(t)) return { modo: 'ensino', dificuldade: null, digressao };

  /* O PADRÃO É `consulta`, e o lado seguro é esse: consulta responde com o POP
     e com fonte, sem assumir que alguém está aprendendo nem que alguém está
     executando. Assumir `execucao` por omissão seria deixar a porta do avanço
     mais perto de quem não pediu para avançar. */
  return { modo: 'consulta', dificuldade: null, digressao };
}
