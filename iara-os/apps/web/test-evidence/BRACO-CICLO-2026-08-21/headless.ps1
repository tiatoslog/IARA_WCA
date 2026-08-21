# SUPERVISOR-HEADLESS - prova de que a janela NAO EXISTE, e nao de que
# "eu nao a vi na tela".
#
# SEM UM UNICO CARACTERE NAO-ASCII: o PowerShell 5.1 le .ps1 como ANSI quando
# nao ha BOM, e um travessao no comentario quebra as aspas do codigo la embaixo
# em cascata. Custou uma rodada.
#
# Enumera as janelas de topo pelo proprio Windows (EnumWindows) e cruza com os
# PIDs do supervisor e do runtime.

param([string]$nome = "GATE-11-headless")
$saida = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21\$nome.txt"
$L = New-Object System.Collections.ArrayList
function W($t) { [void]$L.Add($t) }

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class JH {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  public static List<string> Todas() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      int n = GetWindowTextLength(h);
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
      r.Add(pid + ";" + h.ToInt64() + ";" + (IsWindowVisible(h) ? "VISIVEL" : "oculta") + ";" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@

$todas = [JH]::Todas()
W "SUPERVISOR-HEADLESS - $(Get-Date -Format o)"
W "quem: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)  sessao: $((Get-Process -Id $PID).SessionId)"
W "sanidade da enumeracao: $($todas.Count) janelas de topo no total"
W ""

$procs = @(Get-CimInstance Win32_Process -Filter "Name like '%supervisor%' or Name like '%iara-braco%'")
W "=============== 1. PROCESSOS ==============="
if ($procs.Count -eq 0) { W "  NENHUM: o braco nao esta de pe" }
foreach ($p in $procs) {
  $pai = "(pai ja saiu)"
  try { $pai = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction Stop).Name } catch { }
  $ses = "?"
  try { $ses = (Get-Process -Id $p.ProcessId).SessionId } catch { }
  W ("  pid={0} pai={1}({2}) sessao={3} nome={4} criado={5}" -f $p.ProcessId, $p.ParentProcessId, $pai, $ses, $p.Name, $p.CreationDate)
}
W ""

W "=============== 2. SUBSISTEMA DO PE ==============="
W "  2 = WINDOWS_GUI (sem console)   3 = WINDOWS_CUI (com console)"
function Subsistema($caminho) {
  try {
    $fs = [System.IO.File]::OpenRead($caminho)
    $b = New-Object byte[] 1024
    [void]$fs.Read($b, 0, 1024)
    $fs.Close()
    $inicio = [BitConverter]::ToUInt32($b, 60)
    $optional = $inicio + 24
    return [BitConverter]::ToUInt16($b, $optional + 68)
  } catch { return -1 }
}
$pastaBraco = "$env:LOCALAPPDATA\IARA\braco"
$sup = Join-Path $pastaBraco "supervisor.exe"
$vSup = Subsistema $sup
$rotulo = "desconhecido"
if ($vSup -eq 2) { $rotulo = "GUI, SEM console" }
if ($vSup -eq 3) { $rotulo = "CONSOLE" }
W ("  supervisor.exe -> Subsystem={0} ({1})" -f $vSup, $rotulo)
Get-ChildItem (Join-Path $pastaBraco "versoes") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $r = Join-Path $_.FullName "iara-braco.exe"
  if (Test-Path $r) { W ("  {0} -> Subsystem={1}" -f $_.Name, (Subsistema $r)) }
}
W ""

$ids = @($procs | ForEach-Object { [string]$_.ProcessId })

W "=============== 3. JANELAS DESSES PROCESSOS ==============="
$doBraco = New-Object System.Collections.ArrayList
foreach ($j in $todas) {
  $campos = $j.Split(";")
  if ($ids -contains $campos[0]) { [void]$doBraco.Add($j) }
}
W ("  janelas de topo do braco: {0}" -f $doBraco.Count)
foreach ($j in $doBraco) { W ("     " + $j) }
W ""

W "=============== 4. JANELAS COM O NOME DO BRACO NO TITULO ==============="
$suspeitas = New-Object System.Collections.ArrayList
foreach ($j in $todas) {
  $campos = $j.Split(";")
  $t = $campos[$campos.Length - 1]
  if ($t -match "braco" -or $t -match "supervisor" -or $t -match "iara-braco") { [void]$suspeitas.Add($j) }
}
W ("  encontradas: {0}" -f $suspeitas.Count)
foreach ($j in $suspeitas) { W ("     " + $j) }
W ""

W "=============== 5. CONHOST ASSOCIADO ==============="
W "  conhost.exe hospeda console. Um conhost filho do braco significa console"
W "  associado, mesmo que nenhuma janela esteja visivel."
$conhosts = @(Get-CimInstance Win32_Process -Filter "Name = 'conhost.exe'" | Where-Object { $ids -contains [string]$_.ParentProcessId })
W ("  conhost filhos do braco: {0}" -f $conhosts.Count)
foreach ($c in $conhosts) { W ("     pid={0} pai={1}" -f $c.ProcessId, $c.ParentProcessId) }
W ""

W "=============== VEREDITO ==============="
$vivo = $procs.Count -ge 2
W ("  supervisor e runtime vivos ......... {0}" -f $(if ($vivo) { "PASS" } else { "FAIL" }))
W ("  zero janelas do braco .............. {0}" -f $(if ($doBraco.Count -eq 0) { "PASS" } else { "FAIL" }))
W ("  zero janelas com nome do braco ..... {0}" -f $(if ($suspeitas.Count -eq 0) { "PASS" } else { "FAIL" }))
W ("  zero conhost associado ............. {0}" -f $(if ($conhosts.Count -eq 0) { "PASS" } else { "FAIL" }))
W ("  supervisor sem console no PE ....... {0}" -f $(if ($vSup -eq 2) { "PASS" } else { "FAIL" }))

$L -join "`r`n" | Out-File -FilePath $saida -Encoding utf8
