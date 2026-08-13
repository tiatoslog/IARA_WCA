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

## O que ainda precisa ser decidido

1. **A leitura vale sozinha?** "Tem chat esperando você no atoshub" já resolve o
   problema real (a operadora está fora e não sabe que um agente parou). Se sim,
   a etapa 2 pode esperar.
2. **Qual o alvo do `-p`?** Um projeto nomeado numa lista curta (como a allowlist
   de aplicativos), ou o `cwd` de uma sessão viva que a própria leitura
   descobriu?
3. **O Cowork tem estado em disco equivalente?** Este documento verificou o
   Claude Code. O Cowork ainda não foi investigado, e afirmar que funciona igual
   seria exatamente o tipo de suposição que este arquivo existe para evitar.
