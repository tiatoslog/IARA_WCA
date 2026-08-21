/**
 * Habilidades de calendário REAL (Google Calendar) — distintas do lembrete
 * interno (`habilidades/agenda.ts`, que continua existindo: ele nunca sai do
 * processo, este alcança um calendário de terceiro de verdade).
 *
 * Mesma separação leitura/escrita do `integracoes.ts`: `verAgendaCalendario`
 * é `risco: 'baixo'` e chama `ClienteGoogleCalendario` direto. Criar um
 * evento é `risco: 'alto'` (mesmo desenho R2 de `enviarWhatsapp`): esta
 * habilidade NUNCA cria nada — arma uma pendência e devolve o pedido de
 * confirmação; quem cria de fato é `resolver_confirmacao`, só depois do
 * MESMO operador dizer "confirmo" na MESMA conversa, dentro de 60s.
 *
 * `quando` recebe a FRASE do operador, nunca um ISO já resolvido — mesma
 * decisão de `agendar_lembrete`, e pela mesma razão: a LLM erra fuso, erra
 * ano, e erra em silêncio. `Quando.ts` é determinístico e devolve `null`
 * quando não sabe, e `null` vira pergunta, nunca palpite.
 */

import type { Habilidade } from '../Habilidade';
import { listarEventosCalendario, googleCalendarDisponivel } from '../../ClienteGoogleCalendario';
import { agenteLocal } from '../../AgenteLocal';
import { interpretarQuando } from '../Quando';

export const verAgendaCalendario: Habilidade = {
  manifesto: {
    id: 'ver_agenda_calendario',
    nome: 'Ver agenda',
    descricao:
      'Lista os próximos compromissos do calendário real (Google Calendar) do operador, num período de ' +
      'dias à frente. Use para "o que eu tenho hoje/essa semana", "quais são meus próximos compromissos", ' +
      '"tenho reunião amanhã".',
    exemplos: [
      'O que eu tenho essa semana?',
      'Quais são meus próximos compromissos?',
      'Tenho alguma reunião amanhã?',
    ],
    capacidades: ['listar eventos do calendário real'],
    /**
     * « Estou livre amanhã? » morria em conversa até 21/08/2026: ato certo,
     * período certo, e nenhuma palavra da frase existia neste manifesto.
     * `disponibilidade` é o conceito que faltava — e ele é declarado AQUI, e não
     * numa regra de código, porque senão os próximos seriam "vago", "sem
     * reunião", "posso marcar?", um `if` de cada vez.
     */
    conceitos: [
      { nome: 'agenda', termos: ['calendario', 'compromisso', 'evento', 'reuniao'] },
      { nome: 'disponibilidade', termos: ['livre', 'vago', 'ocupado', 'horario', 'disponivel'] },
    ],
    dominio: 'comunicacao',
    capacidade: 'conhecimento',
    permissoes: ['rede', 'memoria'],
    timeout_ms: 10000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      dias_a_frente: { tipo: 'numero', padrao: 7 },
    },
  },
  indisponivelPorque() {
    return googleCalendarDisponivel()
      ? null
      : 'falta GOOGLE_CALENDAR_CLIENT_EMAIL/GOOGLE_CALENDAR_PRIVATE_KEY/GOOGLE_CALENDAR_ID no ambiente';
  },
  async executar(ctx) {
    const dias = Number(ctx.parametros.dias_a_frente ?? 7);
    const r = await listarEventosCalendario(dias);
    return { texto: r.texto, detalhe: `Google Calendar: próximos ${dias} dia(s)`, resolveu: r.ok };
  },
  /**
   * Leitura verifica lendo de novo, não comparando com o passado — mesma
   * disciplina de `ler_emails`: o que se confere é "a fonte respondeu", não
   * "o número bate com uma expectativa que ninguém tinha".
   */
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'Google Calendar respondeu à consulta de eventos' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

/** Piso e teto de duração — 0 minuto e "a semana inteira" não são o que
 *  ninguém pede por engano; são o que uma frase mal interpretada produz. */
const DURACAO_MIN_MINUTOS = 5;
const DURACAO_MAX_MINUTOS = 8 * 60;

