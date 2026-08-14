'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PainelConversa } from '../components/PainelConversa';
import { Portaria } from '../components/Portaria';
import { Presenca } from '../components/projecao/Presenca';
import { useIaraSocket, type Credencial } from '../hooks/useIaraSocket';
import { useVoz } from '../hooks/useVoz';
import { OPERADORES } from '../lib/operadores';
import { autenticacaoDisponivel, supabaseNavegador } from '../lib/supabaseNavegador';

/**
 * A projeção é UMA: a presença — a IARA enquadrada como numa chamada de vídeo
 * (decisão do produto em 08/08/2026). A sala em pixel art continua no repo
 * (`components/Escritorio.tsx`) como projeção alternativa do mesmo
 * SnapshotCognitivo, mas não é mais montada: o rosto é o produto.
 */

/** A sala da IARA. Só monta quando já existe uma credencial resolvida. */
function Sala({ credencial, aoSair }: { credencial: Credencial; aoSair: (() => void) | null }) {
  const {
    snapshot: estado,
    falas,
    conectado,
    conexao,
    motivoDesconexao,
    enviar,
    interromper,
    religar,
    salvarPreferencias,
    maquinas,
    pareamentoDisponivel,
    acaoDispositivo,
    pedirDispositivos,
    autorizarComputador,
    esquecerComputador,
    atualizarComputador,
  } = useIaraSocket(credencial);

  /**
   * A última fala da IARA. É o relógio da articulação da boca no driver 3D —
   * ver `ControladorFacial`. Falas do operador não movem o rosto dela.
   */
  const falaCorrente = useMemo(() => {
    for (let i = falas.length - 1; i >= 0; i -= 1) {
      if (falas[i].papel === 'iara') return falas[i];
    }
    return null;
  }, [falas]);

  /**
   * A voz vive AQUI, acima das duas projeções. A IARA fala tanto no escritório
   * quanto na presença — só a boca é exclusiva do avatar 3D. Montar o áudio
   * dentro de `Presenca` a deixaria muda na sala em pixel art, e trocar de
   * projeção cortaria a fala no meio.
   */
  // `voz_lider` ausente (servidor antigo) vale true: tela única fala normal.
  const voz = useVoz(falaCorrente, true, estado.voz_lider !== false);

  /**
   * Interromper é interromper TUDO: o turno no kernel e a voz que está
   * saindo do alto-falante. Cortar só o servidor deixaria a síntese local
   * terminando a frase de um turno que já morreu.
   */
  const interromperTudo = useCallback(() => {
    voz.silenciar();
    interromper();
  }, [voz, interromper]);

  /**
   * O QR do braço aponta para `?parear=CODIGO` nesta mesma origem. Lido uma
   * vez, no primeiro quadro em que a sala já existe (ou seja, depois do
   * login) — e removido da URL na hora, para que um F5 ou um link
   * reencaminhado não reabra a gaveta com um código que talvez já tenha sido
   * usado ou expirado.
   */
  const [codigoDePareamentoUrl, setCodigoDePareamentoUrl] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get('parear');
    if (!codigo) return;
    setCodigoDePareamentoUrl(codigo);
    params.delete('parear');
    const resto = params.toString();
    window.history.replaceState(null, '', resto ? `?${resto}` : window.location.pathname);
  }, []);

  /**
   * MODO CHAT — o celular, e só ele.
   *
   * No computador a hierarquia é a de sempre: a presença domina o campo visual
   * e a conversa é a camada mais externa. No celular essa composição não cabe.
   * O palco ocupava 58% de uma tela que a barra do navegador já come, e sobrava
   * para a conversa uma janela de uma mensagem — a operadora não conseguia ler
   * o que a IARA respondeu sem rolar.
   *
   * A saída não é encolher a presença até ela virar enfeite: é RECOLHÊ-LA num
   * objeto, no canto, que continua sendo a mesma entidade viva lendo o mesmo
   * snapshot. Ela não vira imagem estática nem ícone desenhado — o Canvas
   * continua montado e continua reagindo, só que num círculo de 56px. Um toque
   * devolve o palco inteiro.
   *
   * Começa recolhido porque no celular a conversa É o trabalho. Este estado não
   * tem efeito nenhum no computador: a classe só é lida dentro da consulta de
   * mídia, e acima de 900px ela não existe.
   */
  const [palcoRecolhido, setPalcoRecolhido] = useState(true);

  return (
    <main className={palcoRecolhido ? 'tela chat-expandido' : 'tela'}>
      <Presenca
        snapshot={estado}
        falaCorrente={falaCorrente}
        voz={voz}
        recolhida={palcoRecolhido}
        aoAlternarRecolhida={() => setPalcoRecolhido((v) => !v)}
        controles={
          aoSair ? (
            /* Só o botão. O nome de quem está na sessão vive no cabeçalho da
               conversa, junto da saudação — dizê-lo duas vezes na mesma tela
               não informa nada e enche o palco, que é a camada que deveria
               ficar mais vazia. */
            <button className="botao" onClick={aoSair}>
              Sair
            </button>
          ) : (
            <SeletorLocal />
          )
        }
      />

      <PainelConversa
        estado={estado}
        falas={falas}
        conectado={conectado}
        conexao={conexao}
        motivoDesconexao={motivoDesconexao}
        onReligar={religar}
        onEnviar={enviar}
        onInterromper={interromperTudo}
        vozFalando={voz.tocando}
        vozLigada={voz.vozLigada}
        vozDisponivel={voz.sinteseDisponivel}
        onAlternarVoz={voz.alternarVoz}
        onFalar={voz.falar}
        textoAvulso={voz.textoAvulso}
        onSalvarPreferencias={salvarPreferencias}
        maquinas={maquinas}
        pareamentoDisponivel={pareamentoDisponivel}
        acaoDispositivo={acaoDispositivo}
        onPedirDispositivos={pedirDispositivos}
        onAutorizarComputador={autorizarComputador}
        onEsquecerComputador={esquecerComputador}
        onAtualizarComputador={atualizarComputador}
        codigoDePareamentoUrl={codigoDePareamentoUrl}
      />

      {/* Política de mídia do navegador exige um gesto antes de tocar som.
          Não é erro — mas ficar em silêncio seria indistinguível de voz
          quebrada, e o operador acharia que a síntese falhou. Fica fora das
          duas projeções porque a voz também é das duas. */}
      {voz.bloqueado && (
        <button className="voz-bloqueada" onClick={voz.liberar}>
          Ativar a voz da IARA
        </button>
      )}
    </main>
  );
}

