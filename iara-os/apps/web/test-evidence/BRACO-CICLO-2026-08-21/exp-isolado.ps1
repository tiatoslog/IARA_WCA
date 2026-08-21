# EXPERIMENTO ISOLADO: uma variavel, uma rodada.
#
# A rodada anterior foi invalidada pelo proprio alvo: o Bloco de Notas do
# Windows 11 e singleton, entao lancar A e B juntos funde as janelas num
# processo so e nao da para atribuir qual lancamento criou o que. Aqui cada
# variante roda sozinha, com todos os notepads mortos antes.

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class J2 {
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

function MatarNotepads {
  Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

function JanelasDeNotepad {
  $pids = @(Get-CimInstance Win32_Process -Filter "Name like '%otepad%'" | ForEach-Object { [string]$_.ProcessId })
  $achadas = @()
  foreach ($v in [J2]::Visiveis()) {
    $p = ($v -split "\|")[0]
    if ($pids -contains $p) { $achadas += $v }
  }
  return ,$achadas
}

Write-Output "sanidade: esta sessao enumera janelas? -> $((([J2]::Visiveis()) | Measure-Object).Count) janelas visiveis com titulo"
Write-Output ""

foreach ($caso in @(
  @{ nome = "A  windowsHide: true  (como o braco faz hoje)"; flag = "true" },
  @{ nome = "B  windowsHide: false"; flag = "false" }
)) {
  MatarNotepads
  $antes = (JanelasDeNotepad).Count
  $js = "const{spawn}=require('node:child_process');const c=spawn('notepad.exe',[],{detached:true,stdio:'ignore',windowsHide:$($caso.flag)});console.log(c.pid);c.unref();"
  $pid = (& node -e $js) | Select-Object -First 1
  Start-Sleep -Seconds 6
  $procs = @(Get-CimInstance Win32_Process -Filter "Name like '%otepad%'")
  $janelas = JanelasDeNotepad
  Write-Output "=== $($caso.nome) ==="
  Write-Output "   pid lancado: $pid"
  Write-Output "   processos notepad depois: $($procs.Count)  -> $(($procs | ForEach-Object { "$($_.ProcessId)(pai $($_.ParentProcessId))" }) -join ', ')"
  Write-Output "   janelas VISIVEIS de notepad: $($janelas.Count)"
  foreach ($j in $janelas) { Write-Output "      $j" }
  Write-Output ""
}

MatarNotepads
Write-Output "limpo."
