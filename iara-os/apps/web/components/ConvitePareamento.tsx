'use client';

/**
 * O CONVITE DE PAREAMENTO — o QR do Braço, na tela da IARA.
 *
 * QUE OBJETO DA SALA É ISTO. É a IARA segurando um crachá na altura dos olhos:
 * "aponte o celular aqui". O Braço acabou de pedir um código ao motor e abriu
 * o navegador em `/?convite=<código>`; esta é a única tela do sistema cujo
 * trabalho é ser FOTOGRAFADA — por isso o QR é grande, claro e centrado, e
 * todo o resto se afasta.
 *
 * POR QUE SOBREPOSTO, contra a regra da hierarquia espacial: o computador novo
 * pode nem estar logado (é a primeira vez dele), então não existe "painel"
 * sobre o qual ocupar fluxo — o convite precisa aparecer sobre a Portaria, a
 * sala ou o aviso de modo local, indistintamente. Ele não é uma camada do
 * escritório: é um recado preso no vidro da porta, e sai da frente num toque.
 *
 * O QUE ELE NÃO FAZ: autorizar. O QR e o código só ABREM o pedido no celular;
 * a autoridade continua inteira na sessão logada que toca "Autorizar" — ver
 * `Pareamento.ts`. Exibir este código para quem está na frente do computador
 * não entrega nada que o terminal do Braço já não mostrasse.
 *
 * O QR é gerado AQUI, no cliente, com o mesmo `qrcode` que o Braço usa no
 * terminal — o código nunca vai a servidor nenhum para virar imagem.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ehCodigoPossivel, formatarCodigo, normalizarCodigo } from '../lib/codigoPareamento';

/** O conteúdo do QR: o link que o CELULAR abre, com o código embutido. */
function linkParaOCelular(codigo: string): string {
  return `${window.location.origin}/?parear=${codigo}`;
}

export function ConvitePareamento({
  codigo,
  aoFechar,
}: {
  /** Já normalizado por quem leu a URL (`lerConviteDaUrl`). */
  codigo: string;
  aoFechar: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    /* Módulos escuros sobre claro, sempre: leitor de QR precisa de contraste
       real, e o cartão claro no meio da tela grafite é o que faz o convite
       parecer um crachá — não um buraco no tema. */
    QRCode.toDataURL(linkParaOCelular(codigo), {
      width: 480,
      margin: 2,
      color: { dark: '#0b0d0f', light: '#f4f6f8' },
    })
      .then((url) => {
        if (vivo) setQr(url);
      })
      .catch(() => {
        /* Sem QR ainda há convite: o código digitável abaixo é o caminho
           completo sozinho. */
      });
    return () => {
      vivo = false;
    };
  }, [codigo]);

  return (
    <div className="convite-fundo" role="dialog" aria-modal="true" aria-label="Conectar este computador">
      <section className="convite">
        <header className="ficha-cabecalho">
          <h2>Conectar este computador</h2>
          <button className="ficha-fechar" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
        </header>

        <p className="ficha-nota">
          Aponte a câmera do celular para o código abaixo. A IARA abre, você
          entra na sua conta, dá um nome a este computador — e ele passa a
          atender.
        </p>

        {qr && (
          <div className="convite-qr">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL
                gerada localmente; next/image não otimiza nem precisa. */}
            <img src={qr} alt={`QR do pareamento — código ${formatarCodigo(codigo)}`} />
          </div>
        )}

        <p className="convite-codigo" aria-label="Código para digitar">
          {formatarCodigo(codigo)}
        </p>
        <small className="convite-codigo-nota">
          Sem câmera? Abra a IARA no celular, vá em <strong>Dispositivos</strong>{' '}
          e digite o código acima. Ele vale por 5 minutos — se expirar, a
          Automação mostra um novo.
        </small>
      </section>
    </div>
  );
}

/**
 * Lê `?convite=` UMA vez e limpa a URL — mesma disciplina do `?parear=` da
 * página: um F5 ou um link reencaminhado não deve ressuscitar um convite que
 * talvez já tenha expirado.
 *
 * Normaliza e VALIDA contra o alfabeto do pareamento antes de devolver:
 * qualquer coisa que não seja um código possível (tamanho errado, caractere
 * fora do alfabeto) vira `null` e nenhum popover nasce — a URL é a única
 * entrada não confiável desta tela.
 */
export function lerConviteDaUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const bruto = params.get('convite');
  if (!bruto) return null;

  params.delete('convite');
  const resto = params.toString();
  window.history.replaceState(
    null,
    '',
    resto ? `?${resto}` : window.location.pathname,
  );

  const codigo = normalizarCodigo(bruto);
  return ehCodigoPossivel(codigo) ? codigo : null;
}
