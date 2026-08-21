/**
 * Captura de quadro EM MEMÓRIA — a primitiva que o P0 da percepção exigia.
 *
 * O QUE ELA SUBSTITUI E POR QUÊ. `AgenteLocal.capturarTela` continua existindo e
 * continua certa para o que faz: o operador pede uma foto, ela roda um
 * `powershell.exe`, grava um PNG em `<Documentos>/Capturas IARA/` e a pessoa
 * abre o arquivo. Para percepção contínua isso é errado em três dimensões ao
 * mesmo tempo — um processo por quadro (medido: 200–400 ms), um arquivo por
 * quadro no disco da pessoa, e a tela inteira materializada em PNG.
 *
 * ESTE MÓDULO NUNCA PRODUZ IMAGEM. Ele mantém UM processo PowerShell vivo e
 * conversa com ele por cano; o que volta pelo cano é uma matriz **32×32 em tons
 * de cinza** — 1024 números. A tela nunca é materializada do lado do Node: o
 * redimensionamento acontece dentro do `System.Drawing`, e o `Bitmap` grande é
 * descartado antes de qualquer byte atravessar. É uma garantia GEOMÉTRICA, não
 * processual: não existe caminho de código que mande a tela para a IARA porque
 * a tela nunca chega aqui.
 *
 * A ORDEM DAS DUAS PERGUNTAS É A TRAVA DE ESCOPO. `janela()` devolve só
 * metadado — título, processo, tamanho, handle — e não lê pixel nenhum.
 * `quadro(handle)` só captura se a janela em foco AINDA for aquele handle. Quem
 * decide se o escopo autoriza é o chamador, entre as duas chamadas. Uma janela
 * fora do escopo nunca tem seus pixels lidos, e isso é estrutura — não é uma
 * checagem que alguém pode esquecer de fazer depois.
 *
 * MEDIDO NESTA MÁQUINA (Windows 10, 21/08/2026): 41 ms por quadro em média,
 * 110 ms de pico, sobre janela de 1382×744. A 1 Hz isso é ~4% de um núcleo.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { LADO_MINIATURA } from '../../lib/percepcao';

/**
 * O QUE FECHA UMA RESPOSTA no cano — e por que não é a quebra de linha.
 *
 * ACHADO RODANDO DE VERDADE (21/08/2026): a resposta do OCR traz dezenas de
 * linhas de texto e sai do PowerShell partida em pedaços que não coincidem com
 * o fim da mensagem. O leitor que assumia "uma linha = uma resposta" tentava
 * `JSON.parse` de meia resposta e derrubava a captura.
 *
 * Um sentinela explícito torna o enquadramento independente de como o console
 * decidiu quebrar a saída. É a lição de sempre sobre protocolo em cima de fluxo:
 * quem escreve não controla onde o leitor recebe o corte.
 */
const TERMINADOR = '--FIM--';

/** Prazo de uma resposta do helper. Acima disto, o processo é considerado morto. */
const PRAZO_RESPOSTA_MS = 5_000;

/**
 * O OCR merece um prazo maior. A primeira leitura carrega o motor de idioma do
 * Windows (`Add-Type` mais `TryCreateFromUserProfileLanguages`), e isso passa
 * folgadamente dos 5 s de uma captura de quadro numa máquina carregada.
 */
const PRAZO_OCR_MS = 20_000;

export interface JanelaEmFoco {
  /** Handle da janela, como texto. Só serve para amarrar `quadro()` a ela. */
  readonly handle: string;
  readonly titulo: string;
  readonly processo: string;
  readonly largura: number;
  readonly altura: number;
}

export interface Quadro {
  /** 1024 tons de cinza, 0–255, em ordem de varredura. */
  readonly cinza: readonly number[];
  readonly ms: number;
}

