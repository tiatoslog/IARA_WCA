'use client';

/**
 * ONDE A IARA TEM MÃOS — a gaveta dos computadores ligados a este operador.
 *
 * QUE OBJETO DA SALA É ISTO. É o quadro de chaves ao lado da porta: a lista do
 * que a IARA consegue alcançar quando alguém pede alguma coisa. Não é "gerenciar
 * dispositivos", não é um painel de administração e não tem gráfico nenhum — é
 * um quadro com etiquetas, onde cada linha responde a UMA pergunta ("essa
 * máquina atende agora?") e onde tirar uma chave do quadro é um gesto só.
 *
 * Por isso o texto fala na voz dela e sobre o mundo da operadora ("este
 * computador", "desligado agora"), nunca sobre o nosso ("device offline",
 * "sessão WebSocket encerrada").
 *
 * MORA NA MESMA GAVETA DA FICHA, e ocupa o fluxo do painel em vez de flutuar
 * sobre ele — a hierarquia espacial é fixa e o painel já é a camada mais
 * externa. Ver `FichaOperador`, que estabeleceu a forma.
 *
 * O QUE ELA NÃO FAZ: não inventa estado. Uma máquina só aparece como conectada
 * porque existe um socket vivo agora, e "última sessão" é um carimbo que o
 * motor gravou — nunca uma estimativa. Se a lista ainda não chegou, a gaveta diz
 * que está perguntando, em vez de mostrar uma lista vazia que pareceria a
 * resposta.
 */

import { useEffect, useState } from 'react';
import { lerManifestoBraco, type MaquinaDoOperador } from '../lib/execucao';

/** Lida uma vez por módulo — as três variáveis são estáticas de build, não
 *  mudam durante a vida do processo do navegador. */
const MANIFESTO = lerManifestoBraco();

/**
 * "há 3 minutos", e não "13/08/2026 14:32:07".
 *
 * A pergunta que esta coluna responde é "faz muito tempo?", e um carimbo
 * absoluto obriga quem lê a fazer a subtração de cabeça. Acima de um dia o
 * relativo perde a graça ("há 37 dias" não diz nada), e aí a data volta.
 */
