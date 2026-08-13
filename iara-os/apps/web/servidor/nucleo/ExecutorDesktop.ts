/**
 * O EXECUTOR — traduz uma ordem em um efeito, e devolve o que conseguiu provar.
 *
 * Uma implementação só, usada nos DOIS lugares onde as mãos podem estar:
 *
 *  - dentro do motor, quando ele roda no computador do operador (o loop de
 *    desenvolvimento, e o dia em que alguém instalar tudo numa máquina só);
 *  - dentro do braço, quando o motor está na nuvem e as mãos estão aqui.
 *
 * Ter uma implementação só é o que impede a divergência mais cara possível
 * neste sistema: a execução local se comportar de um jeito e a remota de outro,
 * com os testes rodando na primeira e o produto usando a segunda. O caminho de
 * transporte muda; o que acontece com o pedido depois que ele chega, não.
 *
 * Este módulo é BURRO de propósito. Ele não decide se pode, não pergunta risco,
 * não consulta o jornal, não fala com o operador. Tudo isso já aconteceu antes,
 * na camada de habilidades e no `RegistroOperacoes`. Aqui só se executa o que
 * chegou — e o `AgenteLocal`, que é quem tem as fronteiras (allowlist, raízes
 * autorizadas, recusa de nome), continua sendo o único que diz "não" a partir
 * do conteúdo do pedido.
 */

import { agenteLocal, ROTULO_DO_LOCAL, type LocalAutorizado } from './AgenteLocal';
import type { OrdemExecucao, ProvaExecucao, RelatoExecucao } from '../../lib/execucao';

const LOCAIS = Object.keys(ROTULO_DO_LOCAL) as LocalAutorizado[];

function local(parametros: Record<string, unknown>, padrao: LocalAutorizado): LocalAutorizado {
  const v = parametros.local;
  return typeof v === 'string' && (LOCAIS as string[]).includes(v) ? (v as LocalAutorizado) : padrao;
}

function relato(
  ordem: OrdemExecucao,
  inicio: number,
  onde: 'motor' | 'dispositivo',
  dispositivo: string | null,
  r: {
    ok: boolean;
    texto: string;
    prova: ProvaExecucao;
    codigo_erro: RelatoExecucao['codigo_erro'];
    dados?: Readonly<Record<string, unknown>>;
  },
): RelatoExecucao {
  return {
    execucao_id: ordem.execucao_id,
    estado: r.ok ? 'sucesso' : 'falhou',
    texto: r.texto,
    prova: r.prova,
    codigo_erro: r.codigo_erro,
    duracao_ms: Date.now() - inicio,
    dispositivo,
    onde,
    ...(r.dados ? { dados: r.dados } : {}),
  };
}

/**
 * Executa uma ordem nesta máquina.
 *
 * `onde` e `dispositivo` são carimbos de PROCEDÊNCIA, não configuração: eles
 * respondem "quem fez isto", que é a pergunta que se faz depois, quando algo
 * saiu errado e há mais de um candidato.
 */
