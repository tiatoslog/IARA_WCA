# Test plan — CC-01, cross-talk entre espelhos

BASELINE_ID: `CC-01-2026-08-16`
Commit de partida: `6aa2d3f` · branch `main` · suíte 1150/1150 em 49 s.

> Este documento é o CONTRATO DE VERIFICAÇÃO. Não é alterado durante a
> implementação. Lacuna descoberta depois vira linha nova na seção *Lacunas*,
> nunca correção silenciosa de um critério para o teste passar.

## O defeito, como foi observado

Campanha adversarial de 16/08/2026 às 03:00, missão CC-01 — reproduzida idêntica
nas rodadas de 01:04 e 01:20, determinística, não intermitente. (A evidência
daquela campanha foi produzida por outra sessão e mora em
`test-evidence/CAMPANHA-2026-08-16-0300/`; pode ainda não estar commitada. A
evidência DESTE trabalho é independente dela e está em
`test-evidence/CC-01-2026-08-16/`.)

```
espelho A → "Crie uma pasta chamada Alfa 0300v1 na área de trabalho"
espelho B → "Crie uma pasta chamada Beta 0300v1 nos Documentos"

disco:  Alfa NÃO existe · Beta existe
tela A: "Pronto, criei a pasta «Beta 0300v1» em Documentos."
```

A tela que perdeu a corrida recebeu a confirmação do pedido da outra.

## Causa apontada

Um `Kernel` por operador, N sessões de transporte (`Porta.ts` — até
`MAX_ESPELHOS` telas). Duas costuras se somam:

1. `Kernel.processar` abre com `this.cancelar('nova mensagem do operador')`.
   A trava não distingue "a MESMA tela mandou de novo" de "OUTRA tela mandou".
   No segundo caso o turno alheio morre calado: o operador não é avisado, e
   o efeito que ele pediu não acontece.
2. `FalaProjetada` não carrega o id da pergunta que a originou. O snapshot é
   difundido para todos os espelhos, e cada tela cola a fala corrente no fim
   da própria lista — não existe no contrato nada que permita a uma tela dizer
   "esta resposta não é da minha pergunta".

## Invariantes que passam a valer

**I-1 — Nenhum pedido do operador morre calado.** Mensagem vinda de OUTRO
espelho não cancela o turno em curso. Ela espera a vez. Preempção continua
existindo para a MESMA origem (a pessoa reescreveu na mesma tela) e para o
`interromper` explícito.

**I-2 — Toda fala é endereçada.** `FalaProjetada.responde_a` carrega o id da
pergunta que a originou. Um espelho nunca apresenta como resposta ao próprio
balão pendente uma fala que responde a outra pergunta.

**I-3 — Espera é estado declarado, não silêncio.** Pedido enfileirado aparece
na tela como enfileirado. Fila cheia é recusa explícita, nunca descarte mudo.

## Bateria

Ambiente de todos os casos de UI: instância dev isolada na porta **3077**,
`USERPROFILE`/`HOME` redirecionados para uma raiz descartável (o oráculo de
disco observa essa raiz, e nada é escrito na máquina da operadora),
`NEXT_PUBLIC_IARA_MODO_LOCAL=1` e Supabase desligado — a identidade vem do
seletor local. Navegador real (Chromium), duas abas = dois espelhos do MESMO
operador.

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | CT-01 | concorrência | duas abas conectadas, sessão ociosa | A envia "Crie uma pasta chamada Alfa … na área de trabalho"; B envia "Crie uma pasta chamada Beta … nos Documentos" ~150 ms depois | nenhuma tela exibe, como última fala da IARA, a confirmação de um pedido que ela não fez sem que a pergunta correspondente esteja visível acima | screenshot das duas abas + DOM da lista de falas + trace | a tela mente sobre o que foi feito |
| [ ] | CT-02 | concorrência | idem CT-01 | ler a lista de falas da aba A | a pergunta de A continua na tela de A | DOM + screenshot | a mensagem do operador some da própria tela |
| [ ] | CT-03 | efeito real | idem CT-01 | após as duas respostas, conferir o disco | **as duas** pastas existem sob a raiz observada | listagem de diretório (oráculo externo ao processo) | pedido morre calado |
| [ ] | CT-04 | preempção legítima | uma aba conectada | A envia P1 e, antes da resposta, envia P2 na MESMA aba | o turno de P1 é cancelado; a IARA responde P2 | DOM + log do barramento | a correção destrói a interrupção legítima |
| [ ] | CT-05 | interromper | turno em curso na aba A | clicar em interromper na aba A | o turno de A para; a aba B não é afetada | screenshot das duas abas | interromper vira global |
| [ ] | CT-06 | limite | fila no teto | disparar mais pedidos concorrentes que o teto da fila | recusa explícita e legível; nenhuma confirmação de efeito não ocorrido | screenshot + DOM | descarte mudo sob pressão |
| [ ] | CT-07 | contrato | — | inspecionar o snapshot recebido no navegador | toda `fala` traz `responde_a` com o id de uma pergunta conhecida da sessão | JSON do snapshot capturado no cliente | I-2 vira comentário sem trava |
| [ ] | CT-08 | regressão | — | `npm test` e `tsc --noEmit` | 1150 testes anteriores continuam verdes; zero erro de tipo | saída bruta dos dois comandos | correção quebra o núcleo |
| [ ] | CT-09 | regressão | — | teste de unidade novo do CC-01 | reprodução automatizada do cross-talk falha antes da correção e passa depois | saída bruta do teste | bug volta sem ninguém notar |

