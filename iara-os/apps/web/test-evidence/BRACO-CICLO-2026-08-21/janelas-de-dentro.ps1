# JANELAS VISTAS DE DENTRO DA SESSAO INTERATIVA.
#
# POR QUE ESTE ARQUIVO EXISTE: a sessao do agente enumera processos, mas ve
# MainWindowHandle=0 ate para um Notepad que a operadora tem aberto na frente
# dela. Instrumento cego. Este script roda como tarefa agendada com
# InteractiveToken - dentro da sessao 1 - e usa EnumWindows do proprio Windows.

$saida = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21\GATE-05-janelas.txt"
$L = New-Object System.Collections.ArrayList
function W($t) { [void]$L.Add($t) }

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Janelas {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static List<string> Todas() {
    var saida = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      int n = GetWindowTextLength(h);
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
      RECT r; GetWindowRect(h, out r);
      saida.Add(string.Format("{0}|{1}|{2}|{3}x{4} em ({5},{6})|{7}",
        pid, h.ToInt64(), IsWindowVisible(h) ? "VISIVEL" : "oculta",
        r.R - r.L, r.B - r.T, r.L, r.T, sb.ToString()));
      return true;
    }, IntPtr.Zero);
    return saida;
  }
}
"@

W "JANELAS DE DENTRO - $(Get-Date -Format o)"
W "quem: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
W "sessao deste script: $((Get-Process -Id $PID).SessionId)"
$inter = (Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" | Select-Object -First 1)
if ($inter) { W "sessao do explorer.exe (a sessao interativa): $((Get-Process -Id $inter.ProcessId).SessionId)" }
W ""

W "=============== PROCESSOS NOTEPAD ==============="
foreach ($p in Get-CimInstance Win32_Process -Filter "Name like '%otepad%'") {
  $s = try { (Get-Process -Id $p.ProcessId -ErrorAction Stop).SessionId } catch { "?" }
  W ("  pid={0} pai={1} sessao={2} criado={3}" -f $p.ProcessId, $p.ParentProcessId, $s, $p.CreationDate)
  W ("     linha={0}" -f $p.CommandLine)
}
W ""

W "=============== O BRACO ==============="
foreach ($p in Get-CimInstance Win32_Process -Filter "Name like '%iara%' or Name like '%supervisor%'") {
  $s = try { (Get-Process -Id $p.ProcessId -ErrorAction Stop).SessionId } catch { "?" }
  W ("  pid={0} pai={1} sessao={2} nome={3} criado={4}" -f $p.ProcessId, $p.ParentProcessId, $s, $p.Name, $p.CreationDate)
}
W ""

W "=============== TODAS AS JANELAS DE TOPO ==============="
W "  (pid | hwnd | visivel | tamanho e posicao | titulo)"
$alvos = @{}
foreach ($p in Get-CimInstance Win32_Process -Filter "Name like '%otepad%' or Name like '%iara%' or Name like '%supervisor%'") { $alvos[[uint32]$p.ProcessId] = $p.Name }
foreach ($j in [Janelas]::Todas()) {
  $pid = [uint32]($j -split "\|")[0]
  if ($alvos.ContainsKey($pid)) { W ("  >>> {0}  [{1}]" -f $j, $alvos[$pid]) }
}
W ""
W "  --- janelas VISIVEIS com titulo, de qualquer processo (contexto) ---"
foreach ($j in [Janelas]::Todas()) {
  $partes = $j -split "\|"
  if ($partes[2] -eq "VISIVEL" -and $partes[4].Trim() -ne "") {
    $nome = try { (Get-Process -Id ([int]$partes[0]) -ErrorAction Stop).ProcessName } catch { "?" }
    W ("  {0} ({1}) {2} :: {3}" -f $partes[0], $nome, $partes[3], $partes[4])
  }
}

$L -join "`r`n" | Out-File -FilePath $saida -Encoding utf8
