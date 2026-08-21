# Registra e dispara o olho de fora. A tarefa e um INSTRUMENTO: ela nao inicia
# o braco, so observa e escreve um relatorio.
$user = "$env:USERDOMAIN\$env:USERNAME"
$base = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21"
$alvo = "$base\olho-de-fora.ps1"

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Instrumento de auditoria: observa e escreve relatorio. Nao inicia o braco.</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy></Settings>
  <Triggers />
  <Actions Context="Author"><Exec><Command>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Command><Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$alvo"</Arguments></Exec></Actions>
</Task>
"@
[System.IO.File]::WriteAllText("$base\olho.xml", $xml, [System.Text.Encoding]::Unicode)
schtasks /create /f /tn "IARA-OlhoDeFora" /xml "$base\olho.xml" 2>&1 | Out-String
schtasks /run /tn "IARA-OlhoDeFora" 2>&1 | Out-String
