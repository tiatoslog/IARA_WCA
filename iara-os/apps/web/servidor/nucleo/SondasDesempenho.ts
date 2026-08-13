/**
 * DESEMPENHO — o vocabulário de uma medição da máquina, e a aritmética que a
 * transforma em número comparável.
 *
 * O QUE ESTE ARQUIVO NÃO TEM, e a ausência é a decisão: `node:fs` e
 * `node:child_process`. Ele não abre disco e não roda processo.
 *
 * A primeira versão deste módulo abria os dois, e `fronteira-efeitos.test.ts`
 * derrubou a suíte na hora — corretamente. A regra `A4` confina `execFile` e
 * `spawn` ao `AgenteLocal`, e ela existe justamente para impedir o que eu estava
 * fazendo: um segundo lugar no sistema capaz de rodar um comando, com as próprias
 * fronteiras, fora da auditoria que o `AgenteLocal` carrega. Uma sonda é
 * inofensiva hoje; o problema é a PORTA que ela abre para o arquivo seguinte.
 *
 * A divisão que sobrou é a certa e é a mesma do resto do kernel:
 *
 *   `AgenteLocal`  toca a máquina (PowerShell, `statfs`) — sob a fronteira
 *   este arquivo   sabe o que os números SIGNIFICAM — puro, testável, sem mundo
 *   `MotorAnalise` decide se um número é problema — política
 *
 * `node:os` fica: ele calcula sobre o que o processo já tem, não alcança nada.
 * Ver `BUILTINS_QUE_ALCANCAM` em `Fronteira.ts`.
 *
 * A REGRA QUE GOVERNA CADA CAMPO: `null` significa NÃO CONSEGUI MEDIR, e nunca
 * zero. É a mesma distinção de `SondaProcessos` em `AgenteLocal` — "sondei e não
 * achei" (`[]`) contra "não sei sondar" (`null`) — e ela existe porque um zero
 * inventado no lugar de uma medição ausente vira, três camadas acima, uma
 * hipótese com confiança alta sobre um número que ninguém observou.
 */

import { cpus, freemem, totalmem, uptime } from 'node:os';

// ---------------------------------------------------------------------------
// O que uma medição é
// ---------------------------------------------------------------------------

export interface ProcessoMedido {
  readonly nome: string;
  readonly pid: number;
  /**
   * Fatia da máquina INTEIRA, não de um núcleo. Um processo saturando dois
   * núcleos de oito aparece como 25%, e não como 200% — que é o número que o
   * Gerenciador de Tarefas mostra e que ninguém sabe interpretar sem saber
   * quantos núcleos a máquina tem.
   */
  readonly cpu_pct: number;
  readonly memoria_mb: number;
}