/**
 * O script do helper, embutido como texto.
 *
 * EMBUTIDO E NÃO EM ARQUIVO por duas razões que apontam para o mesmo lado: o
 * Braço é empacotado como executável único (`scripts/empacotar-braco.ts`), e um
 * `.ps1` ao lado seria mais um arquivo para o SEA não carregar; e escrever um
 * script em disco para depois executá-lo é exatamente o mecanismo de arquivo
 * temporário que o P0 proíbe.
 *
 * Entra por `-EncodedCommand`, não por `-Command -`: aquele consome a entrada
 * padrão inteira, e a entrada padrão é justamente o cano por onde os comandos
 * chegam.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
# UTF-8 NO CANO, e isto foi achado rodando: a saida padrao do PowerShell usa a
# pagina de codigo OEM, e o texto do OCR chegava ao Node com "nao" no lugar de
# "nao" acentuado. Numa tela em portugues isso corrompe quase toda linha - e
# texto corrompido e pior que texto ausente, porque parece que foi lido.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Iara -Name Nativo -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

$LADO = ${LADO_MINIATURA}

function Foco {
  $h = [Iara.Nativo]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][Iara.Nativo]::GetWindowText($h, $sb, 512)
  $r = New-Object Iara.Nativo+RECT
  [void][Iara.Nativo]::GetWindowRect($h, [ref]$r)
  $idProc = 0
  [void][Iara.Nativo]::GetWindowThreadProcessId($h, [ref]$idProc)
  $nome = try { (Get-Process -Id $idProc -ErrorAction Stop).ProcessName } catch { 'desconhecido' }
  return [pscustomobject]@{
    handle = $h.ToString()
    titulo = $sb.ToString()
    processo = $nome
    x = $r.Left
    y = $r.Top
    w = ($r.Right - $r.Left)
    h = ($r.Bottom - $r.Top)
  }
}

$ocrMotor = $null
$ocrTentado = $false
$asTask = $null

# O motor de OCR do proprio Windows. Carregado na PRIMEIRA vez que alguem pede
# texto, nao na subida: quem so quer detectar mudanca nao paga o custo, e uma
# maquina sem pacote de idioma continua capturando normalmente.
function IniciarOcr {
  if ($script:ocrTentado) { return }
  $script:ocrTentado = $true
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    [void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
    $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
      })[0]
    $script:ocrMotor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  catch { $script:ocrMotor = $null }
}

function Aguardar($operacao, $tipo) {
  $m = $script:asTask.MakeGenericMethod($tipo)
  $t = $m.Invoke($null, @($operacao))
  [void]$t.Wait(-1)
  return $t.Result
}

# Le o texto da janela. O bitmap vive so em memoria e morre nesta funcao; o que
# sai daqui e uma lista de linhas, que o Braco mascara antes de emitir evento.
function LerTexto($j) {
  IniciarOcr
  if ($null -eq $script:ocrMotor) { return $null }
  $bmp = New-Object System.Drawing.Bitmap $j.w, $j.h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($j.x, $j.y, 0, 0, (New-Object System.Drawing.Size $j.w, $j.h))
  $g.Dispose()
  $mem = New-Object System.IO.MemoryStream
  $bmp.Save($mem, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  $bytes = $mem.ToArray()
  $mem.Dispose()

  $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $escritor = New-Object Windows.Storage.Streams.DataWriter($ras)
  $escritor.WriteBytes($bytes)
  [void](Aguardar $escritor.StoreAsync() ([uint32]))
  [void]$escritor.DetachStream()
  $ras.Seek(0)

  $dec = Aguardar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Aguardar ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $r = Aguardar ($script:ocrMotor.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $sb.Dispose(); $ras.Dispose()

  $linhas = @()
  foreach ($l in $r.Lines) { $linhas += $l.Text }
  return $linhas
}

function Responder($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.WriteLine('--FIM--')
  [Console]::Out.Flush()
}

while ($true) {
  $linha = [Console]::In.ReadLine()
  if ($null -eq $linha) { break }
  $linha = $linha.Trim()
  if ($linha -eq 'SAIR') { break }

  try {
    if ($linha -eq 'JANELA') {
      $j = Foco
      Responder ([pscustomobject]@{
        ok = $true; handle = $j.handle; titulo = $j.titulo
        processo = $j.processo; largura = $j.w; altura = $j.h
      })
      continue
    }

    if ($linha.StartsWith('QUADRO ')) {
      $alvo = $linha.Substring(7).Trim()
      $j = Foco
      if ($j.handle -ne $alvo) {
        Responder ([pscustomobject]@{ ok = $false; erro = 'foco_mudou' })
        continue
      }
      if ($j.w -le 0 -or $j.h -le 0) {
        Responder ([pscustomobject]@{ ok = $false; erro = 'janela_sem_area' })
        continue
      }
      $cron = [System.Diagnostics.Stopwatch]::StartNew()
      $bmp = New-Object System.Drawing.Bitmap $j.w, $j.h
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($j.x, $j.y, 0, 0, (New-Object System.Drawing.Size $j.w, $j.h))
      $mini = New-Object System.Drawing.Bitmap $LADO, $LADO
      $gm = [System.Drawing.Graphics]::FromImage($mini)
      $gm.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
      $gm.DrawImage($bmp, 0, 0, $LADO, $LADO)
      $g.Dispose(); $bmp.Dispose()
      $sb = New-Object System.Text.StringBuilder ($LADO * $LADO * 2)
      for ($yy = 0; $yy -lt $LADO; $yy++) {
        for ($xx = 0; $xx -lt $LADO; $xx++) {
          $p = $mini.GetPixel($xx, $yy)
          $v = [int](0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B)
          [void]$sb.Append($v.ToString('x2'))
        }
      }
      $gm.Dispose(); $mini.Dispose()
      Responder ([pscustomobject]@{ ok = $true; cinza = $sb.ToString(); ms = [math]::Round($cron.Elapsed.TotalMilliseconds, 2) })
      continue
    }

    if ($linha.StartsWith('TEXTO ')) {
      $alvo = $linha.Substring(6).Trim()
      $j = Foco
      if ($j.handle -ne $alvo) {
        Responder ([pscustomobject]@{ ok = $false; erro = 'foco_mudou' })
        continue
      }
      if ($j.w -le 0 -or $j.h -le 0) {
        Responder ([pscustomobject]@{ ok = $false; erro = 'janela_sem_area' })
        continue
      }
      $cron = [System.Diagnostics.Stopwatch]::StartNew()
      $linhas = LerTexto $j
      if ($null -eq $linhas) {
        Responder ([pscustomobject]@{ ok = $false; erro = 'ocr_indisponivel' })
        continue
      }
      Responder ([pscustomobject]@{ ok = $true; linhas = $linhas; ms = [math]::Round($cron.Elapsed.TotalMilliseconds, 2) })
      continue
    }

    Responder ([pscustomobject]@{ ok = $false; erro = 'comando_desconhecido' })
  } catch {
    Responder ([pscustomobject]@{ ok = $false; erro = $_.Exception.Message })
  }
}
`;

/**
 * Por que a captura não está disponível, ou `null`.
 *
 * NÃO importa `AgenteLocal` para reusar `capturaIndisponivelPorque`, e a
 * duplicação de uma linha é deliberada: a percepção não pode ganhar, por
 * conveniência, uma aresta de grafo até o módulo que abre `spawn` de aplicativo,
 * apaga arquivo e desliga máquina. A fronteira interna é verificada por grafo, e
 * um `import` de conveniência é como ela se perde.
 */
