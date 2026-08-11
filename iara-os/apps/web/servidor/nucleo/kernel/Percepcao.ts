/**
 * Motor de Percepção.
 *
 * A LLM nunca vê a mensagem crua primeiro — nem o planejador, nem a função
 * executiva. Todos veem uma `Percepcao`: tipo, urgência, objetivo provável,
 * estado do operador e as âncoras que o reconhecedor determinístico encontrou.
 *
 * Isso é o que separa "chatbot que recebe string" de "sistema que interpreta
 * entrada". E é barato: tudo aqui é regex e contagem, zero token.
 */

import type { LeituraOperador } from '../../../lib/estado';
import type { Percepcao, TipoEntrada, Urgencia } from './Evento';
import { normalizar } from '../texto';
import { TeoriaDaMente, type SinalTemporal } from '../TeoriaDaMente';
import { separarVozes, sobNegacao } from './Enunciacao';

const URGENTE =
  /\b(urgente|urgencia|agora|imediato|parou|caiu|travou|fora do ar|critico|emergencia|prejuizo)\b/;
const SAUDACAO = /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|tudo bem)\b/;
const COMANDO =
  /^(abre|abrir|roda|rodar|executa|executar|lista|listar|mostra|mostrar|gera|gerar|cria|criar|manda|enviar)\b/;
const DOCUMENTO = /\b(pdf|planilha|xlsx|csv|documento|contrato|anexo|arquivo|nota fiscal|cte|ct-e)\b/;

/**
 * Sinais que o reconhecedor determinístico encontra.
 *
 * `acionavel` distingue duas coisas que é fácil confundir — e confundir custa
 * caro: reconhecer a PALAVRA não é o mesmo que saber AGIR. "analise" é tema,
 * não plano; existe habilidade para clima, não para análise. Uma âncora
 * temática não pode inflar a confiança, senão a Função Executiva acha que
 * domina o assunto e deixa de pedir decomposição.
 */
/**
 * Contextos em que "tempo" NÃO é meteorologia. Sem esta trava, "quanto tempo
 * leva para gerar o relatório?" casava a âncora `clima`, virava plano
 * determinístico com confiança 0,92 e a IARA respondia a previsão do tempo —
 * com toda a segurança do mundo. O `RoteadorIntencoes` já tinha essa guarda; a
 * `Percepcao`, que é quem de fato decide a rota, não tinha. Duas camadas de
 * roteamento, uma corrigida e outra não: ver `testes/regressoes.test.ts`.
 */
const TEMPO_NAO_METEOROLOGICO =
  // O lookahead inicial faz a exceção CEDER quando há termo meteorológico
  // inequívoco na frase: "vai chover? quanto tempo até parar" é clima, apesar
  // do "quanto tempo". Só a palavra "tempo" sozinha é ambígua.
  /^(?!.*\b(chuva|chover|chovendo|clima|temperatura|previsao|calor|frio)\b).*(?:\b(quanto|ha quanto|em quanto|qualquer|algum|muito|pouco|todo|um)\s+tempo\b|\btempo\s+(de|para|pra|que|restante|estimado|medio|limite|habil|integral|real)\b|\bao mesmo tempo\b|\bperda de tempo\b)/;

interface Ancora {
  readonly re: RegExp;
  readonly nome: string;
  readonly acionavel: boolean;
  /** Casou `re`, mas casa isto também? Então não é esta âncora. */
  readonly exceto?: RegExp;
  /**
   * "não faça isto" significa NÃO FAÇA — e a âncora some.
   *
   * Vale para as âncoras que disparam receita de EFEITO (energia, pasta,
   * aplicativo): ali a negação inverte o pedido, e agir seria fazer o oposto do
   * que foi dito. NÃO vale para `confirmacao`, cuja receita já lê a polaridade
   * por conta própria (`ehAfirmacao`): remover a âncora ali quebraria "não
   * confirmo", que hoje cancela corretamente.
   */
  readonly negavel?: boolean;
}

