@echo off
REM ===========================================================================
REM  Disparo automatico da campanha adversarial da IARA.
REM
REM  Existe para o Agendador de Tarefas do Windows chamar as 3h da manha, sem
REM  ninguem na frente da maquina. Um .cmd e nao um .ps1 porque a politica de
REM  execucao de script do PowerShell varia por maquina, e uma campanha que nao
REM  dispara por politica de assinatura e uma campanha que nao existe.
REM
REM  O que ele NAO faz, de proposito:
REM   . nao roda `npm install` (mexeria na arvore compartilhada durante a noite);
REM   . nao roda `npm run build` (compartilha .next com o dev de quem estiver
REM     trabalhando, e quebraria o servidor da outra sessao);
REM   . nao commita nada. Campanha mede; quem decide o que fazer com a medida
REM     e uma pessoa lendo o relatorio de manha.
REM
REM  Porta 3081 e nao 3071: a porta de desenvolvimento da campanha pode estar
REM  ocupada por alguem depurando, e o corredor recusa subir em porta ocupada.
REM ===========================================================================

setlocal
cd /d "%~dp0.."

set CARIMBO=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%
set CARIMBO=%CARIMBO: =0%
set DESTINO=test-evidence\campanha-noturna-%CARIMBO%.log

echo === campanha adversarial da IARA — inicio %DATE% %TIME% === > "%DESTINO%"

REM Prova de vida do Ollama ANTES de qualquer coisa. Sem cerebro a campanha
REM mede silencio e chama de recusa honesta — o pior relatorio possivel:
REM inteiramente verde e inteiramente vazio.
curl -s -m 10 http://127.0.0.1:11434/api/tags > nul 2>&1
if errorlevel 1 (
  echo ABORTADO: Ollama nao respondeu em 127.0.0.1:11434 >> "%DESTINO%"
  exit /b 2
)
echo Ollama respondeu. >> "%DESTINO%"

REM Os argumentos da rodada severa. Sobrescreviveis por ambiente para que ESTE
REM arquivo possa ser exercitado de ponta a ponta sem esperar duas voltas
REM inteiras — um lancador que nunca foi disparado e uma suposicao, e o
REM Agendador de Tarefas so avisa que falhou depois da hora marcada.
REM Uma volta, nao duas: medido em 16/08/2026, uma chamada ao provedor local
REM nesta maquina custa ~260 s (llama3.2:3b em CPU, persona de ~3,8k tokens).
REM Duas voltas do catalogo nao caberiam no teto de 4h do Agendador, e a
REM campanha seria cortada no meio pelo sistema operacional. O orcamento de
REM 200 min faz ela mesma parar antes disso e DECLARAR o que nao rodou.
if not defined IARA_CAMPANHA_ARGS set IARA_CAMPANHA_ARGS=--porta 3081 --voltas 1 --prazo 600000 --orcamento 200

echo Argumentos: %IARA_CAMPANHA_ARGS% >> "%DESTINO%"
call npm run campanha -- %IARA_CAMPANHA_ARGS% >> "%DESTINO%" 2>&1
set CODIGO=%ERRORLEVEL%

echo. >> "%DESTINO%"
echo === fim %DATE% %TIME% — codigo %CODIGO% === >> "%DESTINO%"
exit /b %CODIGO%
