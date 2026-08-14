/**
 * EMPACOTAR O BRAÇO — transformar o processo Node num executável único que a
 * operadora abre com dois cliques.
 *
 *     npm run empacotar:braco
 *
 * A DECISÃO QUE ESTE ARQUIVO IMPLEMENTA, e a alternativa que ela recusa.
 *
 * O caminho óbvio para "um programa que a pessoa instala" era reescrever o braço
 * em Rust, dentro do shell Tauri que já existe em `apps/desktop`. Ele foi
 * recusado, e a razão está no cabeçalho do `ExecutorDesktop`: existe UMA
 * implementação da execução, usada nos dois lugares onde as mãos podem estar —
 * dentro do motor e dentro do braço. Reescrever significaria portar as ~1300
 * linhas do `AgenteLocal` (allowlist de aplicativos, raízes autorizadas, recusa
 * de nome, provas de disco) para uma segunda linguagem, e a partir daí manter as
 * duas em concordância para sempre. A divergência entre "o que o teste roda" e
 * "o que o produto usa" é a falha mais cara que este sistema pode ter, e ela
 * apareceria em silêncio: os testes continuariam verdes na implementação
 * TypeScript enquanto a operadora usaria a outra.
 *
 * Empacotar o que já existe custa este arquivo e não cria nenhuma segunda
 * verdade.
 *
 * COMO. Duas etapas, e a primeira é a que faz o trabalho:
 *
 *  1. `esbuild` reúne o braço, o `ExecutorDesktop`, o `AgenteLocal`, o `ws` e o
 *     `dotenv` num ÚNICO arquivo CommonJS. Depois disso não há mais `import`
 *     relativo nenhum a resolver — só `require` de módulo embutido do Node, que
 *     o runtime do executável resolve sozinho.
 *  2. o SEA do Node (`--experimental-sea-config` + `postject`) cola esse arquivo
 *     dentro de uma cópia do próprio `node`. O resultado é um binário que roda
 *     em máquina sem Node instalado.
 *
 * O ENDEREÇO DA IARA é assado aqui, por `define`. É a diferença entre "abra o
 * programa" e "abra o programa e digite o endereço do servidor" — e a segunda
 * frase é a barreira que este trabalho existe para derrubar. Sem `IARA_MOTOR`
 * (ou `NEXT_PUBLIC_IARA_MOTOR`) no ambiente, o empacotamento AVISA e segue: o
 * executável resultante pergunta o endereço uma vez, o que é ruim mas honesto.
 *
 * O QUE ESTE SCRIPT NÃO FAZ, de propósito: assinar o executável. Um binário não
 * assinado dispara o SmartScreen do Windows na primeira abertura ("Mais
 * informações" → "Executar assim mesmo"), e isso precisa estar escrito na
 * instrução que a operadora recebe em vez de virar surpresa. Assinatura exige um
 * certificado de code signing comprado em nome da empresa, que é uma decisão de
 * quem tem CNPJ — não de quem escreve o build.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform } from 'node:os';
import path from 'node:path';
import { config as carregarEnv } from 'dotenv';
import { build } from 'esbuild';

carregarEnv({ path: '.env.local' });
carregarEnv();

const RAIZ = process.cwd();
const SAIDA = path.join(RAIZ, 'dist', 'braco');
const ENTRADA = path.join(RAIZ, 'servidor', 'braco', 'principal.ts');

const MOTOR = (process.env.IARA_MOTOR ?? process.env.NEXT_PUBLIC_IARA_MOTOR ?? '').trim();

/** `iara-braco.exe` no Windows, `iara-braco` no resto. */
const nomeBinario = platform() === 'win32' ? 'iara-braco.exe' : 'iara-braco';

function passo(texto: string): void {
  console.log(`\n  → ${texto}`);
}

async function agrupar(): Promise<string> {
  passo('reunindo o braço num arquivo só (esbuild)');
  const arquivo = path.join(SAIDA, 'braco.cjs');

  await build({
    entryPoints: [ENTRADA],
    outfile: arquivo,
    bundle: true,
    platform: 'node',
    /* O runtime do executável é o Node que está empacotando. Mirar mais baixo
       faria o esbuild transpilar coisas que este Node executa nativamente, sem
       ganho nenhum e com risco de mudar semântica de `async`. */
    target: `node${process.versions.node.split('.')[0]}`,
    format: 'cjs',
    /**
     * O SEA não roda `require` de arquivo — só de módulo embutido. Um `import`
     * dinâmico deixado para o runtime viraria "Cannot find module" na máquina
     * da operadora, meses depois, sem ninguém conseguir reproduzir. Por isso
     * `bundle: true` e nenhuma exceção além das duas abaixo.
     */
    external: [
      /**
       * Aceleradores NATIVOS opcionais do `ws`. Ele os carrega dentro de um
       * `try/catch` e funciona sem eles — mas `.node` compilado não entra num
       * bundle JavaScript de jeito nenhum. Marcados como externos, o `require`
       * falha em runtime dentro do `try` que já existe lá, e o `ws` segue em
       * JavaScript puro. É o comportamento que o braço já tem hoje: ninguém
       * instalou esses pacotes neste projeto.
       */
      'bufferutil',
      'utf-8-validate',
    ],
    define: {
      /* Ver `MOTOR_EMBUTIDO` em `braco/principal.ts`. Sem endereço, o
         identificador continua inexistente e o `typeof` de lá resolve para
         "undefined" — o braço então pergunta. */
      ...(MOTOR ? { __IARA_MOTOR__: JSON.stringify(MOTOR) } : {}),
    },
    /* Sem `minify`: o ganho é irrelevante ao lado dos ~110 MB do runtime do
       Node embutido, e um stack trace legível vale mais que 300 KB num
       programa que roda na máquina de outra pessoa. */
    sourcemap: false,
    logLevel: 'warning',
  });

  console.log(`     ${arquivo} (${(statSync(arquivo).size / 1024).toFixed(0)} KB)`);
  return arquivo;
}