export function percepcaoIndisponivelPorque(): string | null {
  return process.platform === 'win32'
    ? null
    : `percepção de tela exige a API gráfica do Windows; este processo roda em ${process.platform}`;
}

/**
 * O helper vivo. UM processo por Braço, não um por quadro.
 *
 * Toda a diferença de custo do P0 está nesta frase: `Add-Type` compila o
 * P/Invoke uma vez (~200–400 ms na primeira chamada) e depois cada captura é
 * uma linha no cano.
 */
export class CapturaDeQuadro {
  private processo: ChildProcessWithoutNullStreams | null = null;
  private pendente: ((linha: string) => void) | null = null;
  private buffer = '';
  private encerrado = false;

  /** Liga o helper. Idempotente: chamar duas vezes não abre dois processos. */
  iniciar(): void {
    if (this.processo || this.encerrado) return;
    const indisponivel = percepcaoIndisponivelPorque();
    if (indisponivel) throw new Error(indisponivel);

    const codificado = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const filho = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );

    filho.stdout.setEncoding('utf8');
    filho.stdout.on('data', (pedaco: string) => {
      this.buffer += pedaco;
      let fim = this.buffer.indexOf(TERMINADOR);
      while (fim >= 0) {
        /* A resposta é tudo até o terminador, com as quebras removidas. Uma
           resposta de OCR tem dezenas de linhas de texto e o console quebra a
           saída onde bem entende — juntar tudo e cortar no sentinela é o que
           torna o enquadramento independente disso. */
        const corpo = this.buffer.slice(0, fim).replace(/[\r\n]+/g, '').trim();
        this.buffer = this.buffer.slice(fim + TERMINADOR.length);
        if (corpo && this.pendente) {
          const entregar = this.pendente;
          this.pendente = null;
          entregar(corpo);
        }
        fim = this.buffer.indexOf(TERMINADOR);
      }
    });

    /* O erro do helper vai para o console do Braço e não derruba nada: a
       percepção é uma capacidade a mais, e uma falha nela não pode calar o
       processo que também executa as ordens do operador. */
    filho.stderr.setEncoding('utf8');
    filho.stderr.on('data', (m: string) => {
      const limpo = m.trim();
      if (limpo) console.warn(`[IARA] percepção (helper): ${limpo.slice(0, 300)}`);
    });

