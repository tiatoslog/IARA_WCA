/**
 * `npm run confiabilidade` — o portão do incidente dos motoristas.
 *
 * POR QUE ELE EXISTE SEPARADO DE `npm test`. A suíte inteira responde "quantos
 * testes passaram". Essa pergunta não distingue as duas coisas que a auditoria
 * de 19/08/2026 exigiu distinguir:
 *
 *   · 1698 testes verdes com 0% de cobertura de repetição
 *   · 1698 testes verdes com repetição, paráfrase, contaminação e mutação
 *
 * As duas imprimem o mesmo número. Este comando imprime a SEGUNDA pergunta —
 * por dimensão, com as lacunas declaradas em voz alta.
 *
 * A REGRA QUE ELE MATERIALIZA: nenhuma dimensão vira média. Uma falha em
 * "consistência determinística" é P0 mesmo que as outras dezenove estejam
 * verdes, porque `53, 53, 53, 75` não é 75% de acerto — é falha.
 *
 * O QUE ELE NÃO FAZ, e está escrito porque calar seria pior: ele não sobe
 * navegador, não fala com a planilha real e não chama provedor nenhum. É a
 * camada determinística. A camada de produto é `npm run gate` (navegador real)
 * e as 23 baterias de `npm run bateria`. Um verde aqui NÃO é READY — é
 * "o caminho determinístico está provado".
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * As dimensões da matriz de confiabilidade, cada uma apontando para o arquivo
 * que a PROVA. `arquivos: []` é lacuna declarada, e o relatório a imprime como
 * lacuna — nunca como verde.
 */
interface Dimensao {
  readonly nome: string;
  readonly arquivos: readonly string[];
  /** Escrito quando a cobertura é parcial ou inexistente. Vira linha do relatório. */
  readonly ressalva?: string;
}

const DIMENSOES: readonly Dimensao[] = [
  {
    nome: 'Consistência determinística (mesma pergunta, mesma trajetória)',
    arquivos: ['testes/contrato-factual.test.ts'],
  },
  {
    nome: 'Estabilidade semântica (paráfrase, caixa, pontuação)',
    arquivos: ['testes/contrato-factual.test.ts'],
  },
  {
    nome: 'Ferramenta e parâmetros corretos (caminho, não só resposta)',
    arquivos: ['testes/contrato-factual.test.ts', 'testes/cargasLuft-habilidades.test.ts'],
  },
  {
    nome: 'Correção contra oráculo independente',
    arquivos: [
      'testes/matriz-capacidades-planilha.test.ts',
      'testes/contar-distintos.test.ts',
      'testes/identidade-motorista.test.ts',
    ],
  },
  {
    nome: 'Relações metamórficas e mutação do dataset',
    arquivos: ['testes/metamorfico-contagem.test.ts'],
  },
  {
    nome: 'Semântica de NULL e sentinela',
    arquivos: ['testes/metamorfico-contagem.test.ts', 'testes/contar-distintos.test.ts'],
  },
  {
    nome: 'Correção temporal (ano e período)',
    arquivos: ['testes/ano-fora-de-alcance.test.ts', 'testes/periodo-operacional.test.ts'],
  },
  {
    nome: 'Dado ausente declarado, nunca inferido',
    arquivos: ['testes/contrato-factual.test.ts'],
  },
  {
    nome: 'Isolamento de memória (histórico não é evidência)',
    arquivos: ['testes/autoridade-de-dados.test.ts', 'testes/contrato-factual.test.ts'],
  },
  {
    nome: 'Injeção de instrução do usuário',
    arquivos: ['testes/contrato-factual.test.ts', 'testes/zero-trust-adversarial.test.ts'],
  },
  {
    nome: 'Tolerância a falha e escalada (timeout, provedor fora)',
    arquivos: ['testes/fi-escalada-e2e.test.ts', 'testes/escalada-no-kernel.test.ts'],
  },
  {
    nome: 'Afirmação sem execução (trava de autoridade)',
    arquivos: ['testes/afirmacao-de-feito.test.ts', 'testes/autoridade-de-dados.test.ts'],
  },
  {
    nome: 'Detector de grafia (acusa, nunca funde)',
    arquivos: ['testes/metamorfico-contagem.test.ts', 'testes/suspeita-identidade.test.ts'],
  },
  {
    nome: 'Integridade do stream até a superfície',
    arquivos: ['testes/stream-truncado.test.ts'],
  },
  {
    nome: 'Concorrência entre sessões e espelhos',
    arquivos: ['testes/cross-talk-espelhos.test.ts', 'testes/memoria-concorrente.test.ts'],
  },
  {
    nome: 'Conflito entre fontes resolvido em voz alta',
    arquivos: [],
    ressalva:
      'NÃO COBERTO. Hoje só existe UMA fonte por família factual, então não há como duas ' +
      'discordarem — o cenário de DATA_CONFLICT não é alcançável nesta arquitetura. ' +
      'Vira lacuna real no dia em que a aba 2025 for lida, e o teste tem de nascer junto com ela.',
  },
  {
    nome: 'Cache: chave que representa o contrato factual',
    arquivos: [],
    ressalva:
      'PARCIAL. O cache da planilha é por LEITURA (5 min, universo inteiro), não por pergunta — ' +
      'não há chave derivada de texto que possa prender uma resposta. Isso elimina a classe de ' +
      'defeito, e não a mede: não existe teste que falharia se alguém introduzisse cache por frase.',
  },
  {
    nome: 'Interface real em navegador (fluxo do operador)',
    arquivos: [],
    ressalva:
      'FORA DESTE COMANDO por construção. É `npm run gate` (Playwright, motor e web reais). ' +
      'Verde aqui não substitui verde lá.',
  },
];

