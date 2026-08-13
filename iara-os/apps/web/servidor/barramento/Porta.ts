/**
 * Porta do barramento: o que acontece quando um socket conecta.
 *
 * Vive separado do `principal.ts` porque a decisão de quem é o operador é a
 * fronteira de segurança do sistema — merece um arquivo próprio, não um bloco
 * dentro do bootstrap do servidor.
 *
 * Cada operador ganha o próprio Kernel, o próprio barramento de eventos e o
 * próprio compilador. Não existe estrutura compartilhada entre sessões, e é
 * isso que torna o kernel particionável sem reescrita: o dia em que cada
 * sessão precisar de um processo, só o transporte muda.
 */

import type { WebSocket } from 'ws';
import { EstadoAtomico } from '../nucleo/EstadoAtomico';
import { MemoriaOperacional } from '../nucleo/MemoriaOperacional';
import { TeoriaDaMente } from '../nucleo/TeoriaDaMente';
import { SessaoOperador } from './SessaoOperador';
import { PonteProjecao } from './PonteProjecao';
import { inventarioDeMaquinas, ponteDispositivos } from './PonteDispositivos';
import { pareamento } from '../nucleo/Pareamento';
import { BarramentoEventos } from '../nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../nucleo/kernel/CompiladorSnapshot';
import { Kernel } from '../nucleo/kernel/Kernel';
import { CicloAutonomo } from '../nucleo/CicloAutonomo';
import { braco } from '../nucleo/Braco';
import { interpretarMedicao } from '../nucleo/SondasDesempenho';
import { prepararOperacionais } from '../nucleo/kernel/habilidades/operacionais';
import { lerPacoteCliente } from '../../lib/protocolo';
import { outrosOperadores } from '../../lib/operadores';
import { papelDe } from '../nucleo/kernel/Papeis';
import { LimiteVazao } from '../nucleo/kernel/Seguranca';
import { esquecerLocal, registrarLocal } from '../nucleo/LocalOperador';
import {
  autenticacaoAtiva,
  identidadeLocal,
  verificarToken,
  type OperadorAutenticado,
} from '../nucleo/Autenticacao';

const memoria = new MemoriaOperacional();

/**
 * Espelhos simultâneos por operador. O mesmo operador pode estar no app
 * desktop, numa aba do Chrome (a que escuta o "ei IARA") e no celular ao mesmo
 * tempo — cada tela é uma sessão de transporte, o kernel é um só. O teto
 * existe porque sessão zumbi de reconexão (o TCP antigo expira minutos depois)
 * ocupa vaga até o close chegar.
 */
const MAX_ESPELHOS = 4;

interface Residente {
  estado: EstadoAtomico;
  barramento: BarramentoEventos;
  compilador: CompiladorSnapshot | null;
  kernel: Kernel | null;
  ciclo: CicloAutonomo | null;
  /** Uma sessão por tela conectada, em ordem de chegada. */
  sessoes: Set<SessaoOperador>;
  ponte: PonteProjecao | null;
}

const residentes = new Map<string, Residente>();

/**
 * O INVENTÁRIO DE MÃOS, empurrado quando muda.
 *
 * UM ouvinte por PROCESSO, e não um por sessão. A alternativa — cada
 * `conectarOperador` se inscrevendo e cancelando no `close` — pareceu mais
 * simétrica e é pior: `PonteDispositivos` passaria a guardar uma referência por
 * tela aberta, e um `close` que não rodasse (o caso que o teto de espelhos e o
 * heartbeat existem para tratar) deixaria um ouvinte preso ao residente já
 * descartado. Aqui a inscrição é do módulo e a busca é por id, então uma sessão
 * que já saiu simplesmente não é encontrada.
 *
 * Empurra para TODOS os espelhos daquele operador: quem ligou o computador quer
 * ver a mão aparecer tanto no celular quanto na tela do escritório.
 */
