/**
 * Sonda do OCR local. SÓ LÊ — não grava nada, em lugar nenhum.
 *
 *     npx tsx scripts/diagnostico/sondar-ocr.ts
 *
 * Responde três coisas que não se pode supor: se ESTA máquina tem o motor de
 * OCR do Windows, quanto ele custa, e o que a máscara faz com o que ele leu.
 *
 * A terceira é a que mais importa. Um teste unitário prova a máscara contra
 * texto escrito por mim; esta sonda a joga contra o que o OCR de verdade leu de
 * uma tela de verdade, que é onde aparecem as formas que ninguém previu.
 */

import { CapturaDeQuadro, percepcaoIndisponivelPorque } from '../../servidor/braco/CapturaDeQuadro';
import { linhasDeMensagem, prepararTextoDaTela } from '../../lib/mascara';

async function principal(): Promise<void> {
  const indisponivel = percepcaoIndisponivelPorque();
  if (indisponivel) {
    console.log(`sem OCR: ${indisponivel}`);
    return;
  }

  const c = new CapturaDeQuadro();
  try {
    c.iniciar();
    const j = await c.janela();
    if (!j) {
      console.log('nenhuma janela em foco');
      return;
    }
    console.log(`janela em foco: ${j.processo} (${j.largura}x${j.altura})`);

    const t0 = Date.now();
    const r = await c.texto(j.handle);
    if (!r) {
      console.log('OCR indisponível nesta máquina (sem pacote de idioma, ou o foco mudou)');
      return;
    }
    console.log(`OCR: ${r.linhas.length} linhas em ${r.ms} ms (ida e volta ${Date.now() - t0} ms)`);

    const preparado = prepararTextoDaTela(r.linhas);
    console.log(
      `máscara encontrou: ${preparado.encontrados.join(', ') || '(nada com forma sensível)'}`,
    );
    console.log('--- o texto que SAIRIA no evento ---');
    console.log(preparado.texto);
    console.log('--- linhas com forma de mensagem de sistema ---');
    console.log(linhasDeMensagem(preparado.texto.split('\n')).join(' | ') || '(nenhuma)');
  } finally {
    c.encerrar();
  }
}

void principal();
