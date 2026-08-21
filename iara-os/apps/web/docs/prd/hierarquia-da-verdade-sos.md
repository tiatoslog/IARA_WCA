# Hierarquia da verdade no SOS — documento normativo

Princípio, ditado pela operadora em 18/08/2026:

> **A IARA pode ser inteligente na interpretação, mas conservadora na verdade
> operacional.** Ela pode adaptar a forma de explicar; não pode adaptar o
> procedimento oficial por conta própria.
>
> **Ser útil não significa preencher lacunas.** Quando o conhecimento oficial
> não for suficiente, a IARA reconhece a lacuna em vez de inventar resposta.

Isto não é preferência de tom. Quanto mais poder de execução a IARA ganha
(agentes, braços, sistemas corporativos), menor a tolerância a alucinação — e o
SOS é a primeira camada em que uma resposta errada faz alguém **agir errado no
GW**, não só ler algo errado.

---

## A decisão de projeto mais importante deste documento

A hierarquia pedida tem cinco níveis:

```
1. Procedimento oficial vigente
2. Regra corporativa validada
3. Conhecimento operacional aprovado
4. Evidência / histórico
5. Sugestão da IA
```

**Ela NÃO vira uma escala nova.** O `CLAUDE.md` registra que "uma segunda escala
de confiança ao lado da existente é a doença que já custou caro aqui duas vezes",
e um `nivel_de_verdade: 1..5` ao lado de `Procedencia` seria exatamente isso: dois
números discordando sobre a mesma frase, sem ninguém saber qual manda.

A hierarquia se decompõe em **dois eixos que já existem ou que faltam por
inteiro** — nunca num terceiro número:

| Eixo | Pergunta que responde | Onde vive |
|---|---|---|
| **Procedência** | *quão sustentada é esta afirmação?* | `kernel/Verdade.ts` — **já existe**, 8 níveis |
| **Estado do conhecimento** | *esta fonte está autorizada a orientar?* | `lib/procedimento.ts` — **novo** |

Um POP é `procedencia: 'documento'` — definido em `Verdade.ts` como *"documento
interno: verdadeiro na data em que foi escrito"*. Duas consequências caem de
graça, sem código novo:

- `podeAfirmarSemRessalva('documento')` é **`false`**. Toda orientação vinda de
  POP já sai marcada com `RESSALVA.documento` = *"conforme o documento
  interno"*. A proibição ❌7 (nunca esconder incerteza) já é máquina.
- *"verdadeiro na data em que foi escrito"* é o problema #12 e #13 em uma frase.
  Os 11 POPs **não têm data**. A IARA não pode saber se ainda é verdade — e vai
  dizer isso, em vez de carimbar "🟢 Vigente".

O que a hierarquia acrescenta é **precedência de autoridade**, e ela é resolvida
pelo estado, não por confiança:

| Nível pedido | Procedência | Estado |
|---|---|---|
| 1. Procedimento oficial vigente | `documento` | `oficial` |
| 2. Regra corporativa validada | `fato` (base determinística: `camada-global.md`) | — |
| 3. Conhecimento operacional aprovado | `documento` | `oficial`, origem não-POP |
| 4. Evidência / histórico | `memoria`, `resultado_ferramenta` | — |
| 5. Sugestão da IA | `inferencia`, `hipotese` | `sugestao` |

**A regra "nunca transformar nível 5 em nível 1" vira uma trava verificável:**
`EstadoConhecimento` nunca é escrito pela IARA. Só por pessoa com papel
`supervisor` ou `administrador`. Não há caminho de código em que uma resposta do
modelo promova a si mesma a `oficial`.

---

## Estado do conhecimento

```ts
export type EstadoConhecimento =
  /** Pode orientar. É a única resposta a uma pergunta operacional. */
  | 'oficial'
  /** Existe, mudou, e ninguém validou ainda. Visível a quem pode revisar,
   *  SEMPRE com aviso. Nunca orienta operação. */
  | 'em_revisao'
  /** Veio de alguém ou da própria IARA e não passou por validação.
   *  NUNCA é tratado como procedimento. */
  | 'sugestao'
  /** Aposentado. Não orienta como vigente — mas continua existindo, porque
   *  apagar versão é apagar a chance de explicar por que mudou (❌4). */
  | 'desativado';
```

Só `oficial` orienta. `em_revisao` aparece com aviso para quem pode revisar.
`sugestao` e `desativado` nunca respondem a "como faço isso".

---

## O que DEVE acontecer

