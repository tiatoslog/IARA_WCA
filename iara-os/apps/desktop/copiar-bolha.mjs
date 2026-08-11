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

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relativo a ESTE arquivo, nunca ao cwd: quem invoca o script é o Tauri, e o
// diretório de trabalho dele não é contrato nosso.
const aqui = dirname(fileURLToPath(import.meta.url));

const origem = join(aqui, 'ui', 'bolha.html');
const destino = join(aqui, '..', 'web', 'public', 'bolha.html');

mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origem, destino);

console.log(`[bolha] publicada em ${destino}`);
