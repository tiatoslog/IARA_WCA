/**
 * O SANDBOX DE DISCO da campanha.
 *
 * `AgenteLocal.resolverRaiz` resolve "Área de Trabalho" chamando `homedir()` do
 * `node:os`, e no Windows `homedir()` lê `USERPROFILE`. Subir o motor da
 * campanha com essa variável apontando para um diretório descartável é o que
 * faz TODA escrita da IARA cair aqui dentro em vez de cair na Área de Trabalho
 * de quem estiver dormindo do outro lado da máquina.
 *
 * Não é um detalhe de higiene. A campanha manda a IARA criar pasta, tirar
 * print e abrir programa às três da manhã, sem ninguém olhando — e a diferença
 * entre um teste e um estrago é exatamente esta variável.
 *
 * A PEGADINHA, que custou uma leitura de código para achar: `resolverRaiz`
 * devolve `null` quando nenhum candidato existe, porque ela usa `existsSync`.
 * Sandbox sem `Desktop` não redireciona a IARA — faz ela recusar. Por isso os
 * três diretórios nascem AQUI, antes do motor subir, e a subida confere.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface Sandbox {
  readonly raiz: string;
  readonly area_de_trabalho: string;
  readonly documentos: string;
  readonly downloads: string;
}

/**
 * Os nomes que `resolverRaiz` alcança numa máquina sem OneDrive. Se a lista de
 * candidatos do `AgenteLocal` mudar, a campanha para de redirecionar em
 * silêncio — e é por isso que `conferirSandbox` existe e é chamado na subida.
 */
const PASTAS = ['Desktop', 'Documents', 'Downloads'] as const;

export function criarSandbox(rotulo: string): Sandbox {
  const raiz = mkdtempSync(path.join(tmpdir(), `iara-campanha-${rotulo}-`));
  for (const p of PASTAS) mkdirSync(path.join(raiz, p), { recursive: true });
  return {
    raiz,
    area_de_trabalho: path.join(raiz, 'Desktop'),
    documentos: path.join(raiz, 'Documents'),
    downloads: path.join(raiz, 'Downloads'),
  };
}

/**
 * O sandbox está de pé? Chamado ANTES de subir o motor.
 *
 * Devolve a lista do que falta em vez de um booleano: "o sandbox está inválido"
 * manda quem lê procurar em três lugares; "falta Downloads" resolve na hora.
 */
export function conferirSandbox(s: Sandbox): string[] {
  return [s.raiz, s.area_de_trabalho, s.documentos, s.downloads].filter((p) => !existsSync(p));
}

/**
 * Apaga o sandbox. Recebe a raiz e confere que ela é mesmo uma raiz de
 * campanha antes de recursivamente remover qualquer coisa.
 *
 * A conferência parece paranoia e não é: este é o único `rm -rf` do
 * repositório, ele roda sem ninguém olhando, e o argumento dele nasce de uma
 * concatenação de caminho. Um `path.join` com um campo vazio já apagou projeto
 * em mais de um lugar no mundo. O prefixo é a trava.
 */
export function removerSandbox(s: Sandbox): void {
  const base = path.basename(s.raiz);
  if (!base.startsWith('iara-campanha-')) {
    throw new Error(`recusando remover "${s.raiz}": não tem a marca de sandbox da campanha`);
  }
  if (path.dirname(s.raiz) !== tmpdir()) {
    throw new Error(`recusando remover "${s.raiz}": está fora do diretório temporário do sistema`);
  }
  rmSync(s.raiz, { recursive: true, force: true });
}
