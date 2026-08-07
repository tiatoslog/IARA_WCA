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
import { normalizar } from '../RoteadorIntencoes';
import { TeoriaDaMente, type SinalTemporal } from '../TeoriaDaMente';

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
const ANCORAS: ReadonlyArray<{ re: RegExp; nome: string; acionavel: boolean }> = [
  { re: /\b(chuva|chover|chovendo|tempo|clima|temperatura|previsao)\b/, nome: 'clima', acionavel: true },
  {
    re: /\b(quantas centrais|centrais ativas|servidores ativos|frota|quantos veiculos)\b/,
    nome: 'infraestrutura',
    acionavel: true,
  },
  {
    re: /\b(esse erro|este erro|ja aconteceu|aconteceu antes|caiu de novo|mesmo problema)\b/,
    nome: 'incidente',
    acionavel: true,
  },
  { re: /\b(que horas|que dia e hoje|data de hoje)\b/, nome: 'relogio', acionavel: true },
  { re: /\b(pesquis|busca na internet|procura na web|noticia)\b/, nome: 'busca', acionavel: true },
  {
    re: /\b(resumo|resumir|analise|analisar|explica|explicar|compara)\b/,
    nome: 'analise',
    acionavel: false,
  },
];

export class MotorPercepcao {
  private readonly mente = new TeoriaDaMente();

  perceber(bruto: string): Percepcao {
    const t = normalizar(bruto);
    const temporal: SinalTemporal = this.mente.registrarChegada();
    const leitura: LeituraOperador = this.mente.analisar(bruto, temporal);

    const encontradas = ANCORAS.filter((a) => a.re.test(t));
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
    if (tipo === 'documento') return 'análise documental';
    if (tipo === 'saudacao') return 'abertura de conversa';
    if (tipo === 'comando') return 'execução de ação';
    return 'indeterminado';
  }
}
