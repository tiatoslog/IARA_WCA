# Gate físico do braço — onde paramos, e o que fazer ao voltar

A sessão do agente não sobrevive ao reboot. Este arquivo existe para o gate
continuar de onde parou, com quem quer que retome.

## Estado em 21/08/2026 10:40 — ARMADO, aguardando o reboot

### Instalado de verdade no Windows real

Verificado por um processo que roda FORA do sandbox do agente (tarefa agendada),
porque as leituras da sessão em `%LOCALAPPDATA%` mostram uma camada de
sobreposição e não o disco. Ver `08-LIMITE-DO-APARATO.md`.

```
%LOCALAPPDATA%\IARA\braco\
  supervisor.exe                     85.861.376 B   10:35:00
  versoes\1.3.0\iara-braco.exe       85.861.376 B   10:35:00
  atual.json                                 96 B   10:35:28   {"versao":"1.3.0"}
  supervisor.json                           168 B   10:35:32
```

Os dois executáveis têm o **mesmo** SHA256
`8B3775BD1B58665BE77E44326966D2D158E7DBC4424025CE62B30654147A4347` — é um
binário só, com o papel decidido por argumento.

### A tarefa `IARA-Braco`

Confirmado no XML que o Windows guardou (não no que eu mandei):

| exigência | valor registrado |
|---|---|
| gatilho | `LogonTrigger`, `Delay PT20S` |
| usuário | SID de `COMPUTADOR\daian`, trigger `COMPUTADOR\daian` |
| token | `InteractiveToken` — sessão gráfica |
| prazo | `ExecutionTimeLimit PT0S` (sem limite) |
| energia | `DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false` |
| caminho | absoluto, `…\braco\supervisor.exe` |
| argumento | `--supervisor` |
| diretório | `…\IARA\braco` |
| restart | `Count 3`, `Interval PT1M` |
| concorrente | nenhuma outra tarefa inicia o braço |

### Instrumentos armados

- `IARA-Testemunha` — logon + `PT3M`, roda `olho-de-fora.ps1` e escreve
  `GATE-04-pos-reboot.txt`. **Não inicia nada.** Remover quando o gate fechar:
  `schtasks /delete /tn IARA-Testemunha /f`
- `IARA-Instalar` e `IARA-OlhoDeFora` já foram removidas.

### Linha de base do motor, antes do reboot

O commit `64f82e1` foi para `main` às 13:46 e o Railway redeployou. O backend em
produção passou de `28b63bf` para **`64f82e1`** — é este SHA que `/saude` deve
reportar daqui em diante.

```
https://iara.up.railway.app/saude
  ok=true  modo=producao  autenticacao=supabase
  backend 1.0.0 (64f82e1)  ambiente=producao
```

### Reconexão já provada, de graça, pelo próprio deploy

O redeploy derrubou todas as conexões e é uma interrupção de transporte real:

```
13:47:20   sha 28b63bf   uptime 6629s   dispositivos 1
13:47:41   sha 64f82e1   uptime    2s   dispositivos 0   <- backend novo, todos caíram
13:48:02   sha 64f82e1   uptime   23s   dispositivos 1   <- o braço voltou sozinho
```

**~21 segundos, sem intervenção.** E o que prova que foi RECONEXÃO e não
renascimento: os PIDs não mudaram. Supervisor `23296` e runtime `26684`, criados
às 10:35:30 e 10:35:32, seguem os mesmos depois do episódio — o supervisor não
precisou reerguer nada, o próprio runtime restabeleceu o socket.

Isso cobre a parte de transporte do item 10 (perda de conexão). Falta a variante
de rede local caindo, que se testa depois do reboot.

### Contagem de dispositivos: pendência declarada

`dispositivos` oscilou entre 1 e 2 nas medições (2 às 10:39, 1 às 13:46, 2 às
13:49, 1 às 13:49). Esta máquina contribui com exatamente **1**. O segundo não é
daqui — outro computador ou socket órfão. **A resolver depois do reboot**, e não
pode ser confundido com o braço desta máquina ao avaliar o gate.

## O QUE FAZER AO VOLTAR

1. **Não abrir o braço.** Nem supervisor, nem runtime, nem instalador.
2. Ler `GATE-04-pos-reboot.txt` — a testemunha o escreve ~3 min depois do logon.
   Conferir nele:
   - seção 7: `supervisor.exe` com pai `svchost.exe` (o Agendador), e
     `iara-braco.exe` filho do supervisor;
   - seção 9: distância entre `ultimo boot` e o `criado` do supervisor;
   - seção 10: `dispositivos` ≥ 1 no motor.
3. Só então executar as três ações reais pela interface da IARA (comando de
   shell, `capturar_tela`, `abrir_aplicativo`), provando a cadeia inteira.
4. Depois: logout/login, perda de conexão, morte do runtime.
5. **Não implementar auto-update antes de tudo acima estar PASS.**

## Classificação, se falhar

Nomear o PRIMEIRO ponto que falhou, e só então investigar:
`BOOT · TASK · SUPERVISOR · RUNTIME · AUTH · CONNECT · HANDSHAKE ·
CAPABILITIES · EXECUTOR · HEARTBEAT · EXECUTION`
