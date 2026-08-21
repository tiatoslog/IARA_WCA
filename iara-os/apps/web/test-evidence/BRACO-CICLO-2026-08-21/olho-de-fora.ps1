# OLHO DE FORA - roda como tarefa agendada, no Windows real, e escreve o que ve.
#
# Existe porque as leituras da sessao do agente em %LOCALAPPDATA% mostram uma
# camada de sandbox, nao o disco. Este script roda FORA dela. Sem acentos de
# proposito: PowerShell 5.1 corrompe UTF-8 na escrita.

param([string]$nome = "GATE-01-pre-reboot")
$saida = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21\$nome.txt"
$L = New-Object System.Collections.ArrayList
function W($t) { [void]$L.Add($t) }

W "OLHO DE FORA - $(Get-Date -Format o)"
W "quem: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
W "sessao: $((Get-Process -Id $PID).SessionId)"
W ""

W "=============== 1. OS ARQUIVOS NO DISCO REAL ==============="
$pasta = "$env:LOCALAPPDATA\IARA\braco"
W "pasta: $pasta"
if (-not (Test-Path $pasta)) { W "  A PASTA NAO EXISTE" }
else {
  Get-ChildItem -Recurse -Force $pasta -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.PSIsContainer) { W ("  [DIR ] {0}" -f $_.FullName) }
    else {
      $h = try { (Get-FileHash $_.FullName -Algorithm SHA256).Hash } catch { "(hash falhou)" }
      W ("  [FILE] {0}" -f $_.FullName)
      W ("         tamanho={0}  escrito={1}" -f $_.Length, $_.LastWriteTime.ToString("o"))
      W ("         sha256={0}" -f $h)
      $v = $_.VersionInfo
      if ($v -and $v.FileVersion) { W ("         versao-arquivo={0} produto={1}" -f $v.FileVersion, $v.ProductVersion) }
      $acl = try { (Get-Acl $_.FullName).Access | ForEach-Object { "{0}={1}" -f $_.IdentityReference, $_.FileSystemRights } } catch { @("(acl falhou)") }
      W ("         acl: {0}" -f ($acl -join " | "))
    }
  }
}
W ""

W "=============== 2. atual.json ==============="
$aj = Join-Path $pasta "atual.json"
if (Test-Path $aj) { W (Get-Content $aj -Raw) } else { W "  AUSENTE" }
W ""

W "=============== 3. supervisor.json ==============="
$sj = Join-Path $pasta "supervisor.json"
if (Test-Path $sj) { W (Get-Content $sj -Raw) } else { W "  AUSENTE" }
W ""

W "=============== 4. IDENTIDADE (fora da instalacao, de proposito) ==============="
$id = "$env:APPDATA\iara\braco.json"
if (Test-Path $id) {
  $f = Get-Item $id
  W ("  existe: {0}  tamanho={1}  escrito={2}" -f $f.FullName, $f.Length, $f.LastWriteTime.ToString("o"))
  $j = try { Get-Content $id -Raw | ConvertFrom-Json } catch { $null }
  if ($j) { W ("  campos: {0}" -f (($j.PSObject.Properties | ForEach-Object { $_.Name }) -join ", ")) }
} else { W "  AUSENTE - a maquina nao tem credencial" }
W ""

W "=============== 5. TAREFAS AGENDADAS COM 'IARA' ==============="
$todas = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like "*IARA*" -or $_.TaskName -like "*Braco*" }
W ("  quantidade: {0}" -f @($todas).Count)
foreach ($t in $todas) {
  W ("  --- {0}{1}  estado={2}" -f $t.TaskPath, $t.TaskName, $t.State)
  foreach ($a in $t.Actions) { W ("      acao: [{0}] [{1}] wd=[{2}]" -f $a.Execute, $a.Arguments, $a.WorkingDirectory) }
  $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction SilentlyContinue
  if ($i) { W ("      ultima={0} resultado={1} proxima={2}" -f $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime) }
}
W ""

W "=============== 6. XML DA TAREFA IARA-Braco ==============="
try { W ((Export-ScheduledTask -TaskName "IARA-Braco" -ErrorAction Stop) -replace "`r`n", "`n") } catch { W "  NAO EXISTE: $($_.Exception.Message)" }
W ""