    filho.on('exit', (codigo) => {
      this.processo = null;
      if (!this.encerrado) console.warn(`[IARA] helper de percepção saiu (código ${codigo})`);
    });

    this.processo = filho;
  }

  private async perguntar(comando: string, prazo = PRAZO_RESPOSTA_MS): Promise<Record<string, unknown>> {
    if (!this.processo) this.iniciar();
    const filho = this.processo;
    if (!filho) throw new Error('helper de percepção indisponível');
    if (this.pendente) throw new Error('helper de percepção ocupado');

    return new Promise((resolver, rejeitar) => {
      const relogio = setTimeout(() => {
        this.pendente = null;
        rejeitar(new Error(`helper de percepção não respondeu em ${prazo} ms`));
      }, prazo);

      this.pendente = (linha) => {
        clearTimeout(relogio);
        try {
          resolver(JSON.parse(linha) as Record<string, unknown>);
        } catch {
          rejeitar(new Error(`resposta ilegível do helper: ${linha.slice(0, 120)}`));
        }
      };
      filho.stdin.write(`${comando}\n`);
    });
  }

  /**
   * A janela em foco — METADADO, sem ler um pixel sequer.
   *
   * É a primeira metade da trava de escopo. Quem chama decide, com esta
   * resposta, se pode pedir o quadro.
   */
  async janela(): Promise<JanelaEmFoco | null> {
    const r = await this.perguntar('JANELA');
    if (r.ok !== true) return null;
    return {
      handle: String(r.handle ?? ''),
      titulo: String(r.titulo ?? ''),
      processo: String(r.processo ?? 'desconhecido').toLowerCase(),
      largura: Number(r.largura ?? 0),
      altura: Number(r.altura ?? 0),
    };
  }

  /**
   * O quadro daquela janela, em 32×32 tons de cinza. `null` se o foco mudou.
   *
   * `null` por foco mudado é resposta CERTA, não falha: entre a leitura do
   * metadado e a captura a pessoa pode ter trocado de janela, e capturar assim
   * mesmo leria pixels de uma aplicação que ninguém autorizou.
   */
  async quadro(handle: string): Promise<Quadro | null> {
    const r = await this.perguntar(`QUADRO ${handle}`);
    if (r.ok !== true) return null;
    const hex = String(r.cinza ?? '');
    const esperado = LADO_MINIATURA * LADO_MINIATURA * 2;
    if (hex.length !== esperado) return null;
    const cinza: number[] = [];
    for (let i = 0; i < hex.length; i += 2) cinza.push(parseInt(hex.slice(i, i + 2), 16));
    return { cinza, ms: Number(r.ms ?? 0) };
  }

  /**
   * O TEXTO da janela em foco, lido LOCALMENTE. `null` quando não há OCR nesta
   * máquina ou o foco mudou.
   *
   * O motor é o do próprio Windows (`Windows.Media.Ocr`), sondado nesta máquina
   * em 21/08/2026: disponível, `pt-BR`, 91,5 ms por leitura. Nenhuma dependência
   * nova entrou no pacote do Braço por causa disto — e o dia em que a máquina não
   * tiver o pacote de idioma, `null` é a resposta honesta: a percepção continua
   * detectando mudança e diz que não consegue ler texto.
   *
   * O BITMAP NÃO SAI DO PROCESSO DO HELPER. Ele é desenhado, passado ao OCR em
   * memória e descartado dentro da mesma função. O que atravessa o cano são
   * LINHAS DE TEXTO — e elas ainda passam pela máscara antes de virar evento.
   */
  async texto(handle: string): Promise<{ linhas: readonly string[]; ms: number } | null> {
    const r = await this.perguntar(`TEXTO ${handle}`, PRAZO_OCR_MS);
    if (r.ok !== true || !Array.isArray(r.linhas)) return null;
    return {
      linhas: (r.linhas as unknown[]).map((x) => String(x)).filter((x) => x.trim().length > 0),
      ms: Number(r.ms ?? 0),
    };
  }

  /** Desliga o helper. Depois disto a instância não volta a ligar. */
  encerrar(): void {
    this.encerrado = true;
    const filho = this.processo;
    if (!filho) return;
    try {
      filho.stdin.write('SAIR\n');
      filho.stdin.end();
    } catch {
      /* cano já fechado: o kill abaixo resolve */
    }
    setTimeout(() => {
      if (!filho.killed) filho.kill();
    }, 300).unref?.();
    this.processo = null;
  }

  get ligado(): boolean {
    return this.processo !== null;
  }
}