/**
 * Cada operadora tem a própria conta, e o login é a única porta.
 *
 * Este seletor era o FALLBACK AUTOMÁTICO de quando o Supabase não estava
 * configurado no cliente — e essa automação era um defeito. Em 12/08/2026 o
 * primeiro deploy real subiu com o bundle sem `NEXT_PUBLIC_SUPABASE_*` (as
 * variáveis do host não entram no `docker build` sem `ARG`), e o resultado foi
 * a tela mostrando "modo local sem autenticação" e "a sessão expirou ou foi
 * recusada" ao mesmo tempo: cliente sem login, servidor exigindo token,
 * ninguém entrando. Degradar em silêncio para "escolha quem você é" escondeu a
 * causa e ainda ofereceu uma identidade que o servidor jamais aceitaria.
 *
 * Agora ele exige `NEXT_PUBLIC_IARA_MODO_LOCAL=1`, declarado de propósito. Sem
 * essa variável, falta de login vira TELA DE ERRO — ver `SemLogin`. A regra é a
 * mesma do motor recusando subir sem autenticação em produção: configuração
 * incompleta aparece, não se disfarça de funcionalidade.
 */
function SeletorLocal() {
  const [id, setId] = useState(OPERADORES[0].id);

  useEffect(() => {
    const salvo = window.localStorage.getItem('iara.operador');
    if (salvo && OPERADORES.some((o) => o.id === salvo)) setId(salvo);
  }, []);

  return (
    <select
      className="botao"
      value={id}
      onChange={(e) => {
        window.localStorage.setItem('iara.operador', e.target.value);
        window.location.reload();
      }}
      style={{ padding: '7px 10px' }}
    >
      {OPERADORES.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nome}
        </option>
      ))}
    </select>
  );
}

