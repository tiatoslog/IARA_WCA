# Itens em aberto do CC-01 — o que foi fechado

Quarta passagem. As passagens anteriores declararam três lacunas e um defeito de
produto; declarar deixou de ser desculpa.

## 1. Não existia estado de fila no contrato — agora existe

Era a causa-raiz de CT-04 e CT-05 não serem prováveis pela interface, e antes
disso um problema de produto: com a serialização de turnos (CC-01), o pedido de
uma tela pode ESPERAR, e nada dizia isso a quem esperava. A pessoa via a própria
bolha, via a IARA trabalhando, e não sabia se o trabalho era o pedido dela.

- `FILA_ATUALIZADA` publica a fila INTEIRA a cada mudança — estado, nunca delta;
- `SnapshotCognitivo.fila`, projetada pelo compilador;
- cada espelho se reconhece comparando os ids com os `op:` das próprias bolhas;
- a bolha que espera aparece recuada, com "esperando a vez", e o "parar" fica
  disponível para quem espera — o único momento em que desistir cancela algo
  sem que nada tenha acontecido no mundo.

**Provado:** três casos CT-10 em `testes/cross-talk-espelhos.test.ts`, incluindo
o que trava a armadilha sutil — o id publicado na fila é o MESMO que a resposta
vai endereçar. Se mudasse, a tela veria o pedido sair da fila e uma resposta
chegar endereçada a outra coisa: dois pedidos onde só houve um.

**Observado no navegador:** captura de WebSocket com `fila=1` numa corrida de
16 ms. Chega ao cliente. Não de forma reproduzível o bastante para sustentar um
check — ver abaixo.

## 2. "Crie uma pasta chamada Um X" criava a pasta "X" — corrigido

Com âncora de nomeação ("chamada", "chamado", "com o nome", "de nome"), o que vem
depois é o nome, artigo incluído. Sem âncora, a ligação inicial continua sendo
cortada: "pasta de teste" nunca quis dizer uma pasta chamada "de teste". O "de"
da fórmula "chamada DE X" foi absorvido pela própria âncora, e `chamado` — que
antes não era âncora nenhuma e virava parte do nome — entrou junto.

Nove casos novos em `testes/agente-local.test.ts`, cobrindo os dois lados.

Este era o defeito que produziu o falso verde do CT-04: um sistema que renomeia
calado corrompe qualquer verificação que use o nome como âncora.

## 3. A suspeita do botão desabilitado tinha outra explicação

Não era o botão. Nesta máquina os snapshots chegam ao navegador **em rajada**,
medida em vários segundos, num Next em dev com o Canvas 3D e a voz neural
ligados. Enquanto a rajada não chega, a tela mostra o estado velho — daí o botão
parecer desabilitado durante uma janela em que o servidor já dizia "executando".

Medido: linha do tempo de `estagio` por snapshot recebido, no campo `estagios`
de `../CT-05-2026-08-16/interromper-resultado-*.json`.

## O que continua NÃO PROVADO pela interface

CT-04 e CT-05 seguem irreprodutíveis no navegador nesta máquina, e agora se sabe
por quê — a rajada de snapshots, não o relógio nem o botão. As duas invariantes
estão provadas em unidade, onde o turno é segurado por um portão sob controle do
teste. É limitação do ambiente de medição, e o próximo passo de quem quiser
fechar isso é medir a latência de entrega de snapshot antes de tentar de novo.

## Regressão

`npm run verificar`: **1181/1181**, exit 0 (`regressao.log`).

**Ressalva honesta:** esta rodada aconteceu com trabalho não commitado de OUTRA
sessão na mesma árvore (`CadeiaDeRaciocinio.ts`, `MemoriaOperacional.ts` e dois
testes). O verde inclui o que é deles. O que é meu foi medido à parte:
`unidade-tocados.log`, 53/53 nos cinco arquivos tocados.

Durante o caminho a árvore chegou a ficar vermelha por causa daquele trabalho em
voo — um erro de tipo num arquivo não rastreado e duas falhas dependentes de
ordem em `memoria-concorrente.test.ts` (passavam sozinhas, falhavam na suíte).
Não toquei em nada disso, e a outra sessão corrigiu antes deste commit.
