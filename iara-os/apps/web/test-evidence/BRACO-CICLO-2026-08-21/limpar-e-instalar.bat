@echo off
rem Limpa o registro contaminado pelos testes de unidade e instala a versao nova.
rem Roda como tarefa agendada: e a unica forma de alcancar o %LOCALAPPDATA% real.
set BASE=C:\Users\daian\Desktop\IARA\IARA_WCA\iara-os\apps\web\test-evidence\BRACO-CICLO-2026-08-21
if exist "%LOCALAPPDATA%\IARA\braco\registro\" del /q "%LOCALAPPDATA%\IARA\braco\registro\*.log"
"C:\Users\daian\Downloads\iara-braco.exe" > "%BASE%\GATE-13-instalacao.txt" 2>&1
echo exit=%errorlevel% >> "%BASE%\GATE-13-instalacao.txt"
