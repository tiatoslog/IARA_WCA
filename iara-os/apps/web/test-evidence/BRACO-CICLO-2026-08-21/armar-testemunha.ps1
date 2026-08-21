# TESTEMUNHA DE LOGON - o instrumento que sobrevive ao reboot.
#
# POR QUE ELA PRECISA EXISTIR: a sessao do agente morre no reboot. Quando ele
# voltar, so conseguiria ver o "agora" - e "agora" nao responde "quem iniciou o
# supervisor?" nem "quanto tempo depois do logon ele subiu?". A testemunha
# fotografa isso no instante em que acontece.
#
# ELA NAO INICIA O BRACO. Nao executa o supervisor, nao executa o runtime, nao
# executa o instalador. Le e escreve um relatorio. E instrumento de medida, e
# sai do disco assim que o gate fechar.
#
# O atraso de 3 minutos e proposital: a tarefa IARA-Braco tem PT20S, e depois
# dela o runtime ainda precisa subir, autenticar e se registrar. Fotografar
# antes disso mediria a propria pressa.

$base = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21"
$user = "$env:USERDOMAIN\$env:USERNAME"

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>INSTRUMENTO DE AUDITORIA. Fotografa o estado do braco depois do logon. Nao inicia nada. Remover quando o gate fechar.</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId><Delay>PT3M</Delay></LogonTrigger></Triggers>
  <Actions Context="Author"><Exec>
    <Command>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Command>
    <Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$base\olho-de-fora.ps1" GATE-04-pos-reboot</Arguments>
    <WorkingDirectory>$base</WorkingDirectory>
  </Exec></Actions>
</Task>
"@
[System.IO.File]::WriteAllText("$base\testemunha.xml", $xml, [System.Text.Encoding]::Unicode)
schtasks /create /f /tn "IARA-Testemunha" /xml "$base\testemunha.xml" 2>&1 | Out-String

# As tarefas-instrumento saem: depois do reboot so pode existir UMA tarefa
# responsavel pelo startup do braco, que e a IARA-Braco.
foreach ($t in @("IARA-Instalar", "IARA-OlhoDeFora")) { schtasks /delete /tn $t /f 2>&1 | Out-Null }

Write-Output "--- tarefas com IARA no nome, e o que cada uma INICIA ---"
Get-ScheduledTask | Where-Object { $_.TaskName -like "*IARA*" } | ForEach-Object {
  $a = $_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }
  $g = $_.Triggers | ForEach-Object { $_.CimClass.CimClassName }
  "{0,-28} gatilho={1,-22} acao={2}" -f $_.TaskName, ($g -join ","), ($a -join " ; ")
}