ponteDispositivos.aoMudarInventario((idUsuario) => {
  const r = residentes.get(idUsuario);
  if (!r || r.sessoes.size === 0) return;
  void inventarioDeMaquinas(idUsuario)
    .then((maquinas) => {
      for (const sessao of r.sessoes) sessao.emitirDispositivos(maquinas, pareamento.disponivel());
    })
    .catch(() => undefined);
});

/**
 * ESTRANGULAMENTO PRÉ-AUTENTICAÇÃO — a janela que não tinha dono.
 *
 * `Kernel.processar` já tem `LimiteVazao`, e ele protege bem o que vem DEPOIS
 * da identidade estar resolvida. O `ola` vinha antes: cada apresentação dispara
 * um `verificarToken`, que é uma chamada de rede ao Supabase, e a única guarda
 * era `if (operador || abrindo) return` — uma apresentação por CONEXÃO. Abrir
 * mil conexões é de graça, então eram mil chamadas de autenticação disparadas
 * sem nenhuma credencial válida: negação de serviço contra o provedor de
 * identidade, paga pela cota de quem foi atacado.
 *
 * Global e não por IP de propósito. Atrás de um proxy (Railway, Cloudflare) o
 * IP visível é o do proxy, e uma janela por IP viraria uma janela por
 * infraestrutura inteira — pior que nenhuma, porque parece proteção. O teto é
 * alto o bastante para uma equipe reconectando junto depois de uma queda de
 * rede e baixo o bastante para tornar a enxurrada inútil.
 */
const APRESENTACOES_POR_MINUTO = 120;
const vazaoDeApresentacao = new LimiteVazao(APRESENTACOES_POR_MINUTO, 60_000);

function residenteDe(idUsuario: string): Residente {
  let r = residentes.get(idUsuario);
  if (!r) {
    r = {
      estado: new EstadoAtomico(),
      barramento: new BarramentoEventos(idUsuario),
      compilador: null,
      kernel: null,
      ciclo: null,
      sessoes: new Set(),
      ponte: null,
    };
    residentes.set(idUsuario, r);
  }
  return r;
}

export async function prepararMotor(): Promise<void> {
  await prepararOperacionais();
}