function quandoFoi(instante: number | null): string {
  if (!instante) return 'nunca conectou';
  const s = Math.max(0, Math.round((Date.now() - instante) / 1000));
  if (s < 90) return 'agora há pouco';
  const min = Math.round(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(instante).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** `win32 10.0.26200` → `Windows`. O número da build não ajuda ninguém a
 *  reconhecer a própria máquina; o nome do sistema, sim. */
function sistemaLegivel(plataforma: string): string {
  const p = plataforma.toLowerCase();
  if (p.startsWith('win')) return 'Windows';
  if (p.startsWith('darwin')) return 'Mac';
  if (p.startsWith('linux')) return 'Linux';
  return plataforma.split(' ')[0] || 'computador';
}

function Maquina({
  maquina,
  podeAgir,
  aoEsquecer,
  aoAtualizar,
  aoRenomear,
}: {
  maquina: MaquinaDoOperador;
  podeAgir: boolean;
  aoEsquecer: (id: string) => void;
  aoAtualizar: (id: string) => void;
  aoRenomear: (id: string, nome: string) => void;
}) {
  /**
   * Confirmação em dois toques, no próprio botão. Um `window.confirm` seria uma
   * caixa do sistema operacional em cima da sala — a única coisa nesta tela que
   * não pertence ao escritório da IARA. E desconectar sem confirmar nenhuma vez
   * é um clique errado que tira as mãos da pessoa sem ela entender por quê.
   */
  const [confirmando, setConfirmando] = useState(false);
  useEffect(() => {
    if (!confirmando) return;
    const t = setTimeout(() => setConfirmando(false), 4000);
    return () => clearTimeout(t);
  }, [confirmando]);

  /**
   * RENOMEAR — Etapa 4 (14/08/2026). O hostname que o braço reporta sozinho
   * ("DESKTOP-7F2A") não diz nada à operadora; só ela sabe se é "meu
   * notebook" ou "PC da recepção". Clicar no nome abre a edição — o mesmo
   * gesto de renomear um arquivo, não um formulário à parte.
   */
  const [editando, setEditando] = useState(false);
  const [rascunhoNome, setRascunhoNome] = useState(maquina.nome);
  useEffect(() => {
    if (!editando) setRascunhoNome(maquina.nome);
  }, [maquina.nome, editando]);

  const confirmarNome = () => {
    const limpo = rascunhoNome.trim();
    setEditando(false);
    if (limpo && limpo !== maquina.nome) aoRenomear(maquina.id, limpo);
    else setRascunhoNome(maquina.nome);
  };

  return (
    <li className="maquina">
      <span
        aria-hidden
        className={maquina.conectada ? 'maquina-sinal ligado' : 'maquina-sinal'}
      />
      <div className="maquina-corpo">
        {editando ? (
          <input
            type="text"
            className="maquina-nome-editar"
            value={rascunhoNome}
            maxLength={80}
            autoFocus
            aria-label={`Nome de ${maquina.nome}`}
            onChange={(e) => setRascunhoNome(e.target.value)}
            onBlur={confirmarNome}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmarNome();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRascunhoNome(maquina.nome);
                setEditando(false);
              }
            }}
          />
        ) : maquina.pareada ? (
          <button
            type="button"
            className="maquina-nome maquina-nome-botao"
            disabled={!podeAgir}
            title="Dar um nome a este computador"
            onClick={() => setEditando(true)}
          >
            {maquina.nome}
          </button>
        ) : (
          <span className="maquina-nome">{maquina.nome}</span>
        )}
        <span className="maquina-detalhe">
          {sistemaLegivel(maquina.plataforma)}
          {' · '}
          {maquina.conectada ? 'atendendo agora' : `desligado — ${quandoFoi(maquina.vista_em)}`}
          {maquina.versao && ` · v${maquina.versao}`}
        </span>
        {/*
          Achado em auditoria (14/08/2026): o braço, uma vez instalado, ficava
          congelado na versão baixada para sempre — nada detectava, nada
          avisava, nada atualizava sozinho. Etapa 1 (aviso) + Etapa 2
          (atualização automática, com barra de progresso de verdade) +
          Etapa 3 (notas de versão) fecham isso em camadas, nesta ordem:
          atualizando > erro > desatualizada — uma máquina só está em UM
          desses estados por vez.
        */}
        {maquina.atualizando !== null ? (
          <span className="maquina-detalhe maquina-atualizando" role="status">
            atualizando… {Math.round(maquina.atualizando)}%
            <span className="maquina-barra" aria-hidden>
              <span
                className="maquina-barra-preenchida"
                style={{ width: `${Math.round(maquina.atualizando)}%` }}
              />
            </span>
          </span>
        ) : (
          <>
            {maquina.erroAtualizacao && (
              <span className="maquina-detalhe maquina-desatualizada" role="alert">
                não consegui atualizar: {maquina.erroAtualizacao}
              </span>
            )}
            {maquina.desatualizada && (
              <span className="maquina-detalhe maquina-desatualizada">
                versão do programa desatualizada
                {MANIFESTO.notas && <span className="maquina-notas-versao"> — {MANIFESTO.notas}</span>}
                {!maquina.conectada && MANIFESTO.url && (
                  <>
                    {' — '}
                    <a href={MANIFESTO.url} download>
                      baixe a versão nova
                    </a>
                  </>
                )}
              </span>
            )}
          </>
        )}
      </div>
      {maquina.desatualizada && maquina.conectada && maquina.atualizando === null && (
        <button
          className="maquina-atualizar"
          disabled={!podeAgir}
          title="Baixa, confere e substitui sozinha — o computador reabre a IARA na versão nova"
          onClick={() => aoAtualizar(maquina.id)}
        >
          Atualizar agora
        </button>
      )}
      {maquina.pareada ? (
        <button
          className={confirmando ? 'maquina-soltar confirmando' : 'maquina-soltar'}
          disabled={!podeAgir}
          onClick={() => {
            if (!confirmando) {
              setConfirmando(true);
              return;
            }
            setConfirmando(false);
            aoEsquecer(maquina.id);
          }}
        >
          {confirmando ? 'Confirmar' : 'Desconectar'}
        </button>
      ) : (
        /* Braço sem credencial durável: token colado à mão ou modo local. Ele
           executa de verdade, então está na lista — mas não há credencial a
           revogar, e oferecer o botão seria prometer o que não se cumpre. */
        <span className="maquina-nota">de desenvolvimento</span>
      )}
    </li>
  );
}