const arquivos = [...new Set(DIMENSOES.flatMap((d) => d.arquivos))].sort();

console.log('CONFIABILIDADE — o caminho determinístico da operação\n');
console.log(`${arquivos.length} arquivo(s) de teste, ${DIMENSOES.length} dimensão(ões) declarada(s)\n`);

const r = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...arquivos],
  { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
const numero = (re: RegExp): number => Number(saida.match(re)?.[1] ?? '0');
const total = numero(/^# tests (\d+)$/m);
const passou = numero(/^# pass (\d+)$/m);
const falhou = numero(/^# fail (\d+)$/m);

for (const linha of saida.split(/\r?\n/)) {
  if (linha.startsWith('not ok ')) console.log(`  FALHA  ${linha.slice(7)}`);
}

console.log('\nCOBERTURA POR DIMENSÃO\n');
for (const d of DIMENSOES) {
  const marca = d.arquivos.length > 0 ? '  coberta ' : '  LACUNA  ';
  console.log(`${marca} ${d.nome}`);
  if (d.ressalva) console.log(`           ↳ ${d.ressalva}`);
}

const lacunas = DIMENSOES.filter((d) => d.arquivos.length === 0).length;

console.log(`\ntestes: ${total} · passou: ${passou} · falhou: ${falhou}`);
console.log(`dimensões cobertas: ${DIMENSOES.length - lacunas}/${DIMENSOES.length} · lacunas declaradas: ${lacunas}`);

/**
 * O VEREDITO NUNCA DIZ "READY". Ele diz o que foi provado, e nomeia o que falta
 * — porque "pronto" depende da auditoria de produto em navegador real, que não
 * roda aqui. Um comando que carimbasse READY com esta cobertura seria
 * exatamente o falso verde que a auditoria mandou eliminar.
 */
if (falhou > 0) {
  console.log('\nVEREDITO: FALHOU — há inconsistência no caminho determinístico. P0.');
  process.exit(1);
}
console.log(
  '\nVEREDITO: caminho determinístico PROVADO. Não é READY: falta a auditoria de produto ' +
    'em navegador real (`npm run gate`) e as 23 baterias (`npm run bateria`).',
);
