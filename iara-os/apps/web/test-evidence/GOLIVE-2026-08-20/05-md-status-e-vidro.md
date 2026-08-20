# MD-STATUS e o vidro do menu — 20/08/2026

Dois achados da operadora com a tela na frente, os dois do mesmo tipo: a
interface afirmando mais do que sabe.

## 1. O modelo de status estava pobre demais para não mentir

A auditoria nomeou o erro conceitual melhor do que o código:

```
versao == null  →  DESCONHECIDA
e NÃO
versao == null  →  desatualizada=false  →  a tela lê "atual"
```

`pareada`, `conectada`, `selecionada` e `versão conhecida` são QUATRO perguntas,
e a tela respondia as quatro com dois booleanos.

**`lib/execucao.ts` → `lerStatusDaMaquina`** (puro, 8 testes em
`testes/status-da-maquina.test.ts`):

| dimensão | valores | regra |
|---|---|---|
| conexão | `atendendo` · `nao_conectada_aqui` · `nunca_vista` | escopada a ESTE servidor |
| versão | `{conhecida, valor}` · `{desconhecida}` | ausente não é atual nem antiga |
| desatualizada | boolean | **exige** versão conhecida |
| selecionada | boolean | ortogonal a conectada |
| atualizando | número · null | estado próprio |

### O escopo da conexão

`nao_conectada_aqui`, e não `desligada`. O pareamento mora no banco
COMPARTILHADO; a conexão é por SERVIDOR. Um braço ligado ao
`iara.up.railway.app` aparece desconectado numa tela apontada para o localhost —
e "desligado" faz a tela afirmar sobre o COMPUTADOR o que ela só sabe sobre este
processo. A pessoa não distingue: está desligado · o braço caiu · o backend caiu
· está atendendo outra IARA · o heartbeat venceu.

**O que o módulo se RECUSA a inventar:** `connected_to_backend_id`. O
`ultimo_uso_em` é carimbado na APRESENTAÇÃO, não em heartbeat — esta instalação
não tem como saber se a máquina atende outro servidor agora. Afirmar isso
exigiria um dado que ninguém mede, que é o defeito que o módulo existe para
fechar. Dá para escopar a frase sem inventar, e é o que ele faz.

**Fica como pendência declarada:** para responder "está conectado, mas noutro
ambiente" seria preciso heartbeat carimbando `ultimo_uso_em` (e um identificador
do backend) — mudança de contrato que não cabia nesta rodada.

## 2. O vidro do menu não tinha piso

> *"corrija o glass do menu, está impossível de ver"*

`.menu-perfil` tinha `background: var(--c-vidro-alto)` — branco a 5,5% — e
`backdrop-filter`. Sobre a sala escura lê como painel discreto, que era o
desenho. Mas o menu **flutua**: o que passa por baixo é o balão, o hero, um
print colado. Fundo claro atrás → o desfoque clareia o painel → o texto
secundário (`#b3bcc4`) some dentro dele.

Um vidro que herda a cor do que passa por baixo não tem contraste: tem sorte.

**Correção:** piso opaco (`rgba(20,23,26,0.94)`) com o vidro por cima, borda
mais firme, e os itens em tinta CHEIA — cada linha do menu é uma ação, e ação
com contraste de legenda faz clicar no lugar errado.

**Medido no navegador, depois:** contraste **15,87:1** (WCAG AA exige 4,5).
Antes não havia número a medir — dependia do que passasse por baixo.

**Guarda:** `SN-03` em `testes/sinal-nao-mente.test.ts` — todo painel FORA DO
FLUXO com `backdrop-filter` declara cor de base opaca. `.painel-presenca` e
`.painel-conversa` seguem sem piso de propósito: são filhos de layout sobre a
sala, e o `CLAUDE.md` diz que a sala aparecer através deles é a identidade.
A primeira redação da guarda acusava os dois — detector largo demais não
protege, ensina a ignorar.

Controle de mutação: devolvendo `background: var(--c-vidro-alto)` ao menu,
`SN-03` fica vermelho nomeando `.menu-perfil`.

## Regressão

```
tsc --noEmit  exit 0
npm test      2048 testes · 2045 pass · 0 fail · 3 skip
next build    ✓ compilado
```
