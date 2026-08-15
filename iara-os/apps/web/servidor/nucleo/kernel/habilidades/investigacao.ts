/**
 * INVESTIGAR — "IARA, descubra por que meu computador está lento".
 *
 * A diferença entre esta habilidade e `informacoes_sistema` é a diferença entre
 * as duas frases que o operador diz:
 *
 *   "quanto de memória está sendo usada?"  → uma leitura. `informacoes_sistema`.
 *   "por que está lento?"                  → uma investigação. esta.
 *
 * A segunda não se responde com números. Ela se responde com o ciclo do §17:
 * coletar, comparar com o esperado, separar o que está fora, levantar hipóteses
 * com a confiança que as evidências sustentam, propor alternativas comparadas —
 * e PARAR, pedindo autorização.
 *
 * O QUE ESTA HABILIDADE NÃO FAZ, e é o mais importante: ela não age. Nenhum dos
 * planos que ela devolve é executado por ela. Isso não é timidez de desenho — é
 * a invariante de autorização deste kernel: risco alto só sai de plano
 * determinístico com confirmação do operador, e uma habilidade que investigasse
 * e já encerrasse o processo culpado estaria autoautorizando com base num
 * raciocínio próprio. Ver `PorteiroAutorizacao` e `PoliticaRisco`.
 *
 * `risco: 'baixo'` e `idempotencia: 'leitura'` são, portanto, verdade literal:
 * rodar isto duas vezes mede duas vezes e não muda nada no mundo. É por isso que
 * ela pode ser o passo 2 de todo plano que o `MotorAnalise` propõe — "eu meço de
 * novo e comparo" é uma leitura, e leitura não pede confirmação.
 */

import type { Habilidade } from '../Habilidade';
import { braco } from '../../Braco';
import { aplicativoFechavelDoProcesso } from '../../AgenteLocal';
import { interpretarMedicao } from '../../SondasDesempenho';
import {
  confrontar,
  diagnosticarLentidao,
  investigarLentidao,
  redigirInvestigacao,
} from '../MotorAnalise';
import { assinar, memoriaDeSolucoes } from '../MemoriaDeSolucoes';
import { planosPropostos } from '../PlanosPropostos';
import { passosExecutaveis } from '../Investigacao';

/**
 * Existe para o teste poder investigar duas vezes sem herdar estado da anterior.
 *
 * A referência em si mora em `PlanosPropostos` desde a Fase 2. Ela vivia aqui,
 * num mapa próprio, e a mudança pagou um débito declarado: uma segunda cópia da
 * "última investigação" ao lado da proposta significava que o confronto do §14
 * comparava sempre contra a expectativa do plano RECOMENDADO, mesmo quando o
 * operador tinha autorizado outro. Duas fontes para o mesmo fato divergem — foi
 * o mesmo defeito que `Verdade.ts` já tinha resolvido para memória de conversa.
 */
export function esquecerReferencia(idUsuario: string): void {
  planosPropostos.esquecer(idUsuario);
}