export async function executarOrdem(
  ordem: OrdemExecucao,
  onde: 'motor' | 'dispositivo',
  dispositivo: string | null = null,
): Promise<RelatoExecucao> {
  const inicio = Date.now();
  const usuario = ordem.id_usuario;

  try {
    switch (ordem.acao) {
      case 'abrir_aplicativo': {
        const pedido = String(ordem.parametros.aplicativo ?? '');
        return relato(ordem, inicio, onde, dispositivo, await agenteLocal.abrirAplicativo(usuario, pedido));
      }

      case 'fechar_aplicativo': {
        const pedido = String(ordem.parametros.aplicativo ?? '');
        return relato(ordem, inicio, onde, dispositivo, await agenteLocal.fecharAplicativo(usuario, pedido));
      }

      case 'criar_pasta': {
        const nome = String(ordem.parametros.nome ?? '');
        const onde_ = local(ordem.parametros, 'area_de_trabalho');
        const texto = await agenteLocal.criarPasta(usuario, nome, onde_);
        /**
         * A PROVA é lida do disco desta máquina DEPOIS de executar, e não do
         * texto que a execução devolveu. Conferir o próprio relato para
         * confirmar o relato é o vício que a quinta porta existe para impedir —
         * e é fácil recair nele justamente aqui, onde o texto está à mão.
         */
        const prova = agenteLocal.provaDaPasta(nome, onde_);
        return relato(ordem, inicio, onde, dispositivo, {
          ok: prova.confirmado,
          texto,
          prova,
          codigo_erro: prova.confirmado ? null : 'FALHA_NA_EXECUCAO',
        });
      }

      case 'listar_arquivos':
        return relato(
          ordem,
          inicio,
          onde,
          dispositivo,
          await agenteLocal.listarArquivos(usuario, local(ordem.parametros, 'area_de_trabalho')),
        );

      case 'capturar_tela': {
        const texto = await agenteLocal.capturarTela(usuario, local(ordem.parametros, 'documentos'));
        const prova = agenteLocal.provaDaCaptura(usuario);
        return relato(ordem, inicio, onde, dispositivo, {
          ok: prova.confirmado,
          texto,
          prova,
          codigo_erro: prova.confirmado ? null : 'FALHA_NA_EXECUCAO',
        });
      }

      case 'informacoes_sistema':
        return relato(ordem, inicio, onde, dispositivo, await agenteLocal.informacoesSistema(usuario));

      /**
       * A ÚNICA ação do executor que devolve `dados` estruturados, e a razão é
       * o que o motor faz com eles: as outras produzem um efeito e relatam; esta
       * produz OBSERVAÇÃO, que vai ser comparada com faixas, virar hipótese e
       * sustentar um plano do outro lado da rede. Mandar só a prosa obrigaria o
       * `MotorAnalise` a fazer regex no relatório do executor — que é o mesmo
       * vício de conferir o relato pelo próprio relato, com outra roupa.
       */
      case 'medir_desempenho':
        return relato(ordem, inicio, onde, dispositivo, await agenteLocal.medirDesempenho(usuario));

      default: {
        /**
         * Ação desconhecida NÃO é erro de programação a ser lançado — é o caso
         * normal de um braço antigo recebendo ordem de um motor novo. Ele
         * precisa responder alguma coisa, e a coisa certa é dizer que não sabe
         * fazer aquilo. Um `throw` aqui viraria `EXECUTION_FAILED` genérico e o
         * operador ouviria "deu erro" no lugar de "essa versão não sabe".
         */
        const desconhecida: string = ordem.acao;
        return {
          execucao_id: ordem.execucao_id,
          estado: 'falhou',
          texto: `Esta versão do braço não sabe executar "${desconhecida}". Atualize o aplicativo da IARA no computador.`,
          prova: { confirmado: false, evidencia: `ação "${desconhecida}" ausente deste executor`, motivo: 'nao_encontrado' },
          codigo_erro: 'FERRAMENTA_INDISPONIVEL',
          duracao_ms: Date.now() - inicio,
          dispositivo,
          onde: 'nenhum',
        };
      }
    }
  } catch (erro) {
    /**
     * A rede de segurança. Nada aqui embaixo deveria lançar — o `AgenteLocal`
     * trata os próprios erros e devolve recusa —, mas "não deveria lançar" é
     * uma afirmação sobre o código de hoje. Uma exceção escapando daqui no
     * braço derruba o braço; no motor, derruba a sessão de todo mundo.
     *
     * A mensagem técnica vai para o log; o operador recebe uma frase. Stack
     * trace na cara de quem pediu para abrir a calculadora não ajuda ninguém.
     */
    const mensagem = (erro as Error).message;
    console.log(
      JSON.stringify({
        canal: 'executor_desktop',
        execucao_id: ordem.execucao_id,
        acao: ordem.acao,
        erro: mensagem,
      }),
    );
    return {
      execucao_id: ordem.execucao_id,
      estado: 'falhou',
      texto: 'Tentei executar isso no computador e a operação falhou por um erro interno. Não repeti sozinha.',
      prova: { confirmado: false, evidencia: `exceção durante a execução: ${mensagem}`, motivo: 'divergente' },
      codigo_erro: 'FALHA_NA_EXECUCAO',
      duracao_ms: Date.now() - inicio,
      dispositivo,
      onde,
    };
  }
}