export const criarEventoCalendario: Habilidade = {
  manifesto: {
    id: 'criar_evento_calendario',
    nome: 'Criar evento no calendário',
    descricao:
      'Cria um evento real no Google Calendar do operador. NUNCA executa direto: registra uma pendência ' +
      'e pede confirmação explícita do operador, mesmo desenho de enviar_whatsapp. O parâmetro "quando" ' +
      'recebe a EXPRESSÃO DE TEMPO exatamente como foi dita ("amanhã às 14h", "sexta que vem às 10h") — ' +
      'não converta para data, quem interpreta é o motor. v1 não convida ninguém: o evento fica só no ' +
      'calendário do operador. Use para "marca uma reunião", "agenda um compromisso", "bota isso no calendário".',
    exemplos: [
      'Marca uma reunião com o financeiro amanhã às 14h',
      'Agenda uma consulta sexta às 10h, uma hora de duração',
      'Bota no calendário: dentista quinta-feira às 9h',
    ],
    capacidades: ['criar evento em calendário real'],
    /**
     * OS MESMOS CONCEITOS DE `ver_agenda_calendario`, DE PROPÓSITO — e é este
     * par que prova a regra da arquitetura.
     *
     * « Estou livre amanhã? » recupera `disponibilidade`, e `disponibilidade`
     * alcança as DUAS habilidades: ler a agenda e criar evento nela. A
     * similaridade é altíssima e está correta. O que separa as duas não é
     * conceito nenhum — é a OPERAÇÃO, `leitura` contra `criacao`, e é ela que
     * impede uma pergunta de virar um compromisso no calendário de quem só
     * queria saber se estava livre.
     *
     * Ver `IndiceConceitual.admissivel`: similaridade × compatibilidade, nunca
     * similaridade sozinha.
     */
    conceitos: [
      { nome: 'agenda', termos: ['calendario', 'compromisso', 'evento', 'reuniao'] },
      { nome: 'disponibilidade', termos: ['livre', 'vago', 'ocupado', 'horario', 'disponivel'] },
    ],
    dominio: 'comunicacao',
    capacidade: 'automacao',
    // `externo`, não `escrita`: o evento é visível fora do processo da IARA
    // (Outlook/Google/telefone), a mesma razão de `enviar_whatsapp` — por
    // isso não é concedida ao papel `operador` por padrão, ver `Seguranca.ts`.
    permissoes: ['rede', 'externo'],
    timeout_ms: 10000,
    custo: 'zero',
    risco: 'alto',
    // Pedir duas vezes cria duas pendências que CONVERGEM numa só (mesma
    // lógica de `enviar_whatsapp`: `armada ?? pendenteDe(...)`); o efeito em
    // si — o evento — nunca é criado duas vezes por um reenvio.
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      assunto: { tipo: 'texto', obrigatorio: true, max: 200 },
      quando: { tipo: 'texto', obrigatorio: true },
      duracao_minutos: { tipo: 'numero', padrao: 60 },
      local: { tipo: 'texto', max: 200 },
    },
  },
  indisponivelPorque() {
    return googleCalendarDisponivel()
      ? null
      : 'falta GOOGLE_CALENDAR_CLIENT_EMAIL/GOOGLE_CALENDAR_PRIVATE_KEY/GOOGLE_CALENDAR_ID no ambiente';
  },
  async executar(ctx) {
    const assunto = String(ctx.parametros.assunto ?? '').trim();
    const quandoBruto = String(ctx.parametros.quando ?? '').trim();
    const duracaoPedida = Number(ctx.parametros.duracao_minutos ?? 60);
    const local = String(ctx.parametros.local ?? '').trim();

    if (!assunto) {
      return {
        texto: 'Marco sim — só me diga o assunto do evento.',
        detalhe: 'assunto vazio; nada armado',
        resolveu: false,
      };
    }

    const instante = interpretarQuando(quandoBruto);
    if (!instante) {
      return {
        texto:
          `Não consegui entender "${quandoBruto}" como um horário, então não marquei nada. ` +
          'Entendo coisas como "amanhã às 14h", "sexta que vem às 10h" ou "em 2 horas".',
        detalhe: `expressão temporal não interpretada: "${quandoBruto.slice(0, 60)}"`,
        resolveu: false,
      };
    }

    const duracaoMin = Math.min(
      Math.max(Number.isFinite(duracaoPedida) ? duracaoPedida : 60, DURACAO_MIN_MINUTOS),
      DURACAO_MAX_MINUTOS,
    );
    const fim = new Date(instante.quando.getTime() + duracaoMin * 60_000);

    /**
     * MESMO PADRÃO DE `enviar_whatsapp`: a operação persistida vem ANTES do
     * interlock em memória, e `armada ?? pendenteDe(...)` deduplica pedido
     * repetido em vez de empilhar. Ver o comentário completo em
     * `integracoes.ts` (`enviarWhatsapp.executar`) — não repetido aqui
     * palavra por palavra para não divergir de lá com o tempo.
     */
    const armada = await ctx.registro.armar({
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      habilidade: 'criar_evento_calendario',
      risco: 'alto',
      semantica: 'escrita_nao_idempotente',
      parametros: { assunto, inicio: instante.quando.toISOString(), fim: fim.toISOString(), local },
      origem_pedido: ctx.operacao?.id_operacao ?? ctx.sessao,
    });
    const pendente = armada ?? ctx.registro.pendenteDe(ctx.id_usuario, ctx.sessao);

    if (!pendente) {
      return {
        texto:
          `Você já tem "${assunto}" aguardando confirmação em outra conversa. ` +
          'Confirme por lá — não armo o mesmo evento duas vezes.',
        detalhe: 'recusada: pendência idêntica em outro contexto',
        resolveu: false,
      };
    }

    return {
      texto: agenteLocal.pedirCriarEventoCalendario(
        ctx.id_usuario,
        assunto,
        instante.quando.toISOString(),
        fim.toISOString(),
        local,
        ctx.sessao,
        instante.rotulo,
      ),
      detalhe: `evento de calendário pendente de confirmação (${pendente.id_operacao})`,
      resolveu: true,
    };
  },
  /** O que esta habilidade PROMETE é registrar uma pendência — não criar o evento. */
  async verificar(_resultado, ctx) {
    return agenteLocal.temPendencia(ctx.id_usuario, ctx.sessao)
      ? { confirmado: true, evidencia: 'pendência registrada e dentro da janela de 60s' }
      : {
          confirmado: false,
          evidencia: 'nenhuma pendência ativa para este operador após a execução',
          motivo: 'divergente',
        };
  },
};

export const HABILIDADES_CALENDARIO: readonly Habilidade[] = [verAgendaCalendario, criarEventoCalendario];