export function Dispositivos({
  maquinas,
  conectado,
  pareamentoDisponivel,
  ultimaAcao,
  aoPedirLista,
  codigoInicial = null,
  aoAutorizar,
  aoEsquecer,
  aoAtualizar,
  aoRenomear,
  aoFechar,
}: {
  /** `null` = a lista ainda não chegou. Ver o cabeçalho. */
  maquinas: MaquinaDoOperador[] | null;
  conectado: boolean;
  /** `false` quando a instalação está sem banco: não há onde guardar o par. */
  pareamentoDisponivel: boolean;
  ultimaAcao: { ok: boolean; texto: string } | null;
  /** Veio do QR do braço — poupa digitar, não poupa o toque em "Autorizar". */
  codigoInicial?: string | null;
  aoPedirLista: () => boolean;
  /** `nome` é o batismo opcional da máquina — vazio, vale o hostname. */
  aoAutorizar: (codigo: string, nome?: string) => boolean;
  aoEsquecer: (id: string) => void;
  /** Etapa 2 (14/08/2026) — "Atualizar agora". */
  aoAtualizar: (id: string) => void;
  /** Etapa 4 (14/08/2026) — dar um nome à máquina, escolhido pela operadora. */
  aoRenomear: (id: string, nome: string) => void;
  aoFechar: () => void;
}) {
  /**
   * DUAS VISTAS, NUNCA MISTURADAS — achado em auditoria de UX (15/08/2026): a
   * versão anterior despejava lista + código + instalação + explicação no
   * mesmo golpe de vista, e uma pessoa nova não sabia o que olhar primeiro.
   *
   * `lista` é o quadro de chaves (o que já está ligado); `conectar` é o
   * assistente de ligar uma máquina nova. Uma pessoa só está fazendo UMA
   * dessas coisas por vez — a tela agora diz isso.
   *
   * Chega direto em `conectar` quando veio código do QR do braço: poupar o
   * "abrir a gaveta certa" é o ponto inteiro do atalho.
   */
  const [vista, setVista] = useState<'lista' | 'conectar'>(codigoInicial ? 'conectar' : 'lista');
  const [codigo, setCodigo] = useState(codigoInicial ?? '');
  /**
   * O BATISMO — Etapa do convite (15/08/2026). "DESKTOP-7F2A" não diz nada;
   * "Notebook Daiane" diz tudo. O campo vive AQUI, na autorização, porque é o
   * único momento em que a pessoa está olhando para os dois aparelhos ao mesmo
   * tempo e sabe exatamente qual computador é este. Opcional: vazio, vale o
   * nome que a máquina reportou — e renomear depois continua existindo.
   */
  const [nomeBatismo, setNomeBatismo] = useState('');

  /**
   * Pergunta ao abrir e a cada 15 s enquanto a gaveta está aberta.
   *
   * Não é assinatura: quando a gaveta fecha, o efeito é desmontado e o tráfego
   * para. Empurrar do servidor a cada socket que sobe ou cai custaria mensagem
   * contínua por uma tela que passa 99% do tempo fechada — e não resolveria o
   * caso que importa, que é a máquina que conecta AGORA, enquanto a pessoa
   * olha, logo depois de ela ter autorizado o código.
   */
  useEffect(() => {
    if (!conectado) return;
    aoPedirLista();
    const t = setInterval(aoPedirLista, 15_000);
    return () => clearInterval(t);
  }, [conectado, aoPedirLista]);

  /* Autorizou com sucesso: o campo se esvazia sozinho e o assistente devolve
     a pessoa para o quadro de chaves, onde a máquina nova já aparece. Deixar
     o código na caixa convida ao segundo clique, e o segundo clique num
     código já usado responde "não confere" — um erro que a própria tela
     produziu. */
  useEffect(() => {
    if (!ultimaAcao?.ok) return;
    setCodigo('');
    setNomeBatismo('');
    setVista('lista');
  }, [ultimaAcao]);

  /**
   * O RECADO SOME SOZINHO, DEPOIS DE UM TEMPO PRA LER — nunca antes disso.
   *
   * Achado em auditoria (14/08/2026): a versão anterior deixava o servidor
   * apagar `ultimaAcao` a cada poll de 15 s sem ação nova — e como a gaveta
   * também pergunta a lista ao ABRIR, um "autorizado com sucesso" podia sumir
   * em menos de um segundo se a resposta do pareamento e o poll seguinte se
   * cruzassem. Agora o servidor só troca o recado quando há ação nova (ver
   * `useIaraSocket`), e é esta tela — não o poll — que decide quando ele
   * deixa de valer a pena mostrar.
   */
  const [recadoLocal, setRecadoLocal] = useState(ultimaAcao);
  useEffect(() => {
    setRecadoLocal(ultimaAcao);
    if (!ultimaAcao) return;
    const t = setTimeout(() => setRecadoLocal(null), 6000);
    return () => clearTimeout(t);
  }, [ultimaAcao]);

  const autorizar = () => {
    if (codigo.trim()) aoAutorizar(codigo, nomeBatismo.trim() || undefined);
  };

  return (
    <section className="ficha" aria-label="Computadores conectados">
      <header className="ficha-cabecalho">
        <h2>{vista === 'conectar' ? 'Conectar computador' : 'Onde a IARA tem mãos'}</h2>
        {vista === 'lista' && (
          <button
            type="button"
            className="ficha-ajuda"
            aria-label="O que é isto"
            title="A IARA pensa na nuvem, mas quem abre um programa ou cria uma pasta é o computador que você ligou a ela."
          >
            ?
          </button>
        )}
        <button className="ficha-fechar" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
      </header>

      {vista === 'lista' ? (
        <>
          {maquinas === null ? (
            <p className="maquina-vazio">Perguntando…</p>
          ) : maquinas.length === 0 ? (
            <p className="maquina-vazio">
              Nenhum computador conectado ainda. Conecte um para a IARA poder
              agir nele diretamente.
            </p>
          ) : (
            <ul className="maquinas">
              {maquinas.map((m) => (
                <Maquina
                  key={m.id}
                  maquina={m}
                  podeAgir={conectado}
                  aoEsquecer={aoEsquecer}
                  aoAtualizar={aoAtualizar}
                  aoRenomear={aoRenomear}
                />
              ))}
            </ul>
          )}

          {pareamentoDisponivel ? (
            <button
              type="button"
              className="dispositivos-conectar-novo"
              onClick={() => setVista('conectar')}
              disabled={!conectado}
            >
              + Conectar computador
            </button>
          ) : (
            <small>
              Esta instalação da IARA está sem banco configurado, então não há onde
              guardar o par. Quem publicou o sistema precisa configurar o Supabase
              no motor.
            </small>
          )}

          {recadoLocal && (
            <small className={recadoLocal.ok ? 'parear-recado ok' : 'parear-recado erro'} role="status">
              {recadoLocal.texto}
            </small>
          )}
        </>
      ) : (
        <div className="dispositivos-assistente">
          <button type="button" className="dispositivos-voltar" onClick={() => setVista('lista')}>
            ← Voltar
          </button>

          <p className="ficha-nota">
            A IARA precisa de uma "mão" nesse computador para executar tarefas
            nele.
          </p>

          <ol className="dispositivos-passos">
            <li className="dispositivos-passo">
              <span className="dispositivos-passo-numero">1</span>
              <div className="dispositivos-passo-corpo">
                <p>Instale o Braço</p>
                {MANIFESTO.url ? (
                  <a className="ficha-salvar instalar" href={MANIFESTO.url} download>
                    Baixar o programa
                  </a>
                ) : (
                  <small>
                    Ainda não há um instalador publicado nesta instalação. Quem
                    cuida do sistema gera o programa com{' '}
                    <code>npm run empacotar:braco</code> e publica o endereço dele
                    em <code>NEXT_PUBLIC_IARA_INSTALADOR</code>.
                  </small>
                )}
              </div>
            </li>
            <li className="dispositivos-passo">
              <span className="dispositivos-passo-numero">2</span>
              <div className="dispositivos-passo-corpo">
                <p>Abra o Braço no computador</p>
                <small>
                  A IARA abre na tela dele com um QR e um código de oito letras e
                  números.
                </small>
              </div>
            </li>
            <li className="dispositivos-passo">
              <span className="dispositivos-passo-numero">3</span>
              <div className="dispositivos-passo-corpo">
                <p>Digite o código, ou aponte a câmera para o QR</p>
                {pareamentoDisponivel ? (
                  <>
                    <input
                      type="text"
                      className="parear-codigo"
                      value={codigo}
                      placeholder="H7K2-9QP4"
                      maxLength={12}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-label="Código que apareceu no computador"
                      onChange={(e) => setCodigo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          autorizar();
                        }
                      }}
                    />
                    {/*
                      O batismo entra ANTES do botão: com o código vindo do QR
                      já preenchido, este campo é a única coisa que sobra para
                      a pessoa fazer — dar o nome e salvar.
                    */}
                    <div className="parear-linha">
                      <input
                        type="text"
                        className="parear-codigo parear-nome"
                        value={nomeBatismo}
                        placeholder="Nome (ex.: Notebook Daiane)"
                        maxLength={80}
                        aria-label="Nome deste computador"
                        onChange={(e) => setNomeBatismo(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            autorizar();
                          }
                        }}
                      />
                      <button
                        className="ficha-salvar"
                        onClick={autorizar}
                        disabled={!conectado || !codigo.trim()}
                      >
                        Salvar
                      </button>
                    </div>
                    <small>
                      O QR abre esta tela com o código já preenchido — falta só o
                      nome. Sem nome, vale o que o computador reportar; dá para
                      renomear depois, no quadro.
                    </small>
                  </>
                ) : (
                  <small>
                    Esta instalação da IARA está sem banco configurado, então não há
                    onde guardar o par. Quem publicou o sistema precisa configurar o
                    Supabase no motor.
                  </small>
                )}
              </div>
            </li>
          </ol>

          {recadoLocal && (
            <small className={recadoLocal.ok ? 'parear-recado ok' : 'parear-recado erro'} role="status">
              {recadoLocal.texto}
            </small>
          )}
        </div>
      )}
    </section>
  );
}
