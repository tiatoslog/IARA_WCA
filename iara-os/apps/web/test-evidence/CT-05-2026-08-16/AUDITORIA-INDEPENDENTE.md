# Auditoria independente — o que ela derrubou

Um agente que não implementou nada e não podia editar código executou o
test-plan, revalidou a evidência e voltou com **BLOQUEIA**. Este arquivo é o
registro do que ele achou e do que foi feito. Nada aqui foi apagado depois de
corrigido — a falha anterior fica.

## O falso verde

**CT-04 estava marcado PASS e não tinha acontecido.**

O portão contava quantas falas da IARA continham o nome da primeira pasta. O
nome era `Um k5c4r1`. `extrairNomePasta` (`Planejador.ts`) corta ligação inicial
com `LIGACAO_INICIAL`, e "um" está na lista — a IARA criou a pasta `k5c4r1` e
respondeu `Pronto, criei a pasta "k5c4r1"`. O `contém "Um k5c4r1"` deu zero, e o
portão leu zero como "o primeiro turno foi preemptado".

Os dois turnos tinham rodado até o fim. Três fontes independentes dizem isso, e
todas já estavam na minha própria pasta de evidência:

| fonte | o que mostra |
|---|---|
| `resultado-depois.json`, `conversa.A` | duas perguntas, **duas** respostas |
| `motor-depois.log` | `casa\Desktop\k5c4r1` às 11:53:47 e `casa\Documents\Dois k5c4r1` às 11:53:53 |
| a rodada do próprio auditor | idem, e o CT-04 ainda assim deu PASS |

Eu tinha promovido isso a fato no test-plan ("CT-04 provado pela tela") e dito o
mesmo ao operador. Era falso. Retirado.

**Conserto:** o portão agora conta PERGUNTAS E RESPOSTAS — duas perguntas, uma
resposta. Amarrar a prova ao texto que a IARA escolhe é deixar a coisa medida
decidir a medida.

**Resultado com o portão honesto:** observado uma vez, e **não reproduzido em 12
tentativas seguidas**. CT-04 pela tela fica NÃO REPRODUZÍVEL. A preempção da
mesma tela continua provada por unidade, onde o turno é segurado por um portão
sob controle do teste.

## As duas outras razões do bloqueio

**CT-09 sem o vermelho da metade CC-01.** A linha exige a saída bruta do teste
falhando antes da correção; só existia a do CT-05. Produzida agora com
`testes/navegador/unidade-contra-commit.mjs`, que roda o arquivo de teste de
hoje contra o código de outro commit sem tocar a árvore de trabalho:
**13 dos 14 casos falham contra `6aa2d3f`**, e o único que passa é o do
cancelamento global — comportamento que sempre existiu. Bruto em
`../CC-01-2026-08-16/unidade-antes-contra-6aa2d3f.log`.

**Requisito do plano não implementado.** "A fila não segure vaga de uma sessão
morta" — e não segurava mesmo: o `close` de uma tela que não era a última não
devolvia a vaga dela. Num laço de reconexão, cada volta é um espelho novo, e
vagas órfãs acabariam recusando o pedido de uma tela viva. Agora
`Kernel.esquecerEspelho` devolve a vaga sem tocar no turno em voo, com teste
para os dois lados.

## Defeitos que a auditoria encontrou por fora do bloqueio

1. **Desistir na fila era mudo.** O `splice` saía sem publicar nada: a bolha
   ficava na tela sem resposta e sem aviso — a mesma família do CC-01. Agora
   publica `TAREFA_CANCELADA` com o motivo.
2. **Turno sem tela ficou órfão de quem o parasse.** Com o `interromper` casando
   por origem, nenhuma tela conseguia mais parar um turno vindo do WhatsApp ou
   do ciclo autônomo. Regressão introduzida por mim e não percebida.
   `ORIGEM_SEM_TELA` passou a ser interrompível por qualquer tela do operador.
3. **A bateria do CC-01 dizia "INCONCLUSIVO" e calculava FAIL.** A palavra
   existia só no texto do detalhe; o artefato só tinha dois estados. Errava para
   o lado seguro — nunca deu PASS sem corrida —, mas eu afirmei, no commit e no
   relatório, um estado que o código não tinha. As duas baterias agora têm três
   desfechos de verdade, com código de saída próprio.
4. **A infra de evidência apagava evidência.** As duas baterias escreviam
   `resultado-<fase>.json` no mesmo diretório; a segunda sobrescrevia a primeira
   em silêncio. Aconteceu com o auditor, e aconteceu comigo depois. Nomes agora
   levam o prefixo da bateria.
5. **Duas réguas para a mesma medida.** Os oráculos de disco das duas baterias
   procuravam em listas diferentes de raízes. Unificados.

## Correção de diagnóstico

O auditor refutou uma explicação minha, e ele tem razão. Eu disse que o CT-05
não foi executado porque "o botão parar não fica clicável a tempo". O clique
**aconteceu** em várias rodadas (+2108 ms, +3602 ms). O motivo real é outro:
assim que o turno de A fecha, o pedido da fila entra em milissegundos, e o
snapshot não distingue "trabalhando no pedido de A" de "trabalhando no pedido de
B". Quem está na tela B não tem como saber se ainda dá tempo de desistir — e o
teste também não. É consequência direta da lacuna nº 3 do test-plan: não existe
estado de fila no contrato.

## Não corrigido, e por isso registrado

"Crie uma pasta chamada **Um** X" cria a pasta "X". `LIGACAO_INICIAL` corta o
artigo mesmo quando o nome veio depois de "chamada". É anterior a este trabalho,
é voltado ao usuário — a IARA renomeia calada o que a operadora nomeou — e foi
exatamente o que produziu o falso verde. Um sistema que renomeia em silêncio
corrompe qualquer verificação que use o nome como âncora. Fica como tarefa à
parte.
