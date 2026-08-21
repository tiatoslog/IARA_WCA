/**
 * Habilidades de agenda — marcar, listar e cancelar lembretes.
 *
 * A PONTE entre o catálogo e a `Agenda`, no mesmo desenho de
 * `habilidades/agenteLocal.ts`: nenhuma regra mora aqui. O teto de 50
 * pendentes, o isolamento por shard e a recusa de cancelar no ambíguo são da
 * `Agenda`; este arquivo declara esquema, permissão, risco e timeout.
 *
 * A DECISÃO QUE MERECE EXPLICAÇÃO É O `quando`.
 *
 * O esquema recebe a FRASE do operador ("amanhã às 9", "em 20 minutos"), não um
 * ISO 8601 — e a interpretação roda aqui, em `Quando.ts`, que é determinístico.
 * A alternativa era deixar a LLM emitir a data já resolvida. Ela erra fuso, erra
 * ano, e erra em silêncio: um lembrete para 2025 é aceito pelo esquema, some da
 * lista de pendentes por já ter vencido, e nunca toca. Regex que não entende a
 * frase devolve `null` e a IARA pergunta — que é o modo de falha barato.
 *
 * É o mesmo princípio de `criar_pasta`, onde o nome vem do `Planejador` e não
 * de um campo que a LLM preencheu: a IA propõe, o determinístico resolve.
 */

import type { Habilidade } from '../Habilidade';
import { agenda } from '../../Agenda';
import { interpretarQuando } from '../Quando';
import { contar } from '../../texto';

/** Formato falado, no fuso da máquina. `toISOString` diria a verdade em UTC —
 *  o que, para quem lê, é uma hora errada com aparência de precisão. */
function porExtenso(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const agendarLembrete: Habilidade = {
  manifesto: {
    id: 'agendar_lembrete',
    nome: 'Agendar lembrete',
    descricao:
      'Marca um lembrete para o operador e o anuncia quando a hora chegar. O parâmetro "quando" ' +
      'recebe a EXPRESSÃO DE TEMPO exatamente como ela foi dita ("amanhã às 9", "em 20 minutos", ' +
      '"hoje às 15h30") — não converta para data, quem interpreta é o motor. Use para ' +
      '"me lembre de X", "não me deixe esquecer de Y".',
    exemplos: [
      'Me lembre de ligar para o cliente em 20 minutos',
      'Não me deixe esquecer da reunião amanhã às 9',
    ],
    capacidades: ['marcar lembrete com horário'],
    /** O verbo de criar lembrete é "lembrar"; o substantivo é o conceito. */
    conceitos: [{ nome: 'lembrete', termos: ['alarme', 'aviso'] }],
    dominio: 'memoria',
    capacidade: 'memoria',
    // `memoria`, não `escrita`: o lembrete mora no shard privado do operador,
    // não no disco dele. `escrita` é a permissão do Agente Local, e emprestá-la
    // aqui daria a esta habilidade um alcance que ela não tem nem precisa.
    permissoes: ['memoria'],
    timeout_ms: 6000,
    custo: 'zero',
    risco: 'medio',
    // Pedir duas vezes cria dois lembretes, e é o certo: quem repete "me lembre
    // às 15h" depois de já ter marcado provavelmente quer os dois avisos.
    // Convergir aqui seria decidir por ele.
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      assunto: { tipo: 'texto', obrigatorio: true },
      quando: { tipo: 'texto', obrigatorio: true },
    },
  },

  async executar(ctx) {
    const assunto = String(ctx.parametros.assunto).trim();
    const frase = String(ctx.parametros.quando);
    const instante = interpretarQuando(frase);

    /**
     * As duas recusas vêm ANTES de qualquer gravação, e nenhuma delas é erro.
     * `resolveu: false` com texto útil é o contrato para "não resolvi e sei
     * dizer por quê" — a exceção fica para o que o sistema não previu.
     */
    if (!assunto) {
      return {
        texto: 'Marco sim — só me diga do que você quer ser lembrado.',
        detalhe: 'assunto vazio; nada agendado',
        resolveu: false,
      };
    }

    if (!instante) {
      return {
        texto:
          `Não consegui entender "${frase}" como um horário, então não marquei nada. ` +
          'Entendo coisas como "em 20 minutos", "hoje às 15h", "amanhã de manhã" ou ' +
          '"amanhã às 9h30". Dia da semana eu ainda não sei ler.',
        detalhe: `expressão temporal não interpretada: "${frase.slice(0, 60)}"`,
        resolveu: false,
      };
    }

    const lembrete = await agenda.agendar(ctx.id_usuario, assunto, instante.quando);
    if (!lembrete) {
      return {
        texto:
          'Sua agenda comigo está no limite de 50 lembretes pendentes. ' +
          'Cancele algum que já não vale e eu marco este.',
        detalhe: 'teto de pendentes atingido',
        resolveu: false,
      };
    }

    return {
      // O rótulo devolvido é o que a IARA ENTENDEU, não o que foi dito. É a
      // única chance de o operador discordar antes da hora.
      texto: `Marcado: ${assunto} — ${instante.rotulo}. Eu aviso quando chegar.`,
      detalhe: `lembrete ${lembrete.id} para ${lembrete.vence_em}`,
      resolveu: true,
    };
  },

  /**
   * Confere o SHARD, não o texto. Relê os pendentes e procura o id que o
   * executor registrou — se a gravação não pegou, o lembrete não está lá e a
   * resposta ao operador carrega isso em vez de um "marcado" sem lastro.
   */
  async verificar(resultado, ctx) {
    const id = agenda.ultimoAgendadoDe(ctx.id_usuario);
    if (!id) {
      return {
        confirmado: false,
        evidencia: resultado.resolveu
          ? 'o executor relatou sucesso e não registrou lembrete nenhum'
          : 'nenhum lembrete foi criado nesta execução',
        motivo: 'nao_encontrado',
      };
    }
    return (await agenda.temPendente(ctx.id_usuario, id))
      ? { confirmado: true, evidencia: `lembrete ${id} está na agenda do operador` }
      : {
          confirmado: false,
          evidencia: `lembrete ${id} não consta na agenda depois da gravação`,
          motivo: 'divergente',
        };
  },
};

