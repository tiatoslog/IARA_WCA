# A IARA olhando o Claude — desenho, antes do código

**Estado: proposta.** Nada disto está implementado. O documento existe para que a
decisão seja tomada antes, e não descoberta depois de pronto.

## O que foi pedido

> "Quero também que ela possa acessar a tela do Claude, verificar se tem chats
> pedindo autorização, ou enviar um comando no Cowork ou no Code."

Duas coisas muito diferentes na mesma frase: **saber** o que está acontecendo, e
**mandar** algo acontecer. Elas têm risco, verificação e desenho separados, e o
resto deste documento as trata como duas habilidades — nunca uma.

## A primeira descoberta: não é preciso ler tela nenhuma

O pedido diz "acessar a tela", e a leitura literal disso seria captura de tela
mais OCR ou modelo de visão. Seria caro, lento, frágil a tema e resolução, e —
o pior — produziria uma AFIRMAÇÃO derivada de pixels, que é a categoria de
evidência mais fraca que este sistema conhece.

O Claude Code guarda estado em disco, na máquina da operadora:

```
~/.claude/sessions/<n>.json          sessões VIVAS: pid, sessionId, cwd, nome,
                                     entrypoint, início
~/.claude/projects/<projeto>/
        <sessionId>.jsonl            o transcrito, um registro JSON por linha
                                     (type: user | assistant | attachment |
                                      last-prompt | ai-title | queue-operation)
```

Verificado na máquina da Daiane em 13/08/2026: dois projetos, sessão viva com
`pid` e `cwd`, transcritos com 109 registros. É leitura de arquivo — determinística,
barata, sem tela, sem visão, e funciona com a janela minimizada.

## O que dá para AFIRMAR, e o que é hipótese

A distinção não é preciosismo: `Verdade.ts` define de onde vem cada afirmação, e
`Investigacao.ts` separa evidência de hipótese. Uma resposta que confunde as duas
é o defeito que este kernel inteiro combate.

| pergunta | como se responde | natureza |
|---|---|---|
| Quais sessões do Claude estão abertas? | `sessions/*.json` + o `pid` ainda existe | **fato** |
| Em que projeto cada uma está? | `cwd` do mesmo arquivo | **fato** |
| Quando cada uma se mexeu pela última vez? | `mtime` do `.jsonl` | **fato** |
| Alguma está **esperando autorização**? | último `assistant` tem `tool_use` sem `tool_result` depois | **hipótese** |

A última linha é a que interessa à pergunta original, e ela é a única que NÃO é
fato. "Ferramenta pedida e sem resultado" também acontece numa sessão que acabou
de morrer, ou que está executando algo demorado. O verbo tem que carregar isso:
*"a sessão do atoshub está parada há 8 minutos com uma ferramenta pendente —
parece esperando você"*, nunca *"tem um chat esperando autorização"*.

Se depois descobrirmos um sinal melhor — um arquivo de estado que diga
explicitamente "aguardando permissão" —, a hipótese vira fato e o verbo muda
junto. O desenho não muda.

## Sigilo: o transcrito não entra no prompt

O `.jsonl` contém o trabalho inteiro da operadora: código, caminhos, conversas,
eventualmente credenciais que alguém colou. **Nada disso pode ser injetado no
contexto da IARA.** É exatamente a regra que o `RagHistorico` já obedece — "o RAG
nunca injeta log bruto, só hash, assinatura sintática de uma linha e a resolução
adotada".

A habilidade lê o transcrito e devolve só a **assinatura**: projeto, instante,
quantos registros, e o veredito de pendência. Nunca o texto. Ler o arquivo para
descobrir SE há pendência é diferente de carregar o que ele diz.

## Duas habilidades, não uma

### 1. `sessoes_claude` — leitura, risco baixo

Ação nova no catálogo fechado do braço, ao lado de `listar_arquivos`. Sem
parâmetro livre: não recebe caminho, não recebe filtro de projeto vindo da LLM.
Lê `~/.claude/` do usuário do sistema e mais nada — a mesma disciplina das raízes
autorizadas, pelo mesmo motivo (`AgenteLocal` recusa caminho porque a allowlist
não pode depender de a LLM ter bom senso).

Verificação: o `pid` está vivo? É o que separa "sessão aberta" de "arquivo que
sobrou".

### 2. `mandar_no_claude` — escrita, risco alto

**Não** por injeção de teclado. Digitar na janela que estiver na frente é o
oposto de um catálogo fechado: o alvo passa a ser "o que tiver foco", que nem o
programa nem a operadora controlam. Um clique no meio do caminho e o comando cai
noutro aplicativo.

O caminho certo é a interface headless (`claude -p "<comando>"` num diretório de
projeto nomeado): alvo explícito, saída capturável, prova possível. Isso NÃO
injeta numa sessão em curso — inicia uma nova. É uma limitação real e ela deve
ser dita ao operador, não disfarçada.

Três travas, e nenhuma é opcional:

- **risco alto** ⇒ pelo `PorteiroAutorizacao`, que exige plano determinístico. A
  invariante já escrita vale aqui inteira: *a LLM nunca autoriza*. Um plano
  emitido pela nuvem não pode disparar isto sozinho.
- **confirmação explícita** da operadora, com o comando e o projeto na frase.
- **jornal**, como todo efeito.