const ANCORAS: ReadonlyArray<Ancora> = [
  {
    re: /\b(chuva|chover|chovendo|tempo|clima|temperatura|previsao)\b/,
    nome: 'clima',
    acionavel: true,
    exceto: TEMPO_NAO_METEOROLOGICO,
  },
  {
    /**
     * `frota` NUNCA sozinha.
     *
     * Todas as outras alternativas desta âncora são frases de contagem; `frota`
     * era a única palavra solta, e por isso capturava tudo que mencionasse a
     * frota por qualquer motivo. "Elabore uma estratégia de redução de custo
     * para a frota" virava plano determinístico e a IARA respondia quantas
     * centrais existem — resposta impecável para uma pergunta que ninguém fez.
     *
     * Mesma família do bug de "tempo": palavra genérica tratada como âncora
     * acionável. Ver `testes/mentira-operacional.test.ts`.
     */
    re: /\b(quantas centrais|centrais ativas|servidores ativos|quantos veiculos)\b|\b(quantos?|quantas?|tamanho da|status da|total da|composicao da)\s+(veiculos na\s+)?frota\b|\bfrota\s+(ativa|total|atual|disponivel)\b/,
    nome: 'infraestrutura',
    acionavel: true,
  },
  {
    re: /\b(esse erro|este erro|ja aconteceu|aconteceu antes|caiu de novo|mesmo problema)\b/,
    nome: 'incidente',
    acionavel: true,
  },
  { re: /\b(que horas|que dia e hoje|data de hoje)\b/, nome: 'relogio', acionavel: true },
  {
    // `pesquis\w*`, não `pesquis\b`: o \b depois de um prefixo exige não-letra
    // em seguida, então "pesquise" e "pesquisa" nunca casavam — a âncora só
    // funcionava para a palavra "pesquis", que ninguém digita. Mesmo motivo
    // para `noticia\w*` ("notícias" no plural). O `RoteadorIntencoes` já tinha
    // essa correção; esta cópia da regra não.
    re: /\b(pesquis\w*|busca na internet|procura na web|noticia\w*)\b/,
    nome: 'busca',
    acionavel: true,
  },
  {
    re: /\b(resum\w*|analis\w*|explic\w*|compar\w*)\b/,
    nome: 'analise',
    acionavel: false,
  },
  // Agente Local. O vocabulário abaixo é o mesmo que `Planejador.extrairNomePasta`,
  // `extrairLocalAutorizado` e `extrairAcaoEnergia` sabem interpretar — reconhecer
  // aqui o que o planejador não sabe extrair produziria âncora sem plano.
  {
    re: /\b(cri[ae]|criar|nova)\s+(uma\s+)?pasta\b|\bpasta\s+(chamada|nomeada|com o nome)\b/,
    nome: 'pasta',
    acionavel: true,
    negavel: true,
  },
  {
    re: /\b(abra|abre|abrir|inicie|iniciar)\s+(o|a|os|as)?\s*(bloco de notas|calculadora|navegador|explorador|terminal|prompt|aplicativo|programa)\b/,
    nome: 'abrir_app',
    acionavel: true,
    negavel: true,
  },
  {
    re: /\b(desligue|desliga|desligar|reinicie|reinicia|reiniciar|suspenda|suspender|hiberne|hibernar)\b/,
    nome: 'energia',
    acionavel: true,
    negavel: true,
  },
  {
    re: /\b(confirmo|confirmado|confirmar|prossiga|cancela|cancelar|cancelado|abortar)\b/,
    nome: 'confirmacao',
    acionavel: true,
  },
];

export class MotorPercepcao {
  private readonly mente = new TeoriaDaMente();