W "=============== 7. PROCESSOS AGORA ==============="
$procs = Get-CimInstance Win32_Process -Filter "Name like '%iara%' or Name like '%supervisor%' or Name like '%node%'" -ErrorAction SilentlyContinue
if (-not $procs) { W "  nenhum" }
foreach ($p in $procs) {
  $pai = try { (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction Stop).Name } catch { "(pai ja saiu)" }
  W ("  pid={0} pai={1}({2}) nome={3}" -f $p.ProcessId, $p.ParentProcessId, $pai, $p.Name)
  W ("     criado={0}" -f $p.CreationDate)
  W ("     linha={0}" -f $p.CommandLine)
}
W ""

W "=============== 8. LEGADO ==============="
W "  iara-motor.vbs no Startup?"
$st = [Environment]::GetFolderPath("Startup")
W ("    pasta: {0}" -f $st)
Get-ChildItem $st -Force -ErrorAction SilentlyContinue | ForEach-Object { W ("    - {0}" -f $_.Name) }
W "  chaves Run (HKCU e HKLM):"
foreach ($k in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Run","HKLM:\Software\Microsoft\Windows\CurrentVersion\Run")) {
  try { (Get-ItemProperty $k -ErrorAction Stop).PSObject.Properties | Where-Object { $_.Name -notlike "PS*" } | ForEach-Object { W ("    {0}: {1} = {2}" -f $k, $_.Name, $_.Value) } } catch { W "    ${k}: (sem chave)" }
}
W "  porta 3000 ocupada?"
$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($c) { foreach ($x in $c) { $pn = try { (Get-Process -Id $x.OwningProcess).ProcessName } catch { "?" }; W ("    LISTEN por pid={0} ({1})" -f $x.OwningProcess, $pn) } } else { W "    livre" }
W "  vestigios do vbs:"
Get-ChildItem "$env:LOCALAPPDATA\IARA" -Filter "*vbs*" -Force -ErrorAction SilentlyContinue | ForEach-Object { W ("    - {0} ({1} bytes)" -f $_.Name, $_.Length) }
W ""

W "=============== 9. BOOT ==============="
$os = Get-CimInstance Win32_OperatingSystem
W ("  ultimo boot: {0}" -f $os.LastBootUpTime)
W ("  agora:       {0}" -f (Get-Date))
$desdeBoot = (Get-Date) - $os.LastBootUpTime
W ("  tempo desde o boot: {0:N0}s" -f $desdeBoot.TotalSeconds)
W "  (compare com 'criado' do supervisor na secao 7: a distancia entre os dois"
W "   e o atraso real entre logon e braco de pe)"
W ""

W "=============== 10. O LADO DO MOTOR ==============="
# Quantos dispositivos o motor tem conectados AGORA. E o unico jeito de provar,
# de fora da maquina, que o runtime autenticou e se registrou - o socket so
# entra nesta contagem depois de a apresentacao ser aceita.
$motor = "https://iara.up.railway.app"
try {
  $id = Get-Content "$env:APPDATA\iara\braco.json" -Raw -ErrorAction Stop | ConvertFrom-Json
  if ($id.motor) { $motor = $id.motor }
} catch { }
W ("  motor: {0}" -f $motor)
$ok = $false
foreach ($tentativa in 1..6) {
  try {
    $r = Invoke-RestMethod -Uri "$motor/saude" -TimeoutSec 20 -ErrorAction Stop
    W ("  tentativa {0}: ok={1} dispositivos={2} maos_no_motor={3}" -f $tentativa, $r.ok, $r.dispositivos, $r.maos_no_motor)
    W ("     backend: {0} ({1}) ambiente={2}" -f $r.backend.versao, $r.backend.git_sha_curto, $r.backend.ambiente)
    W ("     autenticacao: {0}" -f $r.autenticacao)
    W ("     raciocinio: {0}" -f ($r.raciocinio -join ", "))
    $ok = $true
    break
  } catch {
    W ("  tentativa {0}: FALHOU - {1}" -f $tentativa, $_.Exception.Message)
    Start-Sleep -Seconds 10
  }
}
if (-not $ok) { W "  o motor nao respondeu em 6 tentativas" }

$L -join "`r`n" | Out-File -FilePath $saida -Encoding utf8
