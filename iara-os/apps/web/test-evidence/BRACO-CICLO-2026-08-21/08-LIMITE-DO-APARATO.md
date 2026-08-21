# O aparato de medida não alcança `%APPDATA%` — 21/08/2026

**Consequência direta: nenhuma afirmação sobre a instalação em disco feita por
mim nesta sessão vale como prova de campo.** Os testes de unidade valem; a
"instalação real" não.

## O que foi medido

As escritas que as minhas chamadas de ferramenta fazem em `%LOCALAPPDATA%` e
`%APPDATA%` caem numa camada privada do sandbox. O Windows de verdade — e com
ele o Agendador de Tarefas e o logon — enxerga a pasta real, sem elas.

O teste que fecha, com um arquivo de texto trivial (nada específico de binário):

| arquivo escrito pela minha sessão | a tarefa agendada enxerga? |
|---|---|
| `%LOCALAPPDATA%\IARA\braco\marcador-sessao.txt` | **NÃO** |
| `C:\Users\daian\marcador-sessao-fora.txt` | **SIM** |

E o inverso é assimétrico, que é a assinatura de uma sobreposição
*copy-on-write*: o `marcador-tarefa.txt` escrito **pela tarefa** aparece para as
duas visões. Escritas de fora sobem; as minhas ficam na camada de cima.

As duas visões do mesmo caminho, no mesmo instante:

```
minha sessão                          a tarefa agendada
------------------------------        ------------------------------
versoes\1.3.0\iara-braco.exe  85 MB   (ausente)
supervisor.exe                85 MB   (ausente)
atual.json                      96 B  (ausente)
supervisor.json                167 B  supervisor.json   219 B
marcador-tarefa.txt            139 B  marcador-tarefa.txt 139 B
marcador-sessao.txt             26 B  (ausente)
```

Os dois `supervisor.json` de tamanhos diferentes são a mesma coisa vista de dois
lados: a camada de cima esconde o arquivo real de baixo.

`dangerouslyDisableSandbox: true` **não** levanta a redireção — foi tentado, e a
visão continuou a mesma. A camada é da sessão, não da chamada.

## Como isso me enganou por 40 minutos

O caminho errado que percorri, na ordem:

1. `schtasks /create /sc onlogon` → *Acesso negado*. **Isto era real e foi
   corrigido** — ver a tabela de variantes em `instalacao.ts`. O `/xml` funciona.
2. Tarefa registrada com sucesso, disparada → `0x80070002` FILE_NOT_FOUND.
3. `Test-Path` do alvo → `True`. Conclusão que tirei: "o arquivo existe, logo o
   Agendador está errado". **Era o contrário.**
4. Persegui Defender, ASR, Smart App Control, ACLs, reparse points, nome do
   arquivo, tipo de binário. Todos negativos — e todos negativos porque a
   pergunta estava errada.
5. O que virou a chave foi pedir ao **próprio contexto da tarefa** um `dir`, em
   vez de perguntar de dentro da minha sessão. A listagem tinha 1 arquivo onde a
   minha tinha 6.

A lição é a de sempre aqui, e é a terceira vez: **quando a evidência de dentro
contradiz a evidência de fora, o suspeito é o instrumento, não o objeto.**

## O que continua provado, e o que não

**Provado (não depende do disco):**

- `schtasks /create /sc onlogon` é recusado sem elevação; o mesmo gatilho em XML
  é aceito. Seis variantes medidas.
- A tarefa `IARA-Braco` **existe de verdade** no Windows real — registro não é
  sistema de arquivos, e o `Export-ScheduledTask` devolveu o XML com
  `InteractiveToken`, `ExecutionTimeLimit PT0S`, bateria desligada e
  `RestartOnFailure` preservados.
- 60 testes de unidade verdes, incluindo os que nasceram dos dois defeitos reais
  achados hoje (`EBUSY` no reparo, freio do supervisor pulando o 1º degrau).

**NÃO provado — e não afirmo:**

- Que a instalação sobrevive ao reboot.
- Que o supervisor sobe no logon.
- Que o runtime reconecta depois de reiniciar.
- Que `capturar_tela` funciona na sessão gráfica levantada pela tarefa.

## O estado em que a máquina ficou

A tarefa `IARA-Braco` está registrada no Windows real e aponta para
`%LOCALAPPDATA%\IARA\braco\supervisor.exe`, **que não existe no sistema de
arquivos real**. Se a máquina reiniciar agora, a tarefa dispara e falha com
`0x80070002`, em silêncio.

Um duplo clique da operadora em `iara-braco.exe` conserta: ele roda fora do
sandbox, a instalação cai na pasta real, e a mesma tarefa passa a encontrar o
alvo.