export const investigarLentidaoHabilidade: Habilidade = {
  manifesto: {
    id: 'investigar_lentidao',
    nome: 'Investigar lentidão do computador',
    descricao:
      'Investiga por que o computador do operador está lento: mede processador, memória, disco e os ' +
      'processos que mais consomem, separa o que está fora da faixa normal, levanta hipóteses com o ' +
      'grau de confiança que as evidências sustentam e propõe planos comparados por benefício, risco ' +
      'e esforço. NÃO executa nenhum plano — devolve a proposta e pede autorização. Quando já houve ' +
      'uma investigação antes, compara e diz se a ação anterior resolveu. Use para "por que meu ' +
      'computador está lento", "investigue a lentidão", "veja se resolveu", "meça de novo".',
    exemplos: [
      'Por que meu computador está lento?',
      'Investiga essa lentidão aqui',
      'Mede de novo e vê se resolveu',
    ],
    capacidades: ['medir desempenho da máquina', 'hipóteses de lentidão com evidência'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    /**
     * Generoso porque a medição É lenta por construção: a janela de amostragem
     * de processos sozinha custa 1 s, o PowerShell leva o seu para subir, e o
     * braço tem 30 s de prazo. Um timeout aqui menor que o do braço faria a
     * habilidade desistir de uma medição que estava a caminho — e desistir cedo
     * na máquina lenta é falhar exatamente onde é preciso funcionar.
     */
    timeout_ms: 40_000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {},
  },

  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'medir_desempenho',
      parametros: {},
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
    });

    /**
     * O braço não mediu. Note o que NÃO acontece aqui: nenhuma tentativa de
     * medir a máquina do motor como consolo. O motor pode estar num contêiner
     * Linux na nuvem, e responder com os números DELE a uma pergunta sobre o
     * computador de quem perguntou seria a mentira mais convincente que este
     * sistema saberia contar — números verdadeiros sobre a máquina errada.
     */
    if (relato.estado !== 'sucesso') {
      return {
        texto:
          'Não consegui medir o seu computador para investigar a lentidão. ' +
          `${relato.texto} Sem medição eu não tenho evidência, e sem evidência eu não vou ` +
          'chutar uma causa.',
        detalhe: `investigar_lentidao [${relato.execucao_id}] ${relato.estado}`,
        resolveu: false,
      };
    }

    const medicao = interpretarMedicao(relato.dados);
    if (!medicao) {
      /**
       * Execução com sucesso e sem dados: é o braço de versão anterior, que não
       * conhece o campo `dados`. Dizer isso é útil de verdade — o operador tem
       * uma ação (atualizar o aplicativo) —, e é muito melhor que uma
       * investigação vazia que ninguém sabe por que veio vazia.
       */
      return {
        texto:
          'O seu computador respondeu à medição, mas não me mandou os números em formato ' +
          'que eu consiga analisar. Isso costuma ser o aplicativo da IARA no computador estar ' +
          'numa versão anterior à do motor. Atualize-o e me peça de novo.',
        detalhe: `investigar_lentidao [${relato.execucao_id}] sem dados estruturados`,
        resolveu: false,
      };
    }

    const anterior = planosPropostos.referencia(ctx.id_usuario);

    /**
     * O APRENDIZADO ACONTECE AQUI, e antes da análise nova de propósito: o
     * desfecho da tentativa anterior é sobre a assinatura ANTERIOR, não sobre a
     * situação que acabou de ser medida. Gravar depois faria a IARA aprender que
     * o plano A resolve o problema que ele produziu ao ser executado.
     */
    if (anterior?.plano_tentado && anterior.rotulo_tentado) {
      const antes = investigarLentidao(anterior.medicao, null, aplicativoFechavelDoProcesso);
      const desfecho = confrontar(anterior, medicao);
      if (desfecho) {
        memoriaDeSolucoes.registrar({
          id_usuario: ctx.id_usuario,
          assinatura: assinar(antes.diagnostico),
          rotulo: anterior.rotulo_tentado,
          veredito: desfecho.veredito,
        });
      }
    }
    /**
     * A allowlist entra AQUI, e não dentro do `MotorAnalise`.
     *
     * A análise não pode importar o `AgenteLocal` — seria uma aresta de um
     * módulo de raciocínio para um de efeito externo, e a fronteira barra isso.
     * O catálogo pode: é ele que passa pelo `Kernel.abrirOperacao`, que é o
     * portal. Ver `Fronteira.ts` e o comentário de `PodeFechar`.
     */
    /**
     * O histórico é consultado pela assinatura da situação de AGORA — que só
     * existe depois de diagnosticar. Duas passadas pelo diagnóstico é o preço, e
     * ele é irrisório: tudo aqui é aritmética sobre uma medição já feita, sem
     * token e sem I/O.
     */
    const assinaturaAgora = assinar(diagnosticarLentidao(medicao));
    const investigacao = investigarLentidao(medicao, anterior, aplicativoFechavelDoProcesso, {
      relato: memoriaDeSolucoes.contar(ctx.id_usuario, assinaturaAgora),
      preferido: memoriaDeSolucoes.preferido(ctx.id_usuario, assinaturaAgora),
    });

    /**
     * A TENTATIVA SÓ CONTA COMO FRACASSO SE HOUVE TENTATIVA.
     *
     * `plano_tentado` é preenchido apenas quando o operador de fato autorizou um
     * plano. Medir de novo por curiosidade, sem ter agido, não pode consumir uma
     * das três tentativas do §15 — senão a IARA desiste de investigar por causa
     * de perguntas, não de fracassos.
     */
    const tentativaFalhou = Boolean(
      anterior?.plano_tentado &&
        investigacao.veredito &&
        investigacao.veredito.veredito !== 'resolvido',
    );

    /**
     * A proposta nova substitui a anterior, carregando a expectativa de CADA
     * plano — não só a do recomendado. É o que permite ao confronto seguinte
     * conferir o plano que o operador escolheu. Ver `PlanosPropostos.referencia`.
     */
    planosPropostos.propor({
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      planos: investigacao.planos,
      recomendado: investigacao.recomendacao?.escolhido.id ?? null,
      medicao,
      tentativa_falhou: tentativaFalhou,
    });

    const d = investigacao.diagnostico;
    return {
      texto: redigirInvestigacao(investigacao),
      detalhe:
        `investigar_lentidao [${relato.execucao_id}] ${d.anomalias.length} anomalia(s), ` +
        `${d.hipoteses.length} hipótese(s), ${investigacao.planos.length} plano(s)` +
        (investigacao.veredito ? `, veredito ${investigacao.veredito.veredito}` : ''),
      /**
       * `resolveu` é sobre a INVESTIGAÇÃO ter concluído, não sobre a máquina
       * estar boa. Medir e não achar nada fora da faixa é uma investigação
       * bem-sucedida com um resultado negativo — e marcar isso como `false`
       * faria o kernel tratar uma apuração completa como falha.
       */
      resolveu: true,
    };
  },
};