export const listarLembretes: Habilidade = {
  manifesto: {
    id: 'listar_lembretes',
    nome: 'Lembretes marcados',
    descricao:
      'Lista os lembretes que o operador ainda tem pendentes comigo, do mais próximo ao mais ' +
      'distante. Use para "quais lembretes eu tenho", "o que eu marquei", "minha agenda".',
    exemplos: ['Quais lembretes eu tenho?', 'O que eu marquei com você?'],
    capacidades: ['listar lembretes pendentes'],
    entidades: ['lembrete'],
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: ['memoria'],
    timeout_ms: 5000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {},
  },

  async executar(ctx) {
    const pendentes = await agenda.pendentes(ctx.id_usuario);
    if (pendentes.length === 0) {
      return {
        texto: 'Você não tem nenhum lembrete marcado comigo.',
        detalhe: 'agenda vazia',
        resolveu: true,
      };
    }
    const linhas = pendentes.map((l) => `• ${porExtenso(l.vence_em)} — ${l.assunto}`);
    return {
      texto: `Você tem ${contar(pendentes.length, 'lembrete', 'lembretes')}:\n${linhas.join('\n')}`,
      detalhe: `${contar(pendentes.length, 'pendente', 'pendentes')}`,
      resolveu: true,
    };
  },
};

export const cancelarLembrete: Habilidade = {
  manifesto: {
    id: 'cancelar_lembrete',
    /** Só fecha o que o operador abriu antes. Ver ManifestoHabilidade. */
    fecha_interacao_aberta: true,
    nome: 'Cancelar lembrete',
    descricao:
      'Remove um lembrete pendente. O parâmetro "termo" é um trecho do assunto ("a reunião", ' +
      '"ligar para o cliente"); vazio só funciona quando existe um único lembrete marcado. ' +
      'Use para "cancela o lembrete de X", "esquece aquele lembrete".',
    exemplos: ['Cancela o lembrete da reunião', 'Esquece aquele lembrete de ontem'],
    capacidades: ['cancelar lembrete pendente'],
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: ['memoria'],
    timeout_ms: 6000,
    custo: 'zero',
    risco: 'medio',
    // Cancelar duas vezes o mesmo lembrete converge: a segunda não encontra
    // nada e o estado final é idêntico ao da primeira.
    idempotencia: 'escrita_idempotente',
    esquema: {
      termo: { tipo: 'texto', padrao: '' },
    },
  },

  async executar(ctx) {
    const termo = String(ctx.parametros.termo ?? '').trim();
    const pendentes = await agenda.pendentes(ctx.id_usuario);

    if (pendentes.length === 0) {
      return {
        texto: 'Você não tem nenhum lembrete marcado para cancelar.',
        detalhe: 'agenda vazia',
        resolveu: false,
      };
    }

    const removido = await agenda.cancelar(ctx.id_usuario, termo);

    /**
     * AMBIGUIDADE NÃO CANCELA — e a resposta precisa dizer entre o quê.
     *
     * Apagar o lembrete errado é a falha mais silenciosa desta habilidade: o
     * operador só descobre na hora em que o certo não toca, e aí não há como
     * desfazer. Listar os candidatos custa uma frase e devolve a escolha a quem
     * é dono dela.
     */
    if (!removido) {
      const candidatos = pendentes.map((l) => `• ${porExtenso(l.vence_em)} — ${l.assunto}`);
      return {
        texto:
          (termo
            ? `"${termo}" combina com mais de um lembrete (ou com nenhum), e eu não escolho por você. `
            : 'Você tem mais de um lembrete marcado, e eu não escolho qual apagar. ') +
          `Diga qual:\n${candidatos.join('\n')}`,
        detalhe: `cancelamento ambíguo entre ${contar(pendentes.length, 'pendente', 'pendentes')}`,
        resolveu: false,
      };
    }

    return {
      texto: `Cancelado: ${removido.assunto}, que estava marcado para ${porExtenso(removido.vence_em)}.`,
      detalhe: `lembrete ${removido.id} removido`,
      resolveu: true,
    };
  },

  /**
   * Confere pela AUSÊNCIA, e sem guardar estado: se o termo ainda encontra
   * alguém na agenda, o cancelamento não aconteceu. Recusa por ambiguidade não
   * é falha de verificação — é uma decisão correta, e o que se confirma nela é
   * justamente que nada foi removido.
   */
  async verificar(resultado, ctx) {
    const termo = String(ctx.parametros.termo ?? '').trim();

    if (!resultado.resolveu) {
      return {
        confirmado: true,
        evidencia: 'nada foi cancelado, como a resposta declarou',
      };
    }

    return (await agenda.encontrar(ctx.id_usuario, termo)) === null
      ? { confirmado: true, evidencia: 'o lembrete não consta mais entre os pendentes' }
      : {
          confirmado: false,
          evidencia: 'ainda existe lembrete pendente para este termo depois do cancelamento',
          motivo: 'divergente',
        };
  },
};

export const HABILIDADES_AGENDA: readonly Habilidade[] = [
  agendarLembrete,
  listarLembretes,
  cancelarLembrete,
];
