/**
 * Publica a imagem da esfera ao lado do HTML da bolha, em `ui/`.
 *
 * SIMPLIFICOU EM 12/08/2026, e a razão vale registrar porque o script antigo
 * era o dobro do tamanho. Ele copiava `bolha.html` e a esfera para o `public/`
 * do app web, porque em dev as janelas apontavam para `devUrl`
 * (localhost:3000) e `ui/bolha.html` não era alcançável por HTTP.
 *
 * Com o shell virando casca fina, a janela principal deixou de ser declarada no
 * `tauri.conf.json` — o destino dela é decidido em Rust, em runtime. Aí o
 * `devUrl` não servia mais a ninguém, e sem ele o Tauri resolve os assets a
 * partir de `frontendDist` (`../ui`) TANTO em dev quanto em produção.
 *
 * Isso não foi só limpeza. A página offline PRECISA disso: se ela fosse servida
 * pelo motor, seria impossível mostrá-la justamente quando o motor não
 * responde — que é a única situação em que ela existe. Um asset local não pode
 * depender do servidor que ele existe para substituir.
 *
 * De quebra, saíram 655 KB de `public/` (o `bolha.html` e a esfera duplicados
 * que eram servidos por HTTP para ninguém).
 *
 * POR QUE UM ARQUIVO, E NÃO UM `node -e` NO tauri.conf.json:
 * o comando inline anterior era
 *
 *     node -e "require('node:fs').copyFileSync('ui/bolha.html', ...)"
 *
 * e as aspas duplas chegavam LITERAIS ao node no Windows. O que ele avaliava
 * era `"require(...)"` — um literal de string, expressão válida que não faz
 * nada e sai com código 0. O Tauri reportava sucesso, a cópia nunca acontecia e
 * a bolha abria em "The page could not be loaded". Falha silenciosa por
 * regra de aspas, não por lógica. Um arquivo não tem esse problema.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relativo a ESTE arquivo, nunca ao cwd: quem invoca o script é o Tauri, e o
// diretório de trabalho dele não é contrato nosso.
const aqui = dirname(fileURLToPath(import.meta.url));

/**
 * A FONTE da esfera é o app web, e a divisão é deliberada porque as duas
 * imagens da marca convivem:
 *   · o LOGOTIPO (portaria, ícone do app, barra de tarefas, PWA) é o rosto
 *     cromado com IARA gravada — é a MARCA, o que identifica o produto de fora;
 *   · a BOLHA é a esfera — é a IARA em si, a presença. Quem está com o app
 *     aberto não precisa da marca no canto da tela: precisa dela.
 * Trocar uma pela outra apaga essa distinção.
 *
 * Aqui só se copia.
 */
const origem = join(aqui, '..', 'web', 'public', 'marca', 'iara-esfera.png');

/* FALHA EXPLÍCITA, e ela existe por causa do desktop.
   Este script é o `beforeDevCommand` E o `beforeBuildCommand` do Tauri: se ele
   estoura, o app não abre. Um ENOENT cru aqui aparece como um traço de pilha do
   Node no meio do log do Tauri, e a pessoa vai procurar o defeito no Rust.
   A imagem da esfera é assada à mão em /marca/esfera — diferente do rosto, que
   `npm run marca` regenera a partir das fotografias versionadas. Ou seja: este
   arquivo TEM de estar no repositório, e se um dia sair, a mensagem abaixo diz
   exatamente o que fazer. */
if (!existsSync(origem)) {
  console.error(
    [
      `[bolha] FALTA a imagem da esfera: ${origem}`,
      '        Ela é assada à mão: rode o app web, abra /marca/esfera, clique em',
      '        "Baixar PNG" e salve nesse caminho. O arquivo é versionado — se',
      '        sumiu do clone, provavelmente foi ignorado por engano.',
    ].join('\n'),
  );
  process.exit(1);
}

const destino = join(aqui, 'ui', 'iara-esfera.png');
copyFileSync(origem, destino);

console.log(`[bolha] esfera publicada em ${destino}`);