### A razão de fundo para a segunda ser tratada assim

O Claude Code é um agente que já age na máquina com a autoridade da operadora. A
IARA mandando comando nele é autoridade sobre autoridade: um erro dela não vira
um arquivo errado, vira um agente inteiro trabalhando em cima do erro, com
convicção. É a única capacidade proposta até hoje neste produto em que a falha se
AMPLIFICA em vez de parar.

## Fronteira

`AgenteLocal` ganha os métodos de leitura (ele já é `EFEITO_EXTERNO` e já é
alcançado só pelo catálogo, através do portal). A habilidade nova entra em
`habilidades/`, com manifesto, esquema e verificador, como todas as outras.
Nenhuma categoria nova em `Fronteira.ts` — e isso é sinal de que o desenho está
no lugar certo: capacidade nova que exige categoria nova costuma ser capacidade
que não cabia.

## O par que faltava: git, e por que ele vem primeiro

Pedido em 13/08, junto com o comando ao Claude: *"git pull e git push como
habilidade da IARA, assim ela consegue atualizar o repositório"*.

As duas capacidades parecem vizinhas e não são. **Git é a mais fácil e a mais
segura das duas, e deve ser construída primeiro** — não por ser menor, mas porque
ela é o teste do desenho: se o catálogo fechado aguenta um verbo que altera
código, ele aguenta o resto. Se não aguentar, é muito melhor descobrir com um
`git pull` do que com um agente inteiro trabalhando em cima do erro.

### `atualizar_repositorio` — `git pull`, risco médio

Nada aqui é caminho livre. O parâmetro é o **apelido** de um repositório de uma
lista curta e declarada — a mesma disciplina de `LocalAutorizado`, pelo mesmo
motivo: a allowlist não pode depender de a LLM ter bom senso sobre qual pasta
puxar.

Duas travas que o `git` sozinho não dá:

1. **Árvore suja é recusa, não merge.** `git status --porcelain` antes; se houver
   qualquer coisa não commitada, a IARA para e diz o que encontrou. Um `pull` em
   cima de trabalho não salvo é a única forma deste verbo destruir algo, e ela é
   evitável com uma linha.
2. **`--ff-only`.** Sem merge automático, sem rebase. Ou o remoto avança em linha
   reta ou não avança. Um conflito resolvido por uma IA sem ninguém olhando é
   exatamente o que este projeto não faz.

Prova: `git rev-parse HEAD` antes e depois. Se o hash não mudou, ela diz que já
estava atualizado — não diz "atualizei".

### `publicar_repositorio` — `git push`, risco ALTO

Risco alto pelo mesmo critério que `acionar_energia`: **é irreversível para fora
da máquina.** Um commit publicado é visível por todo mundo que tem o repositório;
não existe desfazer que não seja outra publicação.

Consequências obrigatórias, todas já existentes no kernel:

- passa pelo `PorteiroAutorizacao` — e a invariante vale inteira: *a LLM nunca
  autoriza*. Um plano emitido pela nuvem não publica sozinho.
- confirmação explícita da operadora, com o repositório e a branch na frase.
- jornal, como todo efeito.

E uma trava específica deste domínio, que vem do `CLAUDE.md` do repositório-pai:
**nunca `--force`, e nunca `main` a partir do diretório pai.** O pai e o submódulo
são o mesmo repositório do GitHub em branches diferentes, e um force daqui apaga o
produto. Isso não é conselho — é allowlist: o par (repositório, branch de destino)
é declarado, e o que não está declarado não é publicado.

### O que git NÃO deve fazer

`commit` fica de fora desta rodada, e a razão não é técnica. Puxar e publicar são
verbos sobre trabalho que alguém já revisou; *commitar* é a IARA decidindo o que
entra na história. Isso pertence à mesma família do comando ao Claude — capacidade
de autoria — e merece ser decidido depois de a leitura estar de pé, não junto com
o transporte.

## O que ainda precisa ser decidido

1. **Quais repositórios entram na allowlist**, e com qual branch de destino cada
   um pode publicar. Sem essa lista o verbo não existe — não há padrão razoável a
   inventar aqui.
2. **Qual o alvo do `-p`?** Um projeto nomeado numa lista curta (como a allowlist
   de aplicativos), ou o `cwd` de uma sessão viva que a própria leitura
   descobriu?
3. **O Cowork tem estado em disco equivalente?** Este documento verificou o
   Claude Code. O Cowork ainda não foi investigado, e afirmar que funciona igual
   seria exatamente o tipo de suposição que este arquivo existe para evitar.

## Ordem de construção

Uma coisa de cada vez, e nesta ordem, porque cada etapa é o teste da seguinte:

1. **`atualizar_repositorio`** (pull). O verbo mais barato de errar. Prova que o
   catálogo fechado aguenta um alvo que não é um "local nomeado".
2. **`publicar_repositorio`** (push). Primeiro verbo de risco alto irreversível
   para fora. Prova a cadeia porteiro → confirmação → jornal num efeito que sai
   da máquina.
3. **`sessoes_claude`** (leitura). Prova a disciplina de sigilo: ler um arquivo
   para descobrir um fato sem carregar o conteúdo dele para o contexto.
4. **`mandar_no_claude`** (escrita). Só depois das três. É a única capacidade
   deste produto em que o erro se AMPLIFICA em vez de parar.