function selar(bundle: string): string {
  passo('colando o braço dentro de uma cópia do Node (SEA)');

  const configuracao = path.join(SAIDA, 'sea.json');
  const blob = path.join(SAIDA, 'braco.blob');
  writeFileSync(
    configuracao,
    `${JSON.stringify(
      {
        main: bundle,
        output: blob,
        /**
         * `useSnapshot: false` — o snapshot de startup do Node não suporta um
         * programa que abre socket e lê `process.env` no topo, e a falha dele é
         * na hora da GERAÇÃO, com mensagem obscura. O ganho seria alguns
         * milissegundos numa coisa que a pessoa abre uma vez por dia.
         */
        useSnapshot: false,
        /* Cache de código: reduz o tempo de abertura sem mudar semântica. */
        useCodeCache: true,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  execFileSync(process.execPath, ['--experimental-sea-config', configuracao], {
    stdio: 'inherit',
  });

  const binario = path.join(SAIDA, nomeBinario);
  copyFileSync(process.execPath, binario);

  passo('injetando o recurso no executável (postject)');
  execFileSync(
    process.execPath,
    [
      /* `npx postject` resolve o pacote sem exigir instalação global, e o
         `--yes` evita a pergunta interativa que travaria um build em CI. */
      path.join(RAIZ, 'node_modules', 'postject', 'dist', 'cli.js'),
      binario,
      'NODE_SEA_BLOB',
      blob,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      ...(platform() === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
    ],
    { stdio: 'inherit' },
  );

  return binario;
}

async function principal(): Promise<void> {
  console.log('\n  IARA — empacotando o braço\n');

  if (!MOTOR) {
    console.warn(
      '  ⚠ Sem IARA_MOTOR (ou NEXT_PUBLIC_IARA_MOTOR) no ambiente.\n' +
        '    O executável vai PERGUNTAR o endereço da IARA na primeira abertura.\n' +
        '    Para entregar um programa que não pergunta nada, declare a variável e rode de novo.',
    );
  } else {
    console.log(`  Endereço assado no executável: ${MOTOR}`);
  }

  rmSync(SAIDA, { recursive: true, force: true });
  mkdirSync(SAIDA, { recursive: true });

  const bundle = await agrupar();
  const binario = selar(bundle);

  const mb = (statSync(binario).size / 1024 / 1024).toFixed(0);
  console.log(`\n  Pronto: ${binario} (${mb} MB)`);

  /**
   * O SHA256, impresso — Etapa 2 (14/08/2026).
   *
   * Não é conveniência: é o valor que `NEXT_PUBLIC_IARA_INSTALADOR_SHA256`
   * precisa carregar para a atualização automática existir. Sem ele,
   * `manifestoAtualizacaoDisponivel` (`lib/execucao.ts`) considera a
   * atualização indisponível de propósito — nunca se oferece baixar e
   * substituir um executável sem prova de integridade para conferir depois.
   */
  const sha256 = createHash('sha256').update(readFileSync(binario)).digest('hex');
  console.log(`\n  SHA256: ${sha256}`);

  console.log(
    '\n  O tamanho é o runtime do Node inteiro, e é o preço de não exigir Node\n' +
      '  instalado na máquina de ninguém.\n' +
      '\n  Publique este arquivo num endereço estável (uma Release do GitHub serve, um\n' +
      '  bucket público de storage também) e declare as três variáveis que a gaveta\n' +
      '  Dispositivos lê:\n' +
      `\n    NEXT_PUBLIC_IARA_INSTALADOR=<endereço público do .exe>` +
      `\n    NEXT_PUBLIC_IARA_INSTALADOR_SHA256=${sha256}` +
      '\n    NEXT_PUBLIC_IARA_INSTALADOR_NOTAS=<resumo curto do que mudou, opcional>\n' +
      '\n  Sem o SHA256 certo, a atualização automática fica desligada — só o\n' +
      '  download manual continua disponível, e é assim que este script já\n' +
      '  funcionava antes da Etapa 2.\n',
  );
}

void principal().catch((erro: Error) => {
  console.error(`\n  Falhou: ${erro.message}\n`);
  process.exitCode = 1;
});
