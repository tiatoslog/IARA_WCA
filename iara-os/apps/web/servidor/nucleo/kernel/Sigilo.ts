/**
 * Portão de sigilo entre shards.
 *
 * POR QUE É UM MÓDULO SEPARADO, e não uma rota do reconhecedor de intenção:
 *
 * isto não decide o que o operador quer. Decide o que ele NÃO pode ter,
 * independentemente do que queira. É controle de acesso, e controle de acesso
 * que mora dentro de um classificador de intenção acaba sendo afrouxado junto
 * com ele, por alguém tentando melhorar a precisão de outra coisa.
 *
 * Vinha do `RoteadorIntencoes`, que foi dissolvido: aquele módulo calculava uma
 * rota completa (clima, banco, RAG, busca, agenda) da qual o kernel só lia o
 * campo `recusa_sigilo` — todo o resto era computado e descartado, duplicando
 * o reconhecimento que a `Percepcao` já fazia. Esta é a única parte que tinha
 * autoridade real, e é a única que sobreviveu.
 */

import { normalizar } from '../texto';

/**
 * Sondagem entre shards. Teste em DUAS partes, deliberadamente:
 *
 *   (o alvo é outra pessoa do time) E (verbo de sondagem OU coisa privada)
 *
 * Uma regex única não dá conta: "o que o Operador 3 falou" tem dígito no meio
 * do nome; "mostra as mensagens dele" não tem verbo; "quantas centrais o time
 * tem" tem alvo mas não é sondagem. Separar as duas dimensões acerta os três.
 */
const VERBO_SONDAGEM =
  /\b(falou|disse|escreveu|perguntou|reclamou|comentou|anotou|desabafou|conversou|respondeu|reportou|mandou|acha|pensa|avaliou)\b/;

const COISA_PRIVADA =
  /\b(conversa|conversas|mensagem|mensagens|historico|registro|registros|anotacao|anotacoes|nota|notas|desabafo|avaliacao|feedback|chat|prompt)\b/;

/**
 * Alvo humano EXPLÍCITO (operador, colega, equipe) e pronome anafórico são
 * dimensões separadas de propósito: "registro dele" numa frase sobre um erro
 * de banco se refere ao ERRO, não a uma pessoa. Pronome sozinho só vira alvo
 * quando não há assunto técnico por perto.
 */
const ALVO_HUMANO =
  /\b(operador|operadora|colega|usuario)\s*\d*\b|\boutr[oa] (operador|operadora|pessoa|usuario)\b|\b(os outros|as outras|o pessoal|a equipe|o time)\b/;

const PRONOME = /\b(ele|ela|eles|elas|dele|dela|deles|delas)\b/;

/** Assunto técnico: âncora de que o pronome se refere a coisa, não a gente. */
const ASSUNTO_TECNICO =
  /\b(erro|erros|bug|bugs|falha|falhas|problema|problemas|servidor|servidores|sistema|sistemas|banco|api|container|deploy|timeout|conexao|processo|script|relatorio)\b/;

export class PortaoSigilo {
  /** Nomes dos DEMAIS operadores. Quem está falando nunca entra na lista. */
  constructor(private readonly outros: readonly string[] = []) {}

  /** O pedido tenta alcançar o registro de outra pessoa? */
  ehSondagem(bruto: string): boolean {
    const t = normalizar(bruto);

    /**
     * Casa por PARTE do nome, não pelo nome inteiro.
     *
     * A versão anterior fazia `t.includes(normalizar(nome))` com o nome
     * completo. Funcionava nos testes porque o time de exemplo se chamava
     * "Operador 2" — uma string que aparece inteira na frase. Com nomes reais
     * ("Marina Alves"), "o que a Marina falou ontem?" NÃO contém a string
     * completa, e a sondagem passava direto pelo portão.
     *
     * Ninguém se refere a um colega pelo nome completo. O reconhecimento tem
     * que funcionar do jeito que as pessoas falam.
     *
     * O piso de 3 caracteres evita que partícula de nome ("de", "da", "dos")
     * transforme qualquer frase em sondagem.
     */
    const alvoNominal = this.outros.some((nome) =>
      normalizar(nome)
        .split(' ')
        .filter((parte) => parte.length > 2)
        .some((parte) => new RegExp(`\\b${parte}\\b`).test(t)),
    );

    // Alvo explícito (nome ou "operador 3", "a equipe"): qualquer verbo de
    // sondagem ou coisa privada confirma.
    if (alvoNominal || ALVO_HUMANO.test(t)) {
      return VERBO_SONDAGEM.test(t) || COISA_PRIVADA.test(t);
    }

    // Só pronome: "registro dele" numa frase sobre erro/servidor aponta para
    // a coisa, não para colega — deixa passar para o RAG responder. Sem
    // assunto técnico por perto, o pronome só pode ser gente: barra.
    if (PRONOME.test(t)) {
      if (VERBO_SONDAGEM.test(t)) return true;
      return COISA_PRIVADA.test(t) && !ASSUNTO_TECNICO.test(t);
    }

    return false;
  }
}
