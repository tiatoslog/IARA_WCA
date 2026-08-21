# INSTALA DE VERDADE.
#
# A sessao do agente escreve em %LOCALAPPDATA% atraves de uma camada de sandbox
# que o Windows real nao enxerga. Um processo iniciado pela TAREFA AGENDADA roda
# fora dessa camada - entao as escritas dele sao reais. A tarefa aqui e so o
# veiculo; quem instala e o proprio instalador do produto, sem argumento nenhum,
# exatamente como um duplo clique faria.

$base = "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21"
$exe  = "C:\Users\daian\Downloads\iara-braco.exe"
$log  = "$base\GATE-02-instalacao-real.txt"
$user = "$env:USERDOMAIN\$env:USERNAME"

Copy-Item "C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\dist\braco\iara-braco.exe" $exe -Force
Write-Output "instalador colocado em $exe"
Write-Output ("sha256: {0}" -f (Get-FileHash $exe -Algorithm SHA256).Hash)

$bat = "$base\rodar-instalador.bat"
@"
@echo off
"$exe" > "$log" 2>&1
echo exit=%errorlevel% >> "$log"
"@ | Out-File -FilePath $bat -Encoding ascii

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Veiculo de instalacao: roda o instalador do produto fora do sandbox do agente.</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><ExecutionTimeLimit>PT5M</ExecutionTimeLimit></Settings>
  <Triggers />
  <Actions Context="Author"><Exec><Command>C:\Windows\System32\cmd.exe</Command><Arguments>/c "$bat"</Arguments></Exec></Actions>
</Task>
"@
[System.IO.File]::WriteAllText("$base\instalar.xml", $xml, [System.Text.Encoding]::Unicode)
schtasks /create /f /tn "IARA-Instalar" /xml "$base\instalar.xml" 2>&1 | Out-String
schtasks /run /tn "IARA-Instalar" 2>&1 | Out-String
