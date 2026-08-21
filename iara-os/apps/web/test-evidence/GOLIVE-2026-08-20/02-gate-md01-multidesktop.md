# GATE MD-01 — Controle Multi-Desktop Real

**Status:** `NO-GO` · **NÃO CERTIFICADO**
**Data:** 20/08/2026 · **Commit:** `170a641` + árvore de trabalho
**Evidência:** `testes/multi-desktop.test.ts` (MD-A, MD-B, MD-C — os três verdes,
e o que eles fixam é o comportamento ATUAL, não um comportamento desejado)

> Este gate é isolado de propósito, a pedido da operadora. Qualquer falha de
> roteamento, identidade ou execução no computador errado é `NO-GO`
> **independentemente** de a suíte geral ter 2.025 testes verdes — e é
> exatamente o que acontece aqui.

---

## A causa, em uma linha

`servidor/barramento/PonteDispositivos.ts`:

```ts
destinoDe(idUsuario: string): DispositivoConectado | null {
  const lista = this.porOperador.get(idUsuario);
  return lista && lista.length > 0 ? lista[lista.length - 1] : null;
}
```

**O destino é sempre o último que conectou.** Não existe parâmetro de máquina
alvo em lugar nenhum da cadeia: nem em `OrdemExecucao`, nem no esquema das
habilidades, nem na interface. O comentário da própria função declara a premissa
com honestidade — *"quem acabou de conectar é quem está na frente do computador
agora"* — e essa premissa é verdadeira para **uma** máquina de cada vez. Ela
deixa de ser verdadeira no instante em que existem duas ligadas, que é
precisamente o cenário deste gate.

Não é um bug: é uma **capacidade que não foi construída**. O braço foi desenhado
para "o computador do operador", no singular.

---

## As dez perguntas

| # | pergunta | resposta | evidência |
|---|---|---|---|
| 1 | O celular consegue conectar 2+ computadores? | **SIM** | pareamento por credencial durável, `MaquinaDoOperador[]`, botão "Parear novo dispositivo" |
| 2 | Cada computador tem identidade própria? | **SIM** | `id_dispositivo`, `id_credencial`, `nome`, `plataforma`, `versao`, `vista_em` |
| 3 | O celular mostra quais estão online? | **SIM** | painel `Dispositivos`, campo `conectada`, contador de mãos no cabeçalho |
| 4 | O usuário consegue **escolher** um computador? | **NÃO** | MD-B — `destinoDe` recebe só o operador; nenhuma superfície aceita alvo |
| 5 | A IARA executa **exclusivamente** naquele computador? | **NÃO** | não existe "aquele". MD-A: com dois ligados, o último recebe **sempre** |
| 6 | É possível trocar para outro computador? | **NÃO** | só reconectando o desejado por último — é corrida, não escolha |
| 7 | O segundo computador recebe só as ações dele? | **vacuamente sim** | só um recebe qualquer coisa; não há isolamento *por escolha* a testar |
| 8 | Máquina offline não faz a ação migrar em silêncio? | **MIGRA** | MD-C — o alvo cai e a ordem vai para outra máquina ligada, com relato de sucesso e sem uma palavra sobre a troca |
| 9 | Continuam independentes após restart/reconexão? | **não aplicável** | não há vínculo a preservar entre sessão e máquina |
| 10 | Uma pessoa faz tudo isso pelo Chrome, sem código? | **NÃO** | a escolha não existe em superfície nenhuma |

**Placar: 3 SIM · 5 NÃO · 1 vacuamente sim · 1 não aplicável.**

---

## MD-C é o achado grave, e merece nome próprio

```
turno 1 → notebook (último a conectar) abre o Bloco de Notas   ✔ sucesso
notebook fecha a tampa
turno 2 → a MESMA conversa abre a Calculadora no ESCRITÓRIO    ✔ "sucesso"
```

Uma ação **física** aconteceu num computador que ninguém escolheu, e o relato
voltou como sucesso. O contrato `RelatoExecucao` carrega `dispositivo` (o id de
quem executou) e **nada** que marque "isto mudou desde a última vez" — a troca é
indistinguível, no tipo, de ter sido sempre ali.

Há um segundo degrau do mesmo problema, fora do escopo dos dublês mas visível no
código (`Braco.executar`): se nenhum braço estiver conectado e o **motor** tiver
mãos (`temMaos()`), a ação executa **na máquina que hospeda o processo**. Em
produção na nuvem isso é falso e vira recusa honesta (`DESKTOP_OFFLINE`); em
qualquer instalação local do motor em Windows, é verdadeiro.

---

## O que existe e funciona, para não jogar fora o que está de pé

- pareamento por QR e credencial durável, com revogação que derruba socket;
- identidade completa por máquina, incluindo versão e última vez vista;
- recusa honesta `DESKTOP_OFFLINE` quando não há braço **nenhum** — a IARA não
  simula ação em máquina desligada;
- `execucao_id` fim a fim, com prova, jornal e trilha por dispositivo;
- deduplicação de execução em voo por operador.

A fundação está construída. O que falta é a **seleção** — e a recusa quando o
selecionado não está lá.

---

## O que faltaria para MD-01 virar `GO`

1. **Alvo na ordem.** `OrdemExecucao` ganha `id_dispositivo_alvo`.
2. **Transporte respeita o alvo.** `destinoDe(idUsuario, alvo)` devolve a
   máquina pedida ou `null` — **nunca** outra.
3. **Recusa em vez de migração.** Alvo escolhido e offline vira um
   `DESKTOP_OFFLINE` que **nomeia a máquina**, não um sucesso noutra.
4. **Escolha na interface.** O quadro `Dispositivos` já lista as máquinas;
   falta "trabalhar nesta" e o indicador de qual está selecionada.
5. **Persistência da escolha** por sessão, e o que fazer quando a máquina
   escolhida some (perguntar, nunca decidir sozinha).
6. **Isolamento provado**: duas máquinas reais, duas ações diferentes, efeito
   físico conferido em cada uma, e nenhuma ação cruzando.

## Regra de PASS declarada pela operadora, para quando isso existir

```
2 desktops reais + 1 sessão real + Chrome real + seleção real
+ 2 ações diferentes + efeito físico verificável em cada máquina  =  PASS

3 desktops + trocas + offline + reconexão + restart + concorrência = PASS FORTE
```

Nenhuma das duas pode ser executada hoje, e não por falta de máquina: **não há o
que selecionar**.