/**
 * A tela de quando não há login E ninguém pediu o modo local.
 *
 * Ela existe para o caso que já aconteceu: deploy que sobe, healthcheck que
 * passa, página que abre — e um bundle construído sem as chaves do cliente.
 * Sem esta tela o sintoma era um seletor de identidade convidando a operadora a
 * tentar entrar por uma porta que o servidor tinha acabado de trancar.
 *
 * O texto nomeia a variável que falta porque quem vê isto é quem pode corrigir.
 */
function SemLogin() {
  return (
    <main className="carregando">
      <div style={{ maxWidth: '34rem', textAlign: 'center', lineHeight: 1.7 }}>
        <p style={{ letterSpacing: '0.34em', fontWeight: 600, marginBottom: '1.5rem' }}>
          I A R A
        </p>
        <p>Esta instalação está sem login configurado.</p>
        <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>
          O navegador precisa de <code>NEXT_PUBLIC_SUPABASE_URL</code> e{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> em <strong>tempo de build</strong> — elas
          são escritas dentro do bundle, não lidas quando o processo sobe. Num deploy por
          Docker, precisam estar declaradas como <code>ARG</code>.
        </p>
        <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>
          Nenhuma conversa foi perdida: a IARA não chegou a ser aberta.
        </p>
      </div>
    </main>
  );
}

export default function Pagina() {
  const comAuth = autenticacaoDisponivel();
  /**
   * Modo local é OPT-IN, nunca consequência de configuração faltando. Ver o
   * comentário de `SeletorLocal`.
   */
  const modoLocal = process.env.NEXT_PUBLIC_IARA_MODO_LOCAL === '1';
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  const [verificando, setVerificando] = useState(comAuth);

  const lerSessao = useCallback(async () => {
    const bd = supabaseNavegador();
    if (!bd) return;
    const { data } = await bd.auth.getSession();
    const sessao = data.session;
    if (!sessao) {
      setCredencial(null);
      setVerificando(false);
      return;
    }
    setCredencial({
      id_usuario: sessao.user.id,
      nome:
        (sessao.user.user_metadata?.nome as string | undefined) ??
        sessao.user.email?.split('@')[0] ??
        'operador',
      token: sessao.access_token,
    });
    setVerificando(false);
  }, []);

  useEffect(() => {
    if (!comAuth) {
      // Sem login. Só monta identidade se o modo local foi PEDIDO; do
      // contrário a página para em `SemLogin` e diz o que falta.
      if (!modoLocal) return;
      const salvo = window.localStorage.getItem('iara.operador');
      const alvo = OPERADORES.find((o) => o.id === salvo) ?? OPERADORES[0];
      setCredencial({ id_usuario: alvo.id, nome: alvo.nome });
      return;
    }

    void lerSessao();
    const bd = supabaseNavegador();
    // O token expira; `onAuthStateChange` entrega o renovado e o socket
    // reconecta com ele, porque `token` está nas dependências do efeito.
    const { data } = bd!.auth.onAuthStateChange(() => void lerSessao());
    return () => data.subscription.unsubscribe();
  }, [comAuth, modoLocal, lerSessao]);

  if (verificando) {
    return (
      <main className="carregando">
        <span>Abrindo o escritório…</span>
      </main>
    );
  }

  if (comAuth && !credencial) {
    return <Portaria aoEntrar={() => void lerSessao()} />;
  }

  // Sem login e sem modo local pedido: a falta de configuração aparece.
  if (!comAuth && !modoLocal) return <SemLogin />;

  if (!credencial) return null;

  return (
    <>
      {!comAuth && (
        <div className="faixa-aviso">
          Modo local sem autenticação — a identidade vem de um seletor, não de um login.
          Não exponha este processo à internet.
        </div>
      )}
      <Sala
        credencial={credencial}
        aoSair={
          comAuth
            ? () => {
                void supabaseNavegador()!.auth.signOut();
                setCredencial(null);
              }
            : null
        }
      />
    </>
  );
}