/**
 * ASSUMIR O PLANO — o primeiro passo de todo plano autorizado.
 *
 * Ela não executa o plano. Ela REGISTRA que o operador o autorizou e diz, em
 * voz alta, o que vai acontecer em seguida. Os passos de efeito vêm DEPOIS
 * dela, como passos do plano do Kernel — e portanto atravessam o
 * `PorteiroAutorizacao`, o jornal, o esquema, o timeout e o verificador, um a
 * um, exatamente como qualquer outro passo determinístico.
 *
 * ESSA É A DECISÃO ARQUITETURAL DA FASE 2, e vale ser explícito sobre a
 * alternativa recusada: era muito mais curto fazer esta habilidade abrir o plano
 * guardado e chamar `fechar_aplicativo` por dentro. Isso teria criado um SEGUNDO
 * caminho de execução — um que o porteiro não vigia, que não abre operação no
 * jornal e cujo efeito não aparece na trilha. O kernel inteiro existe para não
 * ter esse caminho. Um plano autorizado não é um atalho; é um plano.
 *
 * `risco: 'baixo'` é verdade literal: escrever numa tabela em memória do próprio
 * motor não alcança ninguém. O risco do plano mora nos passos dele, e é lá que
 * ele é cobrado.
 */
export const assumirPlano: Habilidade = {
  manifesto: {
    id: 'assumir_plano',
    nome: 'Assumir o plano autorizado',
    descricao:
      'Registra que o operador autorizou um dos planos que a IARA propôs na investigação e anuncia ' +
      'o que vai acontecer. Não executa o plano: os passos de efeito vêm em seguida, cada um pelas ' +
      'portas de sempre. Sem proposta viva, diz isso em vez de assumir qualquer coisa.',
    exemplos: ['Pode executar o plano A', 'Autorizo o plano recomendado'],
    capacidades: ['registrar autorização de plano proposto'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 3000,
    custo: 'zero',
    risco: 'baixo',
    /**
     * `escrita_idempotente`, não `leitura`: ela ALTERA — marca o plano como
     * autorizado. Declarar leitura tiraria a autorização do jornal, e "o
     * operador autorizou o plano A" é exatamente o tipo de fato que a trilha
     * precisa guardar. Repetir converge para o mesmo estado: assumir duas vezes
     * o mesmo plano deixa o registro igual.
     */
    idempotencia: 'escrita_idempotente',
    esquema: {
      /** Vazio = o recomendado. Ver `PlanosPropostos.escolher`. */
      plano: { tipo: 'texto', padrao: '', max: 4 },
    },
  },

  async executar(ctx) {
    const letra = String(ctx.parametros.plano ?? '').trim();
    const escolhido = planosPropostos.escolher(ctx.id_usuario, ctx.sessao, letra || undefined);

    if (!escolhido) {
      /**
       * NÃO HÁ O QUE ASSUMIR, e a frase diz QUAL dos casos é. "Não tenho plano
       * nenhum aberto" e "o plano que eu tinha venceu" pedem condutas
       * diferentes do operador, e colapsar as duas num "não encontrei" o deixa
       * sem saber se repete o pedido ou recomeça a investigação.
       */
      const motivo = planosPropostos.porQueNaoHa(ctx.id_usuario, ctx.sessao);
      const frase =
        motivo === 'vencida'
          ? 'Os planos que eu tinha proposto venceram — foram montados sobre uma medição que já não vale. ' +
            'Me peça para investigar de novo que eu meço e proponho a partir do estado de agora.'
          : motivo === 'outra_conversa'
            ? 'Essa proposta foi feita em outra conversa. Me peça para investigar aqui que eu meço de novo.'
            : letra
              ? `Não tenho um plano "${letra}" aberto. Me peça para investigar a lentidão que eu meço e proponho as alternativas.`
              : 'Não tenho nenhum plano aberto para executar. Me peça para investigar a lentidão primeiro.';
      return { texto: frase, detalhe: `assumir_plano: ${motivo}`, resolveu: false };
    }

    planosPropostos.autorizar(ctx.id_usuario, ctx.sessao, escolhido.id);

    const agora = passosExecutaveis(escolhido);
    const depois = escolhido.passos.filter((s) => s.quando !== 'agora');

    const linhas = [`Plano ${escolhido.id}: ${escolhido.rotulo}.`];
    if (agora.length > 0) {
      linhas.push(`Vou fazer agora: ${agora.map((s) => s.descricao).join('; ')}.`);
    }
    if (depois.length > 0) {
      linhas.push(`Depende de você: ${depois.map((s) => s.descricao).join('; ')}.`);
    }
    if (escolhido.rollback) {
      linhas.push(`Se não gostar do resultado: ${escolhido.rollback}.`);
    }

    return {
      texto: linhas.join(' '),
      detalhe: `assumir_plano ${escolhido.id}: ${agora.length} passo(s) agora, ${depois.length} depois`,
      resolveu: true,
    };
  },
};

export const HABILIDADES_INVESTIGACAO: readonly Habilidade[] = [
  investigarLentidaoHabilidade,
  assumirPlano,
];
