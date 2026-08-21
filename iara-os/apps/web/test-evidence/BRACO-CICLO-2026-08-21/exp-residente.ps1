# EXPERIMENTO D — H3: instancia residente absorve a ativacao.
#
# H1 (windowsHide) e H8 (contexto do Agendador) ja foram REFUTADOS por
# experimento. A diferenca que sobrou entre os testes que funcionaram e o
# lancamento do braco que falhou: nos testes eu matei todos os notepads antes.
# Quando o braco tentou, existia uma instancia residente SEM JANELA — a que a
# operadora abriu 11:21 e cujo processo continuou vivo depois de ela fechar.
#
# Aqui isso vira variavel controlada: mesmo lancamento, duas vezes, com a
# diferenca de haver ou nao um residente sem janela.

$saida = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21\GATE-08-residente.txt"
$L = New-Object System.Collections.ArrayList
function W($t) { [void]$L.Add($t) }

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class J4 {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  public static List<string> Visiveis() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity);
      r.Add(pid + "|" + h.ToInt64() + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
  public const uint WM_CLOSE = 0x0010;
}
"@

function LancarComoOBraco {
  $js = "const{spawn}=require('node:child_process');const c=spawn('notepad.exe',[],{detached:true,stdio:'ignore',windowsHide:true});console.log(c.pid);c.unref();"
  return (& "C:\Program Files\nodejs\node.exe" -e $js) | Select-Object -First 1
}
function NotepadProcs { return ,@(Get-CimInstance Win32_Process -Filter "Name like '%otepad%'") }
function JanelasNotepad {
  $ids = @((NotepadProcs) | ForEach-Object { [string]$_.ProcessId })
  $r = @()
  foreach ($v in [J4]::Visiveis()) { if ($ids -contains ($v -split "\|")[0]) { $r += $v } }
  return ,$r
}

W "EXPERIMENTO D — instancia residente - $(Get-Date -Format o)"
W ""

# ---- Rodada 1: SEM residente (controle positivo) ----
Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
W "RODADA 1 — sem nenhum notepad vivo (controle)"
W "   notepads antes: $((NotepadProcs).Count)"
$p1 = LancarComoOBraco
Start-Sleep -Seconds 7
$j1 = JanelasNotepad
W "   pid lancado: $p1"
W "   processos depois: $((NotepadProcs).Count)"
W "   JANELAS VISIVEIS: $($j1.Count)"
foreach ($x in $j1) { W "      $x" }
W ""

# ---- Fecha a JANELA, deixa o processo vivo ----
W "Fechando a(s) janela(s) com WM_CLOSE, sem matar o processo..."
foreach ($x in $j1) {
  $h = [IntPtr][int64](($x -split "\|")[1])
  [void][J4]::SendMessage($h, [J4]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
}
Start-Sleep -Seconds 5
$residentes = NotepadProcs
$janelasAgora = JanelasNotepad
W "   processos notepad ainda vivos: $($residentes.Count) -> $(($residentes | ForEach-Object { $_.ProcessId }) -join ', ')"
W "   janelas visiveis agora: $($janelasAgora.Count)"
W ""

if ($residentes.Count -eq 0) {
  W "RODADA 2 IMPOSSIVEL: fechar a janela matou o processo — nao ha residente."
  W "VEREDITO: H3 nao pode ser exercitada nesta maquina desta forma."
} else {
  W "RODADA 2 — COM residente sem janela (a condicao do braco as 11:36)"
  $p2 = LancarComoOBraco
  Start-Sleep -Seconds 8
  $j2 = JanelasNotepad
  $procs2 = NotepadProcs
  W "   pid lancado: $p2"
  W "   processos depois: $($procs2.Count)"
  foreach ($p in $procs2) { W ("      pid={0} pai={1}" -f $p.ProcessId, $p.ParentProcessId) }
  W "   JANELAS VISIVEIS: $($j2.Count)"
  foreach ($x in $j2) { W "      $x" }
  W ""
  W "VEREDITO:"
  if ($j2.Count -eq 0) {
    W "  H3 CONFIRMADA — com residente sem janela, o lancamento nao produz janela."
  } else {
    W "  H3 REFUTADA — a janela apareceu mesmo com residente."
  }
}

Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$L -join "`r`n" | Out-File -FilePath $saida -Encoding utf8
