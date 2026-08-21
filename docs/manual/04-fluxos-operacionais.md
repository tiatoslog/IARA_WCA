## Fluxos operacionais

### Um turno de conversa

1. O operador fala (texto, voz no navegador, ou mensagem no WhatsApp).
2. A **percepção** extrai âncoras e calcula confiança.
3. Se a confiança passa do limiar, o **planejador determinístico** monta o plano
   sem custo de token. Senão, o plano vem do modelo.
4. O **porteiro de autorização** confere papel, permissões e risco de cada
   passo. Passo barrado não executa, e a recusa é dita — não silenciada.
5. A **função executiva** roda os passos; cada efeito vira linha no jornal de
   operações, nos estados `autorizada`, `executando`, `verificada`.
6. A **enunciação** compõe a resposta a partir do que realmente aconteceu.
7. O **snapshot** é publicado no barramento; a sala acende o que está em uso.

### Ação de risco alto

Nenhuma executa sem confirmação. O ciclo é: a IARA anuncia o que vai fazer e
arma uma pendência; o operador confirma; só então o efeito acontece. A pendência
é vinculada ao par (operador, sessão) e tem validade — pedido antigo não é
confirmado por engano.

> **Débito conhecido (D2):** a pendência vive em memória de processo. Um restart
> a perde. Degrada para o lado seguro — a ação nunca executa — mas o operador não
> é avisado de que o pedido evaporou.

### Isolamento entre operadores

Defesa em três camadas, e a primeira não é o prompt:

1. **Arquitetura** — o caminho do shard é derivado do `id_usuario` da sessão, com
   sanitização contra travessia de caminho.
2. **Roteador** — sondagem cruzada é detectada por teste em duas partes (o alvo é
   outra pessoa do time **e** há verbo de sondagem ou coisa privada) e recusada
   em poucos milissegundos, sem chegar ao modelo.
3. **Prompt** — a cláusula de sigilo é a terceira linha de defesa, nunca a
   primeira.

### Ciclo autônomo

No ócio, regenera energia e paciência. Na janela da madrugada, varre o shard de
cada operador em isolamento e grava um insight relacional no shard privado. Esse
insight abre o turno seguinte daquele operador.

### Canal WhatsApp

Cloud API oficial da Meta. **Não usar Baileys, Venom ou WPPConnect:** violam os
Termos do WhatsApp e o resultado típico é o número da empresa ser banido.

A Meta assina o corpo **bruto** da requisição. Nenhum intermediário pode
reserializar o JSON, ou a assinatura é invalidada e o canal passa a recusar tudo
com um sintoma que não aponta para a causa. Por isso o webhook aponta para o
motor, nunca para o front e nunca via proxy.

Sem `WHATSAPP_APP_SECRET` o canal recusa **tudo**, inclusive requisição legítima.
Canal sem verificação de assinatura é porta aberta, e falha fechada é a única
postura aceitável.
