# CT-05 — "parar" também era global à sessão · relatório de garantia

Segunda passagem sobre o CC-01, feita pelo processo de garantia depois da
entrega de `5cd03c5`. O que motivou: o próprio relatório anterior declarava
`interromper` como risco residual aberto. Risco residual declarado não é o mesmo
que risco residual aceito — a auditoria executou a linha em vez de aceitá-la.

## Fase 3 — impact graph

| símbolo | natureza | quem chama | superfície |
|---|---|---|---|
| `Kernel.interromper(origem)` | novo | `Porta.ts`, pacote `interromper` do WebSocket | botão "parar" da conversa |
| `Kernel.pararTudo(motivo)` | novo | `Porta.ts` no `close` da última tela e em `encerrarResidentes` | fim de sessão e desligamento do processo |
| `Kernel.cancelar(motivo)` | inalterado | `Kernel.processar` (preempção da mesma tela) | continua sendo a porta global |

**Risco: HIGH.** É o caminho que decide se o trabalho para. Errar aqui produz um
de dois defeitos, e os dois são graves: "parar" que não para, ou "parar" que
para demais — que era exatamente o defeito.

Bateria selecionada: concorrência (unidade), navegador (CT-04), regressão
completa. Segurança e banco não foram tocados; nenhum teste desses foi rodado
por isso.

## O defeito

`Porta.ts` atendia o botão "parar" chamando `Kernel.cancelar()`, que é global à
sessão. Uma sessão tem até quatro telas. Quem apertasse "parar" no computador
derrubava o turno que a mesma pessoa tinha acabado de pedir pelo celular.

Vermelho registrado em `unidade-antes.log`: três casos falhando, todos por
`kernel.interromper is not a function` — a distinção não existia.

## A correção

`Kernel.interromper(origem)` — três casos, e só o primeiro cancela algo:

- o turno em voo é DESTA tela → cancela;
- o pedido desta tela está NA FILA → sai da fila (desistiu antes da vez);
- esta tela não tem nada em curso → não faz nada.

## O defeito que a auditoria descobriu no caminho

Com a fila, "a última tela fechou" cancelava o turno em voo e **deixava os
pedidos enfileirados valendo**. Eles executariam contra uma sessão sem ninguém
olhando. Não existia antes da fila — nasceu com ela, na entrega anterior.

Daí `pararTudo`, que é o único caminho que esvazia a fila. `cancelar()` não pode
esvaziá-la porque ele TAMBÉM é a preempção da mesma tela: se esvaziasse, quem
reescrevesse a própria frase apagaria o pedido das outras telas junto — o CC-01
de volta por outra porta. Os dois lados têm teste.

## Resultado

> **Este quadro foi corrigido depois da auditoria independente.** A versão
> anterior dizia "CT-04 PROVADO pela tela" — era falso, e o porquê está em
> `AUDITORIA-INDEPENDENTE.md`. A linha errada fica registrada lá, não apagada.

| linha | resultado | evidência |
|---|---|---|
| CT-04 (submit repetido) | **PROVADO no kernel · NÃO REPRODUZÍVEL pela tela** | 1 observação, depois 12 tentativas sem preempção |
| CT-05 (parar entre espelhos) | **PROVADO no kernel** | `unidade-antes.log` → `unidade-depois.log` |
| CT-05 pela interface | **NÃO EXECUTADO** | ver abaixo |
| CT-06 (fila cheia) | **PROVADO por unidade; inalcançável pela interface** | ver abaixo |
| CT-09 (vermelho antes) | **PROVADO** | 13 de 14 casos falham contra `6aa2d3f` |
| regressão | `npm run verificar` exit 0 | `regressao-depois.log` |

### Por que CT-05 não foi executado pela interface

Não é que o botão não fique clicável — essa foi a minha primeira explicação e a
auditoria a refutou com os próprios logs: o clique aconteceu em várias rodadas
(+2108 ms, +3602 ms). O motivo real é que **assim que o turno de A fecha, o
pedido da fila entra em milissegundos**, e o snapshot não distingue "trabalhando
no pedido de A" de "trabalhando no pedido de B". Quem está na tela B não tem
como saber se ainda dá tempo de desistir — e o teste, pelos mesmos olhos que a
pessoa tem, também não.

É consequência direta da lacuna nº 3 do test-plan: não existe estado de fila no
contrato. Enquanto não existir, "desistir antes da vez" é uma ação que a
interface oferece sem dizer se ainda vale.

**Suspeita registrada, não diagnosticada:** em algumas rodadas a tela recebeu
snapshot com `estagio: 'executando'` e o botão continuou desabilitado por boa
parte da janela. Observado nas linhas do tempo (campo `estagios` dos
`interromper-resultado-*.json`), não explicado. É anterior a esta correção.

### Por que CT-06 é inalcançável pela interface

`MAX_ESPELHOS` = 4 e `TETO_DA_FILA` = 4. Com uma tela em voo sobram três
espelhos para enfileirar, mais uma vaga para a origem sem tela (WhatsApp, ciclo
autônomo): exatamente quatro. Não existe uma quinta origem possível na topologia
de hoje. O ramo da recusa por fila cheia é rede de segurança, provada só por
unidade — e está dito aqui em vez de virar um PASS que ninguém alcançou.

## Risco residual

1. **"Parar" pela interface continua sem prova de ponta a ponta**, e a razão é a
   janela de ~2 s. Vale como pergunta de produto antes de virar tarefa de teste:
   um botão que só existe por 2 s serve para quê?
2. **A suspeita do botão desabilitado com `estagio: 'executando'`** segue aberta.
3. **Concorrência com turno de raciocínio aberto** continua não medida — é o
   único cenário em que a janela do "parar" seria larga, e é justamente o que
   esta instância não tem como exercitar (sem chave de provedor).
