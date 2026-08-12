/**
 * Publica a bolha no `public/` do app web, para o WebView carregá-la em
 * desenvolvimento.
 *
 * Em dev as duas janelas apontam para `devUrl` (localhost:3000), então a bolha
 * precisa ser servida pelo motor — `ui/bolha.html` sozinho não é alcançável por
 * HTTP. Em produção não há cópia: `frontendDist` empacota `ui/` direto.
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

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relativo a ESTE arquivo, nunca ao cwd: quem invoca o script é o Tauri, e o
// diretório de trabalho dele não é contrato nosso.
const aqui = dirname(fileURLToPath(import.meta.url));

const publico = join(aqui, '..', 'web', 'public');
mkdirSync(publico, { recursive: true });
copyFileSync(join(aqui, 'ui', 'bolha.html'), join(publico, 'bolha.html'));

/**
 * A imagem da bolha vai junto, nos DOIS sentidos, porque ela é servida de
 * lugares diferentes em cada modo:
 *   dev        — a janela aponta para localhost:3000, então o arquivo precisa
 *                estar na raiz de `web/public` (o HTML o pede como vizinho);
 *   produção   — `frontendDist` empacota `ui/`, e o arquivo precisa estar lá.
 *
 * A FONTE MUDOU: era `iara-simbolo.png`, o rosto cromado. Agora é
 * `iara-esfera.png`, a própria entidade — assada por `app/marca/esfera`, que
 * renderiza a pedra com os mesmos materiais, o mesmo estúdio e a mesma lente
 * do palco.
 *
 * A DIVISÃO É DELIBERADA e vale registrar, porque as duas imagens convivem:
 *   · o LOGOTIPO (portaria, ícone do app, barra de tarefas, PWA) continua
 *     sendo o rosto cromado com IARA gravada — é a MARCA, o que identifica o
 *     produto de fora;
 *   · a BOLHA é a esfera — é a IARA em si, a presença. Quem está com o app
 *     aberto não precisa da marca no canto da tela: precisa dela.
 * Trocar uma pela outra apaga essa distinção.
 *
 * Aqui só se copia.
 */
const bolha = join(publico, 'marca', 'iara-esfera.png');

/* FALHA EXPLÍCITA, e ela existe por causa do desktop.
   Este script é o `beforeDevCommand` E o `beforeBuildCommand` do Tauri: se ele
   estoura, o app não abre. Um ENOENT cru aqui aparece como um traço de pilha do
   Node no meio do log do Tauri, e a pessoa vai procurar o defeito no Rust.
   A imagem da esfera é assada à mão em /marca/esfera — diferente do rosto, que
   `npm run marca` regenera a partir das fotografias versionadas. Ou seja: este
   arquivo TEM de estar no repositório, e se um dia sair, a mensagem abaixo diz
   exatamente o que fazer. */
if (!existsSync(bolha)) {
  console.error([
    `[bolha] FALTA a imagem da esfera: ${bolha}`,
    '        Ela é assada à mão: rode o app web, abra /marca/esfera, clique em',
    '        "Baixar PNG" e salve nesse caminho. O arquivo é versionado — se',
    '        sumiu do clone, provavelmente foi ignorado por engano.',
  ].join('\n'));
  process.exit(1);
}
copyFileSync(bolha, join(publico, 'iara-esfera.png'));
copyFileSync(bolha, join(aqui, 'ui', 'iara-esfera.png'));

console.log(`[bolha] publicada em ${publico}`);