## Fluxos não óbvios cobertos

- **Recarregar (F5) no meio do turno** — coberto por CT-05 na variante de
  fechamento de socket: o turno do espelho que saiu não pode derrubar o do que
  ficou.
- **Envio repetido / duplo Enter** — CT-04. É o caso legítimo de preempção e
  precisa continuar funcionando exatamente como antes.
- **Perda de conexão de um espelho** — o teto de espelhos e o heartbeat já são
  cobertos pela suíte existente; aqui só se exige que a fila não segure vaga de
  uma sessão morta.

## Lacunas declaradas (não cobertas por esta bateria)

- Camada de raciocínio (LLM) fica **fora** do caminho destes casos: "criar
  pasta" é rota determinística. Concorrência com turno de raciocínio aberto
  (~260 s por chamada nesta máquina) não é medida aqui — fica registrada como
  risco residual.
- Cross-talk entre canais diferentes (navegador × WhatsApp) compartilha o mesmo
  `Kernel` e deve herdar a correção, mas não é exercitado por esta bateria.

## Lacunas descobertas DURANTE a implementação

Registradas aqui, e não corrigindo as linhas acima — o plano é contrato, e
afrouxar um critério para o teste passar é a doença que ele existe para evitar.

1. **CT-05 não foi exercitado.** O botão de interromper com dois espelhos vivos
   ficou de fora da bateria de navegador e não tem cobertura de unidade nova. O
   `interromper` continua chamando `Kernel.cancelar()`, que é global à sessão:
   **uma tela ainda interrompe o turno da outra.** É a mesma família do CC-01,
   não foi consertada aqui, e está registrada como risco residual aberto.
2. **CT-04 e CT-06 foram provados por unidade, não pela tela.**
   `testes/cross-talk-espelhos.test.ts` cobre preempção da mesma tela e recusa
   por fila cheia atravessando o Kernel real com um portão sob controle do
   teste. Pela interface, não.
3. **I-3 saiu pela metade.** Fila cheia é recusa explícita (feito). Mas pedido
   que ENTRA na fila não ganha indicador próprio: a pessoa vê a própria bolha
   (eco local imediato) e o estágio da sessão em trabalho, o que não é silêncio
   mas também não é "você é o segundo da fila".
4. **Duas abas do mesmo Chromium não conseguem correr.** Medido: o renderizador
   da aba de trás é suspenso e os dois envios saíam com ~1,2 s de distância em
   cinco rodadas seguidas. A bateria passou a usar UM NAVEGADOR POR ESPELHO, o
   que também é mais fiel ao caso real (computador + celular). Sem isso, a
   bateria dava PASS sem ter medido concorrência — daí o portão CT-00.
5. **A fase "antes" roda contra código commitado**, via `--referencia <commit>`,
   sem tocar a árvore de trabalho. Foi como o par antes/depois ficou comparável
   com o mesmo harness.

## Regra de bloqueio

BLOCK se qualquer um de CT-01, CT-03, CT-08 ou CT-09 falhar, ou se algum PASS
chegar sem a evidência que a linha exige.
