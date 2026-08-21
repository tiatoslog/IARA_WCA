# EXPERIMENTO C — o contexto de lancamento e a variavel.
#
# A e B provaram que `windowsHide` NAO esconde a janela: as duas variantes
# criaram janela visivel quando lancadas do shell do agente. Sobra uma
# diferenca entre o meu teste e o braco: o braco descende do Agendador de
# Tarefas (InteractiveToken), nao de um shell.
#
# Este script roda COMO TAREFA AGENDADA e faz exatamente o que o braco faz.
# Se aqui nao aparecer janela, o contexto de lancamento e a causa, e
# `windowsHide` era inocente.

$saida = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21\GATE-07-contexto.txt"
$L = New-Object System.Collections.ArrayList
function W($t) { [void]$L.Add($t) }

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class J3 {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  public static List<string> Visiveis() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
      r.Add(pid + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@

W "EXPERIMENTO C - contexto de lancamento - $(Get-Date -Format o)"
W "quem: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
W "sessao deste processo: $((Get-Process -Id $PID).SessionId)"
W "sanidade da enumeracao: $((([J3]::Visiveis()) | Measure-Object).Count) janelas visiveis com titulo"
W ""

Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
W "notepads antes: $(@(Get-Process -Name Notepad -ErrorAction SilentlyContinue).Count)"

$js = "const{spawn}=require('node:child_process');const c=spawn('notepad.exe',[],{detached:true,stdio:'ignore',windowsHide:true});console.log(c.pid);c.unref();"
$lancado = (& "C:\Program Files\nodejs\node.exe" -e $js) | Select-Object -First 1
W "pid lancado por node (windowsHide: true, como o braco): $lancado"

Start-Sleep -Seconds 8

$procs = @(Get-CimInstance Win32_Process -Filter "Name like '%otepad%'")
W ""
W "processos notepad depois: $($procs.Count)"
foreach ($p in $procs) { W ("   pid={0} pai={1} linha={2}" -f $p.ProcessId, $p.ParentProcessId, $p.CommandLine) }

$ids = @($procs | ForEach-Object { [string]$_.ProcessId })
$janelas = @()
foreach ($v in [J3]::Visiveis()) { if ($ids -contains ($v -split "\|")[0]) { $janelas += $v } }
W ""
W "JANELAS VISIVEIS DE NOTEPAD: $($janelas.Count)"
foreach ($j in $janelas) { W "   $j" }
W ""
W "VEREDITO DESTE EXPERIMENTO:"
W ($(if ($janelas.Count -gt 0) { "  janela APARECEU -> o contexto do Agendador NAO e a causa" } else { "  janela NAO apareceu -> o contexto de lancamento E a causa" }))

$L -join "`r`n" | Out-File -FilePath $saida -Encoding utf8