export function conectarOperador(socket: WebSocket): void {
  let residente: Residente | null = null;
  let operador: OperadorAutenticado | null = null;
  let abrindo = false;
  /** Chave do residente deste socket. Capturada na abertura; o close a devolve. */
  let idResidente: string | null = null;
  /** A sessão criada para ESTE socket. O close só desmonta o que é dele. */
  let minhaSessao: SessaoOperador | null = null;

  const recusar = (motivo: string) => {
    // seq 1, nunca 0: a guarda de ordem do cliente descarta `seq <= 0` e a
    // recusa de autenticação viraria um fechamento mudo, sem explicação.
    socket.send(JSON.stringify({ tipo: 'erro', seq: 1, instante: Date.now(), texto: motivo }));
    socket.close(4401, 'nao autenticado');
  };

  socket.on('message', (dado) => {
    const pacote = lerPacoteCliente(dado.toString());
    if (!pacote) return;

    if (pacote.tipo === 'ola') {
      if (operador || abrindo) return; // uma apresentação por conexão

      /**
       * A recusa é MUDA de propósito — fecha sem dizer por quê. Distinguir
       * "excesso de tentativas" de "token inválido" transformaria esta porta
       * num oráculo, que é a mesma razão pela qual `verificarToken` não
       * distingue token expirado de token inexistente.
       */
      if (!vazaoDeApresentacao.permitir()) {
        console.warn('[iara] apresentações acima do limite do processo — socket recusado');
        socket.close(4429, 'excesso de tentativas');
        return;
      }
      abrindo = true;

      void (async () => {
        try {
          /**
           * A FRONTEIRA. Com Supabase configurado, a identidade sai de um
           * token verificado pelo servidor. O `id_usuario` que o cliente
           * mandou é ignorado por completo — é decoração.
           */
          operador = autenticacaoAtiva()
            ? await verificarToken(pacote.token)
            : identidadeLocal(pacote.id_usuario, pacote.nome);

          if (!operador) {
            recusar('Sessão inválida ou expirada. Entre novamente.');
            return;
          }

          const r = residenteDe(operador.id_usuario);
          residente = r;
          idResidente = operador.id_usuario;

          /**
           * Teto de espelhos: recusa a tela NOVA, nunca derruba as
           * estabelecidas. A versão anterior derrubava a mais antiga — e como
           * cliente derrubado reconecta, quatro telas viravam um carrossel de
           * quedas perpétuo (cada uma era "a mais antiga" a cada poucos
           * segundos). Zumbis de reconexão não precisam desse sacrifício: o
           * heartbeat de 30 s do servidor os termina sozinho e a vaga volta.
           */
          if (r.sessoes.size >= MAX_ESPELHOS) {
            socket.send(
              JSON.stringify({
                tipo: 'erro',
                seq: 1,
                instante: Date.now(),
                texto: `Limite de ${MAX_ESPELHOS} telas simultâneas atingido. Feche uma tela e tente de novo.`,
              }),
            );
            socket.close(4000, 'limite de telas simultaneas');
            return;
          }

          /**
           * Espelho novo, não takeover: a tela nova ENTRA na sessão em vez de
           * derrubar a anterior. App desktop + navegador do mesmo operador
           * conviviam se derrubando em ciclo infinito — cada um via "recon-
           * ectando…" enquanto roubava a vez do outro.
           */
          const sessao = new SessaoOperador(socket);
          minhaSessao = sessao;
          r.sessoes.add(sessao);

          /**
           * A ficha entra JUNTO com a identidade, num único `definirOperador`.
           *
           * Em duas chamadas o primeiro snapshot sairia com a ficha vazia e o
           * segundo a corrigiria — e o formulário, que hidrata do snapshot,
           * abriria em branco por um instante antes de preencher. Pior: se o
           * operador fosse rápido no clique, digitaria em cima de um campo
           * prestes a ser sobrescrito. `lerPreferencias` nunca lança, então
           * não há risco de a ficha impedir a sessão de abrir.
           */
          await r.estado.definirOperador({
            id_usuario: operador.id_usuario,
            nome: operador.nome,
            visto_em: new Date().toISOString(),
            preferencias: await memoria.lerPreferencias(operador.id_usuario),
          });

          /**
           * O LASTRO DE CONVIVÊNCIA, semeado uma vez por sessão.
           *
           * `afinidade` é métrica volátil e nasce no piso a cada login. Sozinha,
           * ela conta apenas a conversa de hoje — e é ela que abre a provocação
           * amigável em `TeoriaDaMente.overrideDeFamiliaridade`. Sem esta linha,
           * quem fala com a IARA há meses é recebido às nove da manhã com a
           * mesma formalidade de quem chegou ontem, todos os dias, para sempre.
           *
           * Uma consulta por sessão, não por turno: convivência não muda entre
           * duas mensagens. `trocasAcumuladas` nunca lança, então isto não entra
           * no try de `recusar()` — pela mesma razão que o insight noturno saiu
           * de lá. Enfeite de tom não derruba socket.
           */
          await r.estado.aplicarIntencao({
            campo: 'afinidade',
            delta: TeoriaDaMente.lastroDeFamiliaridade(
              await memoria.trocasAcumuladas(operador.id_usuario),
            ),
          });

          r.kernel ??= new Kernel({
            sessao: operador.id_usuario,
            idUsuario: operador.id_usuario,
            /**
             * O PAPEL EFETIVO. Sem esta linha o Kernel caía no `?? 'operador'`
             * e os outros dois papéis de `Seguranca.ts` eram inalcançáveis em
             * produção — ver `Papeis.ts`.
             */
            papel: papelDe(operador),
            outrosOperadores: outrosOperadores(operador.id_usuario, operador.nome),
            estado: r.estado,
            memoria,
            barramento: r.barramento,
          });

          await r.estado.definirNuvemIndisponivel(!nuvemLigada());

          // Compilador, ponte e ciclo nascem com o PRIMEIRO espelho e morrem
          // com o último; espelhos seguintes só se penduram no que já existe.
          r.compilador ??= new CompiladorSnapshot(r.barramento, r.kernel.memoriaTrabalho);
          r.ponte ??= new PonteProjecao(r.barramento, r.compilador, r.estado, r.sessoes);

          if (!r.ciclo) {
            const dono = operador;
            r.ciclo = new CicloAutonomo(
              operador.id_usuario,
              r.estado,
              memoria,
              () => r.ponte?.hidratar(),
              /**
               * O lembrete vencido é FALADO, não logado — e isso é uma decisão,
               * não um detalhe de canal.
               *
               * O insight noturno logo abaixo sai por `emitirLog` porque é um
               * comentário sobre a semana; ninguém perde nada se der uma olhada
               * no console amanhã. Um lembrete é o oposto: ele existe
               * exatamente porque a pessoa não vai olhar. Recado que só aparece
               * no console técnico é recado não dado.
               *
               * `TAREFA_CONCLUIDA` é o evento honesto para isto. Ele carrega
               * `rota: 'sistema_local'` e `ms: 0` — que é a verdade: nasceu do
               * agendador local, não gastou token nenhum e não levou tempo. A
               * telemetria do turno continua dizendo o que de fato aconteceu.
               */
              (lembrete) => {
                const texto = `Lembrete: ${lembrete.assunto}.`;
                r.barramento.publicar({
                  tipo: 'TAREFA_CONCLUIDA',
                  id_mensagem: `lembrete-${lembrete.id}`,
                  texto,
                  rota: 'sistema_local',
                  ms: 0,
                });
                /**
                 * Gravar no shard é o que faz o lembrete existir para a IARA
                 * no turno seguinte: sem isto ela avisa e, trinta segundos
                 * depois, não faz ideia de que avisou. Falha de memória não
                 * pode derrubar o ciclo — daí o `catch` mudo, no mesmo espírito
                 * do insight logo abaixo.
                 */
                void memoria
                  .registrar(dono.id_usuario, 'iara', texto, 'sistema_local')
                  .catch(() => undefined);
              },
              undefined,
              /**
               * O VIGIA (§12). Ele mede pela mesma ponte de sempre — o braço —,
               * e por isso enxerga o computador DO OPERADOR, não o do motor.
               * Sem braço, a medição falha e o vigia simplesmente cala: é
               * preferível não avisar a avisar sobre a máquina errada.
               */
              async () => {
                const relato = await braco.executar({
                  acao: 'medir_desempenho',
                  parametros: {},
                  id_usuario: dono.id_usuario,
                  sessao: 'vigia',
                });
                return relato.estado === 'sucesso' ? interpretarMedicao(relato.dados) : null;
              },
              /**
               * O aviso sai pelo MESMO canal de qualquer outra fala da IARA,
               * exatamente como o lembrete vencido — e pela mesma razão. Um
               * alerta que só aparece no console técnico é um alerta não dado.
               *
               * `rota: 'sistema_local'` e `ms: 0` são a verdade: nasceu do
               * vigia, não gastou token e não houve turno.
               */
              (aviso) => {
                r.barramento.publicar({
                  tipo: 'TAREFA_CONCLUIDA',
                  id_mensagem: `vigia-${aviso.assunto}-${Date.now()}`,
                  texto: aviso.texto,
                  rota: 'sistema_local',
                  ms: 0,
                });
                void memoria
                  .registrar(dono.id_usuario, 'iara', aviso.texto, 'sistema_local')
                  .catch(() => undefined);
              },
            );
            r.ciclo.iniciar();
          }

          r.ponte.hidratar();
          sessao.emitirLog(
            'info',
            autenticacaoAtiva()
              ? `Sessão autenticada para ${operador.nome}. Shard privado isolado; nenhum outro operador é visível deste contexto.`
              : `Sessão local para ${operador.nome}. Autenticação desligada — modo de desenvolvimento.`,
          );

          /**
           * O inventário de mãos vai JUNTO com a abertura, sem ninguém pedir.
           *
           * É o que permite ao cabeçalho da conversa dizer, desde o primeiro
           * quadro, quantos computadores atendem. Esperar a gaveta abrir faria
           * o contador nascer em branco e só virar verdade depois de um clique
           * — e um contador que às vezes está certo é pior que nenhum.
           *
           * Fora do try da autenticação, e o `catch` é mudo pela mesma razão do
           * insight logo abaixo: a tabela de dispositivos indisponível não pode
           * impedir alguém de entrar no escritório.
           */
          void inventarioDeMaquinas(operador.id_usuario)
            .then((maquinas) => sessao.emitirDispositivos(maquinas, pareamento.disponivel()))
            .catch(() => undefined);

          /**
           * Insight noturno é um MIMO, não um requisito de sessão.
           *
           * Estava dentro do try que chama `recusar()`: uma tabela ausente no
           * Supabase derrubava o socket com "não foi possível abrir a sessão",
           * e o operador via uma tela que nunca conectava. Ler memória não
           * pode impedir alguém de entrar no escritório.
           */
          try {
            const pendentes = await memoria.insightsPendentes(operador.id_usuario);
            for (const insight of pendentes.slice(0, 1)) {
              sessao.emitirLog(
                'info',
                `Insight do ciclo noturno: ${insight.titulo} — ${insight.detalhe}`,
              );
              await memoria.consumirInsight(operador.id_usuario, insight.id);
            }
          } catch (erro) {
            sessao.emitirLog(
              'alerta',
              `Memória persistente indisponível (${(erro as Error).message}). ` +
                'A sessão continua; o histórico não será gravado. ' +
                'Verifique se supabase/schema.sql foi aplicado.',
            );
          }
        } catch (erro) {
          console.warn(`[iara] falha ao abrir sessão: ${(erro as Error).message}`);
          recusar('Não foi possível abrir a sessão.');
        } finally {
          abrindo = false;
        }
      })();
      return;
    }

    // Nada além de `ola` é aceito antes da identidade estar resolvida.
    if (!operador || !residente?.kernel) return;

    if (pacote.tipo === 'interromper') {
      residente.kernel.cancelar('interrupção do operador');
      return;
    }

    if (pacote.tipo === 'local') {
      /**
       * A posição é do OPERADOR RESOLVIDO, não do id que o pacote traria — ele
       * não traz nenhum, pela mesma razão que a ficha não traz. E não é
       * gravada em lugar nenhum: `LocalOperador` vive em memória do processo e
       * não tem caminho para persistência (ver o cabeçalho de lá).
       */
      registrarLocal(operador.id_usuario, pacote.latitude, pacote.longitude);
      return;
    }

    /**
     * AS MÃOS DESTE OPERADOR — consultar, autorizar, esquecer.
     *
     * Os três passam pelo mesmo lugar que a ficha e pela mesma razão: o dono é
     * `operador.id_usuario`, a identidade RESOLVIDA na apresentação. Nenhum dos
     * pacotes carrega id de usuário, e por isso não existe aqui a pergunta "de
     * quem é este computador".
     *
     * Uma segunda porta HTTP autenticada para isto foi considerada e recusada:
     * duas maneiras de provar identidade no mesmo processo é como uma delas fica
     * para trás — é o mesmo argumento com que a `PonteDispositivos` espelha esta
     * porta em vez de inventar a própria.
     */
    if (
      pacote.tipo === 'dispositivos' ||
      pacote.tipo === 'parear' ||
      pacote.tipo === 'esquecer_dispositivo'
    ) {
      const dono = operador;
      const sessao = minhaSessao;
      if (!sessao) return;
      const pedido = pacote;
      void (async () => {
        let acao: { ok: boolean; texto: string } | undefined;
        try {
          if (pedido.tipo === 'parear') {
            const r = await pareamento.aprovar(pedido.codigo, dono);
            acao = r.ok
              ? { ok: true, texto: `"${r.nome}" foi autorizado. Ele conecta sozinho em segundos.` }
              : { ok: false, texto: r.motivo };
          } else if (pedido.tipo === 'esquecer_dispositivo') {
            const removida = await pareamento.revogar(dono.id_usuario, pedido.id);
            /**
             * A ORDEM importa e não é intercambiável: revoga no banco, DEPOIS
             * derruba o socket. Ao contrário, uma escrita que falhasse deixaria
             * a máquina reconectando em segundos com a credencial ainda válida —
             * e a operadora veria o botão "desconectar" simplesmente não fazer
             * efeito, que é a pior forma de uma trava de segurança falhar.
             */
            const derrubados = removida
              ? ponteDispositivos.derrubarPorCredencial(dono.id_usuario, pedido.id)
              : 0;
            acao = removida
              ? {
                  ok: true,
                  texto: derrubados
                    ? 'Computador desconectado. Ele não volta sem ser autorizado de novo.'
                    : 'Computador esquecido. Se estiver desligado, não volta ao ser ligado.',
                }
              : { ok: false, texto: 'Esse computador já não estava na sua lista.' };
          }
        } catch (erro) {
          acao = { ok: false, texto: `Não consegui: ${(erro as Error).message}` };
        }
        /* A lista é recalculada DEPOIS da ação, sempre — inclusive quando ela
           falhou. Quem acabou de tentar algo precisa ver o estado real, não o
           que estava na tela antes. */
        const maquinas = await inventarioDeMaquinas(dono.id_usuario).catch(() => []);
        sessao.emitirDispositivos(maquinas, pareamento.disponivel(), acao);
      })();
      return;
    }

    if (pacote.tipo === 'preferencias') {
      /**
       * O shard de destino é `operador.id_usuario` — a identidade RESOLVIDA na
       * apresentação, verificada por token quando há Supabase. O pacote não
       * carrega id nenhum, e é por isso que não existe aqui a pergunta "de
       * quem é esta ficha": a resposta é a mesma de sempre, a sessão.
       */
      const r = residente;
      const dono = operador;
      void (async () => {
        try {
          const gravada = await memoria.gravarPreferencias(dono.id_usuario, pacote.preferencias);
          const atual = r.estado.instantaneo().operador;
          await r.estado.definirOperador({
            id_usuario: dono.id_usuario,
            nome: atual?.nome ?? dono.nome,
            visto_em: atual?.visto_em ?? new Date().toISOString(),
            preferencias: gravada,
          });
          // Reidrata TODOS os espelhos: a ficha mudou para o operador, não
          // para a aba que salvou. App desktop e navegador têm que concordar.
          r.ponte?.hidratar();
          minhaSessao?.emitirLog('info', 'Ficha do operador atualizada.');
        } catch (erro) {
          // Falha de escrita é dita em voz alta. Ficha que "salvou" e não
          // salvou faz o operador declarar a mesma coisa de novo na semana
          // seguinte, sem entender por quê.
          minhaSessao?.emitirErro(
            `Não foi possível salvar a ficha: ${(erro as Error).message}`,
          );
        }
      })();
      return;
    }

    if (pacote.tipo === 'mensagem') {
      // Comando humano tem prioridade absoluta sobre o ciclo autônomo.
      residente.ciclo?.parar();
      /**
       * A VOZ SEGUE QUEM FALOU. Este é o único lugar do sistema que sabe de
       * qual tela veio a frase — depois daqui só existe texto. Sem esta linha,
       * a resposta a um comando mandado do celular sai em voz alta no
       * computador do escritório, para uma sala vazia.
       */
      if (minhaSessao) residente.ponte?.dirigirVozPara(minhaSessao);
      const kernel = residente.kernel;
      const r = residente;
      void kernel.processar(pacote.texto).finally(() => {
        /**
         * Religa APENAS o ciclo que ainda é o do residente. Se a última tela
         * fechou durante o turno, o close já fez `ciclo = null` — religar a
         * instância capturada criaria um timer de 15 s órfão, sem nenhuma
         * referência viva capaz de pará-lo, acumulando um por desconexão.
         */
        if (r.sessoes.size > 0) r.ciclo?.iniciar();
      });
    }
  });

  socket.on('close', () => {
    if (!residente || !minhaSessao) return;
    /**
     * PROPRIEDADE. O close só desmonta a sessão DESTE socket. Um close tardio
     * (TCP expirando minutos depois de a sessão já ter sido derrubada pelo
     * teto de espelhos) encontra a sessão fora do conjunto e morre calado.
     */
    if (!residente.sessoes.has(minhaSessao)) return;
    minhaSessao.fechar();
    residente.sessoes.delete(minhaSessao);

    // A última tela saiu: desmonta o transporte e para o trabalho em curso.
    // Com outra tela ainda aberta, o turno segue — fechar o navegador não pode
    // cancelar a resposta que o app desktop está esperando.
    if (residente.sessoes.size === 0) {
      residente.ponte?.encerrar();
      residente.ponte = null;
      residente.compilador?.encerrar();
      residente.compilador = null;
      residente.kernel?.cancelar('todas as telas encerradas');
      residente.ciclo?.parar();
      residente.ciclo = null;

      /* Saiu a última tela: a posição informada pelo aparelho some junto. Ela
         já expiraria sozinha, mas expiração é teto, não política — sessão
         encerrada não deveria deixar rastro de onde a pessoa estava. */
      if (idResidente) esquecerLocal(idResidente);

      /**
       * O RESIDENTE SAI DO MAPA. Sem esta linha, `residentes` só crescia:
       * `residenteDe` inseria e ninguém removia nunca. Cada operador que
       * conectasse uma vez deixava para trás um `EstadoAtomico`, um
       * `BarramentoEventos` e um `Kernel` — com a `MemoriaTrabalho`, o
       * `RegistroErros` e o índice de habilidades dentro — vivos até o processo
       * morrer.
       *
       * Com autenticação ligada o crescimento é limitado pelo número de
       * operadores reais, e o desperdício é discreto o bastante para não
       * aparecer. Em modo local ele não tem teto nenhum: o `id_usuario` vem de
       * um campo que o cliente digita, e um laço de conexões com ids diferentes
       * enche a heap sem precisar de nenhuma credencial. A correção vale nos
       * dois casos e é a mesma.
       *
       * O que se perde ao descartar: nada que seja verdade. O jornal de
       * operações é do PROCESSO (`registroOperacoes`), não do residente; a
       * memória do operador está no shard; a pendência de energia mora no
       * `agenteLocal`, que é singleton. O residente é só o aparato vivo da
       * sessão — e a sessão acabou.
       */
      residente.barramento.limpar();
      if (idResidente) residentes.delete(idResidente);
    } else {
      // A tela que saiu podia ser a líder de voz. Reemitir promove a próxima
      // na hora — sem isto, a IARA ficaria muda até o próximo evento.
      residente.ponte?.hidratar();
    }
  });

  socket.on('error', (erro: Error) => {
    console.warn(`[iara] socket: ${erro.message}`);
  });
}

function nuvemLigada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function encerrarResidentes(): void {
  for (const r of residentes.values()) {
    r.ciclo?.parar();
    r.kernel?.cancelar('desligamento');
    r.ponte?.encerrar();
    r.compilador?.encerrar();
    for (const sessao of r.sessoes) sessao.fechar();
    r.sessoes.clear();
    r.barramento.limpar();
  }
}