  perceber(bruto: string): Percepcao {
    const temporal: SinalTemporal = this.mente.registrarChegada();
    const leitura: LeituraOperador = this.mente.analisar(bruto, temporal);

    /**
     * A VOZ VEM ANTES DA ÂNCORA.
     *
     * Âncora procurada na frase inteira não distingue "desligue o computador"
     * de "o e-mail diz: desligue o computador" — e a segunda armava uma
     * pendência de risco alto por causa de uma frase que o operador só estava
     * mostrando. O reconhecimento roda sobre a voz PRÓPRIA; o que ele atribuiu
     * a terceiro fica de fora do gatilho e sobrevive em `bruto` para o
     * raciocínio comentar.
     *
     * A classificação de tipo e a medição de urgência continuam olhando a frase
     * inteira: um e-mail citado dizendo "o sistema caiu" é urgente de verdade,
     * mesmo não sendo um comando.
     */
    const vozes = separarVozes(bruto);
    const t = normalizar(bruto);
    const tPropria = vozes.temRelato ? normalizar(vozes.propria) : t;

    const encontradas = ANCORAS.filter((a) => {
      const m = tPropria.match(a.re);
      if (!m || m.index === undefined) return false;
      if (a.exceto?.test(tPropria)) return false;
      // "não desligue o computador" não é um pedido de desligamento. É o
      // oposto exato dele, e agir seria fazer o contrário do que foi dito.
      if (a.negavel && sobNegacao(tPropria, m.index)) return false;
      return true;
    });
    const ancoras = encontradas.map((a) => a.nome);
    const acionaveis = encontradas.filter((a) => a.acionavel).length;
    const tipo = this.classificar(t, bruto);
    const urgencia = this.medirUrgencia(t, leitura);

    return {
      bruto,
      tipo,
      urgencia,
      idioma: 'pt-BR',
      objetivo_provavel: this.supor(tipo, ancoras),
      leitura,
      // Confiança = "sei agir sobre isto", não "reconheci uma palavra".
      // Só âncora acionável sobe o número; âncora temática fica no meio do
      // caminho, que é exatamente o que ela é.
      confianca:
        acionaveis > 0 ? 0.92 : tipo === 'saudacao' ? 0.85 : ancoras.length > 0 ? 0.5 : 0.35,
      ancoras,
      citado: vozes.relatada,
    };
  }

  private classificar(t: string, bruto: string): TipoEntrada {
    if (SAUDACAO.test(t) && bruto.length < 40) return 'saudacao';
    if (DOCUMENTO.test(t)) return 'documento';
    if (COMANDO.test(t)) return 'comando';
    return 'texto';
  }

  private medirUrgencia(t: string, leitura: LeituraOperador): Urgencia {
    if (URGENTE.test(t)) return 'alta';
    if (leitura.estado === 'frustrado' || leitura.estado === 'estressado') return 'alta';
    if (leitura.estado === 'produtivo' || leitura.estado === 'focado') return 'normal';
    return 'normal';
  }

  private supor(tipo: TipoEntrada, ancoras: readonly string[]): string {
    if (ancoras.includes('incidente')) return 'retrospectiva de incidente';
    if (ancoras.includes('infraestrutura')) return 'consulta operacional';
    if (ancoras.includes('clima')) return 'condição externa';
    if (ancoras.includes('relogio')) return 'referência temporal';
    if (ancoras.includes('busca')) return 'levantamento factual';
    if (ancoras.includes('analise')) return 'análise';
    if (ancoras.includes('confirmacao')) return 'resolução de ação pendente';
    if (ancoras.includes('pasta')) return 'organização de arquivos';
    if (ancoras.includes('abrir_app')) return 'abertura de aplicativo';
    if (ancoras.includes('energia')) return 'controle de energia da máquina';
    if (tipo === 'documento') return 'análise documental';
    if (tipo === 'saudacao') return 'abertura de conversa';
    if (tipo === 'comando') return 'execução de ação';
    return 'indeterminado';
  }
}
