# MD-05 — dois braços simultâneos · PASS (local)

Navegador real, sessão autenticada, build de produção, dois braços com
**identidades distintas** conectados AO MESMO TEMPO. Nenhum foi desligado
durante o teste.

```
Braco B (auditoria MD-05)  Windows · atendendo agora · v1.3.0
Homeoffice                 Windows · atendendo agora · v1.3.0
contador do cabeçalho: 2
```

## Ida e volta, sem desligar nenhum

| passo | selecionado | quem recebeu | quem NÃO recebeu | jornal |
|---|---|---|---|---|
| 1 | Homeoffice | A — `Alvo A` criada | **B: 0 ordens** | `dispositivo=disp-1` |
| 2 | Braco B | B — `Alvo B` criada | **A: 0 ordens** | `dispositivo=disp-2` |

Contagem por `grep` nos logs de cada braço, e não por inferência: o que não
recebeu marcou **zero**.

Efeito físico conferido no disco: `Alvo A` e `Alvo B` existem.

## Reinício dos dois, em ordem TROCADA

Original: A subiu primeiro. No reinício: **B primeiro, A depois**.

- a escolha (Braco B) **sobreviveu** ao reinício dos dois;
- nenhum herdou a identidade do outro — B voltou como B, A voltou como A;
- ação seguinte com B ainda selecionado: **B executou (`Pos Reinicio`), A: 0**.

O `id_dispositivo` MUDA a cada conexão por desenho (`disp-1` → `disp-4`) — é
o id do socket. A escolha é guardada pelo `id_credencial`, que é estável, e por
isso ela atravessa o reinício. Foi exatamente o defeito corrigido em `MD-09`
que fez essa distinção existir.

## Dois achados de PROCESSO, não de produto

**1. `TaskStop` não mata o neto.** Parar a tarefa de shell deixou o processo
`npx tsx` do braço vivo e conectado. Três órfãos ocuparam as três vagas e
recusaram a reconexão. É defeito do meu harness — anotado para não ser
confundido com defeito do produto numa leitura futura.

**2. `MAX_DISPOSITIVOS = 3` e a janela de reclamação.** O motor recusa o NOVO
em vez de derrubar os estabelecidos, com heartbeat de 30 s reclamando socket
morto — as duas decisões estão documentadas no código, com o porquê. Uma
reconexão imediatamente após três quedas abruptas pega a janela e recebe
*"Limite de 3 computadores conectados atingido"*. A frase é verdadeira e a
recuperação é automática (o braço voltou sozinho no backoff de 30 s).

**Comportamento correto, ressalva de leitura:** a mensagem não diz que é
transitória. Para quem lê, "limite atingido" soa permanente. Não mexi — é
mudança de texto fora do escopo deste commit.

## O que este teste NÃO prova

Os dois braços rodam na MESMA máquina e escrevem no MESMO disco. Isto prova
**roteamento e isolamento de ordens** — a classe de erro que só aparece com dois
ativos. **Não prova isolamento físico entre computadores.** Para isso continua
sendo obrigatório o teste com o Pc Atos ligado, como declarado no gate.