export interface Medicao {
  readonly instante: string;
  readonly cpu_pct: number;
  readonly memoria_pct: number;
  readonly memoria_total_gb: number;
  readonly memoria_livre_gb: number;
  /** `null` quando a plataforma não expõe. Nunca 0. */
  readonly disco_livre_pct: number | null;
  readonly disco_livre_gb: number | null;
  readonly ligado_ha_h: number;
  readonly nucleos: number;
  /** `null` = não sei sondar processos aqui. `[]` = sondei e não achei nada. */
  readonly processos: readonly ProcessoMedido[] | null;
  /**
   * O que NÃO foi medido, em uma frase cada. Sobe intacto até o diagnóstico:
   * ver `Diagnostico.lacunas`.
   */
  readonly lacunas: readonly string[];
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

/**
 * `os.cpus()` devolve tempo ACUMULADO desde o boot. Uma leitura só produz a
 * média da vida inteira da máquina — que num computador ligado há três dias é
 * praticamente uma constante, e nunca a lentidão de agora. Duas leituras
 * separadas por um intervalo dão a taxa, que é o que a pergunta pede.
 */
const JANELA_CPU_MS = 500;

interface AmostraCpu {
  readonly ocioso: number;
  readonly total: number;
}

function amostrarCpu(): AmostraCpu {
  let ocioso = 0;
  let total = 0;
  for (const nucleo of cpus()) {
    for (const [modo, ms] of Object.entries(nucleo.times)) {
      total += ms;
      if (modo === 'idle') ocioso += ms;
    }
  }
  return { ocioso, total };
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function medirCpu(janelaMs = JANELA_CPU_MS): Promise<number> {
  const a = amostrarCpu();
  await dormir(janelaMs);
  const b = amostrarCpu();

  const deltaTotal = b.total - a.total;
  const deltaOcioso = b.ocioso - a.ocioso;
  // Janela sem tick de relógio: devolver 0 seria afirmar máquina parada.
  // Devolver a média histórica é a leitura menos errada disponível.
  if (deltaTotal <= 0) {
    return arredondar((1 - b.ocioso / b.total) * 100);
  }
  return arredondar((1 - deltaOcioso / deltaTotal) * 100);
}

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

/**
 * O espaço livre, JÁ MEDIDO por quem tem permissão de abrir o disco.
 *
 * A leitura em si mora no `AgenteLocal` (`sondarDisco`), sob a fronteira. Aqui
 * fica só o tipo — porque o resto do módulo precisa saber o formato, e saber o
 * formato não exige poder ler.
 *
 * O volume medido é o do SISTEMA, não o do diretório do processo: é o disco
 * cheio do Windows que deixa a máquina lenta, não o disco de dados.
 */
export interface Disco {
  readonly livre_pct: number;
  readonly livre_gb: number;
}

// ---------------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------------

/**
 * Quem está consumindo, agora.
 *
 * `null` = plataforma sem sonda, ou a sonda falhou. Injetável pelo mesmo motivo
 * de `SondaProcessos` no `AgenteLocal`: provar a análise de uma máquina
 * saturada sem saturar a máquina que roda a suíte.
 */
export type SondaDetalhada = () => Promise<readonly ProcessoMedido[] | null>;

/** Quantos processos voltam. Os maiores; o resto é cauda que não explica nada. */
const TETO_PROCESSOS = 8;

/**
 * A JANELA existe pela mesma razão da janela de CPU, e é o detalhe que separa
 * esta sonda de um `tasklist`: a propriedade `CPU` do `Get-Process` é
 * SEGUNDOS DE PROCESSADOR ACUMULADOS desde que o processo subiu. O navegador
 * aberto desde ontem tem um número enorme e pode estar ocioso agora. Só a
 * diferença entre duas leituras responde "quem está consumindo neste momento".
 */
export const JANELA_PROCESSOS_MS = 1000;

/**
 * O SCRIPT da sonda mora aqui, mas quem o EXECUTA é o `AgenteLocal` — a mesma
 * separação entre saber e poder que rege o arquivo inteiro. O texto é
 * conhecimento sobre medição; rodá-lo é alcançar a máquina.
 *
 * Tudo acontece DENTRO do PowerShell, numa chamada só. Duas chamadas separadas
 * pagariam a partida do PowerShell duas vezes (que é cara e variável) e a janela
 * real passaria a ser "1 s mais o tempo que o interpretador levou para subir" —
 * um denominador que muda a cada execução e estraga o percentual.
 *
 * `$ErrorActionPreference` silencioso: `Get-Process` não lê a CPU de processos
 * de outra sessão sem privilégio, e ali a propriedade vem vazia. Isso é uma
 * LACUNA da medição, não um erro da sonda — o processo entra na lista com o que
 * dá para saber dele (memória) e CPU zero, e a análise nunca conclui nada a
 * partir de um zero desses sozinho.
 *
 * O script é uma CONSTANTE, sem interpolação de nada que venha de fora: nenhum
 * parâmetro do operador, do plano ou da LLM chega a esta string. É por isso que
 * ela pode existir — um comando montado com entrada externa seria a rota de fuga
 * que a allowlist do `AgenteLocal` existe para não ter.
 */
export const SCRIPT_PROCESSOS = `
$ErrorActionPreference='SilentlyContinue'
$a=@{}; Get-Process | ForEach-Object { $a[$_.Id]=$_.CPU }
Start-Sleep -Milliseconds ${JANELA_PROCESSOS_MS}
Get-Process | ForEach-Object {
  $antes = $a[$_.Id]
  $delta = if ($antes -ne $null -and $_.CPU -ne $null) { $_.CPU - $antes } else { 0 }
  [PSCustomObject]@{ n=$_.ProcessName; p=$_.Id; c=[math]::Round($delta,3); m=[math]::Round($_.WorkingSet64/1MB,1) }
} | ConvertTo-Json -Compress
`;

/**
 * Exportada para o teste poder exercer a conversão sem PowerShell. A aritmética
 * de segundos-de-CPU para percentual da máquina é a parte que erra em silêncio:
 * esquecer o número de núcleos produz 800% num octa-core, e ninguém percebe até
 * a IARA afirmar que um processo consome oito vezes o computador.
 */
export function interpretarProcessos(
  bruto: string,
  nucleos: number,
  janelaMs = JANELA_PROCESSOS_MS,
): readonly ProcessoMedido[] | null {
  const texto = bruto.trim();
  if (!texto) return null;

  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch {
    return null;
  }
  // Um processo só faz o `ConvertTo-Json` devolver objeto, não lista.
  const lista = Array.isArray(cru) ? cru : [cru];

  const segundosDisponiveis = (janelaMs / 1000) * Math.max(1, nucleos);

  const medidos: ProcessoMedido[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const pid = Number(o.p);
    const nome = typeof o.n === 'string' ? o.n : '';
    if (!nome || !Number.isFinite(pid)) continue;

    const delta = Number(o.c);
    const memoria = Number(o.m);
    medidos.push({
      nome,
      pid,
      // Delta negativo acontece quando um pid é reciclado entre as amostras.
      // Zerar é a leitura honesta: não dá para atribuir consumo a esse processo.
      cpu_pct: Number.isFinite(delta) && delta > 0
        ? arredondar(Math.min(100, (delta / segundosDisponiveis) * 100))
        : 0,
      memoria_mb: Number.isFinite(memoria) ? memoria : 0,
    });
  }

  /**
   * Ordenado por CPU e cortado — mas o corte guarda também os maiores de
   * MEMÓRIA, porque a pergunta "por que está lento" tem duas respostas
   * possíveis e ordenar só por uma delas esconde a outra. Um navegador com 6 GB
   * e CPU ociosa é a causa mais comum de lentidão por paginação, e ele nunca
   * apareceria numa lista ordenada por processador.
   */
  const porCpu = [...medidos].sort((a, b) => b.cpu_pct - a.cpu_pct).slice(0, TETO_PROCESSOS);
  const porMemoria = [...medidos].sort((a, b) => b.memoria_mb - a.memoria_mb).slice(0, TETO_PROCESSOS);

  const vistos = new Set<number>();
  const juntos: ProcessoMedido[] = [];
  for (const p of [...porCpu, ...porMemoria]) {
    if (vistos.has(p.pid)) continue;
    vistos.add(p.pid);
    juntos.push(p);
  }
  return juntos;
}

// ---------------------------------------------------------------------------
// A medição completa
// ---------------------------------------------------------------------------

function arredondar(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A porta de entrada de uma medição que veio DE FORA deste processo.
 *
 * O braço é outro processo, possivelmente de outra versão, possivelmente em
 * outra máquina. `relato.dados as Medicao` seria a mesma linha que a auditoria
 * zero-trust condenou em `RegistroOperacoes.reidratar` — `JSON.parse` seguido de
 * um `as` e de confiança total. A consequência aqui é menos grave e igualmente
 * indesejável: um campo ausente vira `undefined`, entra na aritmética do
 * `MotorAnalise` e sai como `NaN%` na frase que a IARA fala.
 *
 * `null` quando o formato não confere. Quem chama trata como "não consegui
 * medir" — que é a verdade.
 */
export function interpretarMedicao(dados: unknown): Medicao | null {
  if (!dados || typeof dados !== 'object') return null;
  const d = dados as Record<string, unknown>;

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const cpu = num(d.cpu_pct);
  const memoria = num(d.memoria_pct);
  const nucleos = num(d.nucleos);
  // Estes três são o mínimo sem o qual não há análise nenhuma a fazer.
  if (cpu === null || memoria === null || nucleos === null) return null;

  const processos = Array.isArray(d.processos)
    ? d.processos
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
        .map((p) => ({
          nome: typeof p.nome === 'string' ? p.nome : '',
          pid: num(p.pid) ?? 0,
          cpu_pct: num(p.cpu_pct) ?? 0,
          memoria_mb: num(p.memoria_mb) ?? 0,
        }))
        .filter((p) => p.nome !== '')
    : null;

  return {
    instante: typeof d.instante === 'string' ? d.instante : new Date().toISOString(),
    cpu_pct: cpu,
    memoria_pct: memoria,
    memoria_total_gb: num(d.memoria_total_gb) ?? 0,
    memoria_livre_gb: num(d.memoria_livre_gb) ?? 0,
    disco_livre_pct: num(d.disco_livre_pct),
    disco_livre_gb: num(d.disco_livre_gb),
    ligado_ha_h: num(d.ligado_ha_h) ?? 0,
    nucleos,
    processos,
    lacunas: Array.isArray(d.lacunas) ? d.lacunas.filter((l): l is string => typeof l === 'string') : [],
  };
}

/**
 * Monta a fotografia da máquina a partir do que as sondas conseguiram ler.
 *
 * NÃO LÊ NADA por conta própria além de `node:os`: disco e processos chegam
 * prontos de quem tem permissão de alcançá-los. É o que mantém esta função
 * testável sem mundo — e o que mantém o mundo confinado ao `AgenteLocal`.
 *
 * NÃO LANÇA. Uma sonda que falhou chega como `null` e vira lacuna declarada;
 * uma investigação que morre porque o disco não pôde ser lido não é mais segura,
 * é só menos útil.
 */
export function montarMedicao(entrada: {
  cpu_pct: number;
  disco: Disco | null;
  processos: readonly ProcessoMedido[] | null;
}): Medicao {
  const { cpu_pct, disco, processos } = entrada;
  const total = totalmem();
  const livre = freemem();
  const usada = total - livre;

  const lacunas: string[] = [];
  if (disco === null) {
    lacunas.push('não consegui ler o espaço livre em disco nesta máquina');
  }
  if (processos === null) {
    lacunas.push(
      process.platform === 'win32'
        ? 'não consegui listar os processos em execução (a sonda falhou ou expirou)'
        : `não sei listar processos em ${process.platform} — a sonda existe só para Windows`,
    );
  }

  return {
    instante: new Date().toISOString(),
    cpu_pct,
    memoria_pct: arredondar((usada / total) * 100),
    memoria_total_gb: arredondar(total / 1024 ** 3),
    memoria_livre_gb: arredondar(livre / 1024 ** 3),
    disco_livre_pct: disco?.livre_pct ?? null,
    disco_livre_gb: disco?.livre_gb ?? null,
    ligado_ha_h: arredondar(uptime() / 3600),
    nucleos: cpus().length,
    processos,
    lacunas,
  };
}
