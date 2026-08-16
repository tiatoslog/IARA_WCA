# CC-01 — cross-talk entre espelhos · relatório de evidência

BASELINE_ID `CC-01-2026-08-16` · commit de partida `6aa2d3f` · branch `main`
Plano de verificação: `docs/prd/test-plan-cross-talk-espelhos.md`

## O defeito

Uma sessão tem UM `Kernel` e até quatro telas. `Kernel.processar` abria
cancelando o turno anterior sem perguntar de qual tela vinha a mensagem nova, e
a fala do turno vencedor ia para a sessão inteira sem dizer a que pergunta
respondia.

Medido no navegador, dois Chromium reais, 92 ms entre os dois envios, contra o
código commitado em `6aa2d3f`:

```
espelho A → "Crie uma pasta chamada Alfa ref3r1 na área de trabalho"
espelho B → "Crie uma pasta chamada Beta ref3r1 nos Documentos"
```

O que ficou escrito na tela A (`espelho-A-antes.png`):

```
[operador] Crie uma pasta chamada Alfa ref3r1 na área de trabalho
[operador] Crie uma pasta chamada Beta ref3r1 nos Documentos
[iara]     Pronto, criei a pasta "Beta ref3r1" em Documentos.
```

O que o disco dizia, conferido por fora do processo que executou:

```
Desktop/Alfa ref3r1     EXISTE
Documents/Beta ref3r1   EXISTE
```

**As duas pastas foram criadas e uma delas nunca foi mencionada.** O efeito de A
aconteceu; foi a RESPOSTA dele que morreu. Quem estava na tela A leu a
confirmação do pedido alheio como se fosse a resposta do seu.

Isto é mais preciso que o diagnóstico da campanha de 16/08 às 03:00, que pegou a
variante em que o turno morria ANTES de executar (`Alfa` ausente do disco). Mesma
causa, dois desfechos, e o segundo é o pior: o mundo mudou e ninguém foi
informado.

## A correção

Duas costuras, em `servidor/nucleo/kernel/Kernel.ts` e no contrato do snapshot:

1. **Preempção passa a distinguir de onde veio a mensagem.** Mesma tela →
   cancela (a pessoa se corrigiu). Outra tela → **espera a vez**, numa fila de
   no máximo uma vaga por espelho. Fila cheia é recusa explícita, nunca descarte
   mudo. `SessaoOperador` ganhou um `id`, e `Porta.ts` o repassa como origem.
2. **Toda fala declara a qual pergunta responde** — `responde_a` em
   `RESPOSTA_TRECHO`/`TAREFA_CONCLUIDA`, projetado em `FalaProjetada`. O cliente
   usa esse id para colocar a resposta JUNTO da pergunta, em vez de encostá-la no
   fim da lista. `null` é o valor honesto para recado espontâneo (lembrete,
   vigia), que não responde a ninguém.

## Depois, mesma bateria, 26 ms entre os envios

Tela A (`espelho-A-depois.png`):

```
[operador] Crie uma pasta chamada Alfa fixr1 na área de trabalho
[iara]     Pronto, criei a pasta "Alfa fixr1" na Área de Trabalho.
[operador] Crie uma pasta chamada Beta fixr1 nos Documentos
[iara]     Pronto, criei a pasta "Beta fixr1" em Documentos.
```

Tela B mostra o mesmo par, com o pedido dela em cima.

## Resultado dos checks

| ID | antes (`6aa2d3f`) | depois | o que mede |
|---|---|---|---|
| CT-00 | PASS (92 ms) | PASS (26 ms) | **portão**: a corrida realmente aconteceu |
| CT-01 | **FAIL** | PASS | nenhuma tela exibe confirmação alheia como resposta sua |
| CT-02 | PASS | PASS | a pergunta não some da própria tela |
| CT-03 | PASS | PASS | as duas pastas existem no disco |
| CT-07 | **FAIL** (0 de 12 endereçadas) | PASS (18 de 18) | toda fala declara a pergunta que responde |

CT-00 é o check mais importante deste arquivo e não estava no plano original: a
primeira execução da bateria deu PASS em tudo **sem ter medido concorrência
nenhuma** — 120 ms de defasagem bastaram para o turno de A fechar sozinho. Um
verde desses afirma o que não testou. Agora, sem corrida observada dentro de
300 ms, o veredito é INCONCLUSIVO.

## Regressão

- `npm run verificar` (GLSL + varredura de segredos + `tsc --noEmit` + suíte)
  — ver `regressao-depois.log`.
- Suíte antes da alteração: **1150/1150** em 49 s (`BASELINE.txt`).
- `testes/cross-talk-espelhos.test.ts` — 5 casos novos, reprodução automatizada
  do CC-01 atravessando o Kernel real, com um portão sob controle do teste.

## Evidência bruta

| arquivo | o que é |
|---|---|
| `espelho-{A,B}-{antes,depois}.png` | as telas, inteiras |
| `resultado-{antes,depois}.json` | conversa lida do DOM, oráculo de disco, rodadas, checks |
| `snapshots-{antes,depois}.json` | todo snapshot que chegou a cada espelho pelo WebSocket |
| `console-{antes,depois}.log` | console do navegador dos dois espelhos |
| `motor-{antes,depois}.log` | stdout/stderr da instância |
| `BASELINE.txt` | commit, árvore, versões, memória livre |

## Como repetir

```bash
node testes/navegador/executar.mjs --porta 3077 --fase depois --marca x
node testes/navegador/executar.mjs --porta 3077 --fase antes --marca y --referencia 6aa2d3f
```

Instância descartável: porta própria, `USERPROFILE` numa raiz temporária (as
pastas são criadas de verdade, e nunca na máquina da operadora), espelho do app
com `.env.local` próprio, sem Supabase e sem chave de raciocínio.

## Risco residual — o que NÃO foi provado

1. **`interromper` continua global à sessão.** Uma tela ainda cancela o turno da
   outra. Mesma família do CC-01, fora do escopo desta correção, **aberto**.
2. **Concorrência com turno de raciocínio aberto não foi medida.** "Criar pasta"
   é rota determinística. Uma chamada ao provedor local leva ~260 s nesta
   máquina; a fila serializa, então o segundo espelho espera esse tempo — é
   honesto, e pode ser ruim de usar. Não medido.
3. **Cross-talk entre canais** (navegador × WhatsApp) herda a correção por
   construção — os dois compartilham o mesmo `Kernel` e o WhatsApp entra como
   origem sem tela —, mas não foi exercitado.
4. **CT-04, CT-05 e CT-06 não passaram pela tela** (ver as lacunas declaradas no
   test-plan).