| # | Exigência | Onde é cumprida | Estado |
|---|---|---|---|
| 1 | POP → conhecimento estruturado | `lib/procedimento.ts` + `scripts/geracao/ingerir-pops.ts` | H1.3 |
| 2 | Preservar a fonte (POP, versão, etapa, imagem, validação, aprovador) | campo `fonte` em `FalaProjetada.passo` | H1.7 — **ver ressalva abaixo** |
| 3 | Consultar → Guiar → Treinar → Resolver | 4 habilidades + `ProcedimentosEmCurso` | H1.4/H1.5; Resolver no H3 |
| 4 | Entender linguagem natural | `DescobertaCapacidades` (léxico) + âncoras | **já existe** |
| 5 | Reconhecer a etapa atual e permitir continuar | `ProcedimentosEmCurso`, persistido | H1.4 |
| 6 | Mostrar a imagem daquela etapa, não o PDF inteiro | `FalaProjetada.passo.captura` | H1.7 |
| 7 | Identificar exceções | campo `particularidades` — os POPs **têm** isso (001 slide 6: "PARTICULARIDADES") | H1.3 |
| 8 | Detectar falta de conhecimento e registrar | `LacunasCapacidade` | **já existe**, falta consumidor (H1.6) |
| 9 | Detectar POP desatualizado | diff por `hash_origem` | H3 — **bloqueado**, ver abaixo |
| 10 | Aprender padrões de dificuldade | agregado por etapa, nunca nominal | H3 |
| 11 | Diferenciar treinamento de operação | parâmetro `modo` (`dentre`) | H1.5 |
| 12 | Controle de permissões | `Seguranca.ts` + `Papeis.ts` | 3 papéis existem; falta `supervisor` (H2.4) |

**Ressalva honesta sobre o item 2.** "Quando foi validada" e "quem aprovou" estão
**vazios nos 11 arquivos** — `Data`, `Elaborado por`, `Analisado por` e
`Aprovado por` em branco em 100% deles. A citação vai sair assim:

> `IT-ADMLUFT-007 · etapa 4 · slide 8 · REV.:02 · aprovador não informado no documento`

Dizer "não informado" é o cumprimento do item 2, não a falha dele. Preencher com
"Operações" seria inventar um aprovador — pior que o campo vazio, porque um
aprovador falso é exatamente o que faz alguém confiar sem conferir.

**Por que o item 9 está bloqueado.** O diff entre versões é implementável hoje
(`hash_origem` detecta o arquivo mudado). O que não existe é o que responder
depois: sem `Data` e sem `Aprovado por`, "🟢 Vigente" seria um carimbo sem lastro.
O item destrava quando a operação passar a preencher esses campos no template.

---

## O que NÃO DEVE acontecer

Cada proibição vira teste. Comentário não segura nenhuma delas.

| # | Proibição | Como é impedida |
|---|---|---|
| ❌1 | inventar procedimento | sem achado acima do limiar ⇒ `resolveu: false` + lacuna registrada. Nunca completar com conhecimento geral |
| ❌2 | apresentar hipótese como regra | `RESSALVA[procedencia]` já marca; `criarHipotese` calcula confiança e ninguém a digita |
| ❌3 | alterar POP automaticamente | nenhum caminho de código escreve em `arquivos/procedimentos/`. Ingestão é `npm run pops` + `git diff` revisado por gente |
| ❌4 | apagar conhecimento sem versionar | `dados/procedimentos/<codigo>/<hash>.json` — versão nova **acrescenta**; a antiga vira `desativado`, nunca some |
| ❌5 | **misturar sistemas** | `sistema` é filtro **duro, aplicado ANTES da similaridade** — nunca um desempate depois. Ver nota abaixo |
| ❌6 | executar ação crítica só por entender a intenção | `PorteiroAutorizacao` → `Autonomia` → `PortalEfeitos` → verificador. Nenhum passo de POP executa por dentro de uma habilidade |
| ❌7 | esconder incerteza | `podeAfirmarSemRessalva('documento') === false`; lacuna sai na resposta |
| ❌8 | substituir o responsável operacional | escalar é oferecer contato, nunca decidir por ele |
| ❌9 | experiência isolada virar regra | "eu sempre faço assim" entra como `sugestao`, e `sugestao` não orienta |
| ❌10 | aprender erro como verdade | nada dito em conversa escreve na base. O caminho é informação → evidência → validação humana → `oficial` |

**Nota sobre ❌5, porque é a proibição mais fácil de violar sem perceber.** Busca
lexical não sabe de sistema: "encerrar" casa com o encerramento do GW e casaria
com o encerramento de qualquer outro sistema pelo mesmo trigrama. Hoje os 11 POPs
são todos GW e o defeito ficaria **invisível** — apareceria no dia em que o
segundo sistema entrasse, já em produção, orientando alguém a fazer no GW o que o
POP do outro sistema mandava. Por isso o filtro é estrutural e entra agora, com
teste, enquanto ainda não há como ele falhar em silêncio.

---

## O comportamento-alvo

Quando a situação descrita não bate com o cenário documentado, a resposta certa
não é a mais útil — é esta:

> Encontrei o procedimento oficial relacionado: **IT-ADMLUFT-007**, etapa 5 de 8.
> O POP orienta fazer X.
>
> ⚠️ A situação que você descreveu parece diferente do cenário documentado. Não
> vou assumir que o mesmo procedimento se aplica.
>
> `[Ver procedimento]` `[Ver situações semelhantes]` `[Falar com o supervisor]`

Uma resposta bonita e errada custa mais que uma recusa. No SOS ela custa uma
carga manifestada errado por alguém que não tinha como saber que a IARA estava
chutando.
