# Instrutor operacional adaptativo — documento normativo

Continuação de `hierarquia-da-verdade-sos.md`. Aquele documento resolveu
**"a IARA não inventa procedimento"**. Este resolve outra coisa:
**"a IARA sabe ensinar sem perder o controle operacional"**.

São problemas diferentes e não podem morar na mesma camada.

---

## 1. Diagnóstico do estado atual

| Arquivo | Responsabilidade hoje | Responsabilidade depois | Risco de duplicação |
|---|---|---|---|
| `lib/procedimento.ts` | Corpus, autoridade (`EstadoConhecimento`), qualidade, evidência, conferência, posição | **Inalterada.** Só é reutilizada pela avaliação | Alto se o vocabulário pedagógico entrar aqui — não entra |
| `BaseProcedimentos.ts` | Corpus + busca lexical com filtro duro de `sistema` | Inalterada | Nenhum |
| `ProcedimentosEmCurso.ts` | Ponteiro persistido por operador (código/etapa/slide/hash/evidência/desvios/conferência) | **Inalterada.** Único dono da posição | **Alto**: `etapasDeclaradas`/`etapasConferidas` no progresso pedagógico seriam cópia disto |
| `GuardiaoDoProcedimento.ts` | `podeIniciar`, `podeAvancar`, `classificarEvidencia`, `ehUltimaParada` | Ganha só **hesitação** (`"acho que fiz"`), que é evidência, não pedagogia | Alto se decisão pedagógica entrar aqui — não entra |
| `ConferenciaDeTela.ts` | Costura visão↔posição; grava conferência; nunca move | Inalterada | Nenhum |
| `AnaliseVisual.ts` | Cadeia de provedores de visão; devolve `SituacaoNaParada` | Inalterada | Nenhum |
| `IntencaoProcedimento.ts` | `localizar` vs `executar`, vocabulário GW, código do POP | **Fonte reutilizada** pela classificação pedagógica | Alto se os regexes forem copiados — são importados |
| `habilidades/procedimentos.ts` | 5 habilidades: consultar, iniciar, avançar, encerrar, revisar lacunas | Semântica inalterada; `redigirParada` ganha profundidade | Médio |
| `Percepcao.ts` | Âncoras determinísticas; `procedimento_gw` é a última | Ganha âncora `treinamento` | Alto se o regex for copiado — é composto |
| `Planejador.ts` | `RECEITAS` por âncora → plano determinístico | Ganha receita `treinamento` | Nenhum |
| `LacunasCapacidade.ts` | Fila de dúvidas sem resposta, por operador, com contagem e origem | **Reutilizada** para divergência de POP (origem nova) | Alto se nascer uma segunda fila — não nasce |
| `Verdade.ts` | `Procedencia` + `RESSALVA` | Inalterada. Avaliação é `inferencia` | **Crítico**: uma escala pedagógica de confiança seria a terceira escala proibida |
| `Kernel.ts` | Turno; short-circuit visual em `anexo` | Ver §10 | Médio |

## 2. O que já está correto — não mexer

`COMPROVADO` por teste existente:

1. Avanço sem evidência é recusado (`GuardiaoDoProcedimento`, adversariais 27–29).
2. Declaração do operador nunca vira `fato_verificado` (`PROCEDENCIA_DA_EVIDENCIA`).
3. Conferência amarrada a código+etapa+slide+hash (`conferenciaVale`).
4. Conferência de outra parada não é gravada (`registrarConferencia`).
5. POP revisado no meio da execução bloqueia (`versao_divergente`).
6. Documento contraditório consulta mas não conduz (`podeGuiar`).
7. Conteúdo do POP sai rotulado como texto de terceiro.
8. Sem achado acima do limiar ⇒ `resolveu: false` + lacuna registrada.
9. Filtro de `sistema` antes da similaridade.
10. `modo: 'guiar' | 'treinar'` já existe no ponteiro e é persistido.

## 3. Gaps arquiteturais

| # | Gap | Evidência no código | Gravidade |
|---|---|---|---|
| G1 | `modo: 'treinar'` **não muda nada** além de uma frase em `redigirParada` | `procedimentos.ts`, bloco `if (modo === 'treinar')` | Alta |
| G2 | Não existe estado pedagógico nem progresso — só o ponteiro | Nenhum módulo em `servidor/nucleo/` cita aprendizado | Alta |
| G3 | Classificação de fala só tem `localizar`/`executar` | `IntencaoProcedimento.ts` | Alta |
| G4 | `"deu erro"`, `"não aparece esse botão"` caem em `evidencia = nenhuma` e recebem *"ninguém me confirmou que ela foi feita"* — resposta errada para quem relatou um problema | `GuardiaoDoProcedimento.DECLARA_CONCLUSAO` | **Crítica** |
| G5 | `"acho que fiz"` e `"não sei se fiz certo"` casam `\bfiz\b` e valem como `declarada` | idem | **Crítica** |
| G6 | `"o POP está errado"` não tem conceito nem registro | — | Alta |
| G7 | Não há retomada: `iniciar_procedimento` sempre recomeça do zero | `procedimentos.ts` | Alta |
| G8 | Não há prática nem avaliação | — | Alta |
| G9 | `"por que faço isso"` não tem resposta possível: o POP não tem campo `motivo`, e nada declara essa ausência | `lib/procedimento.ts` | Média |
| G10 | O procedimento em curso **não faz parte da percepção**: o disco sabe que a pessoa está na etapa 4 e o roteador não | `Percepcao.ts` não lê estado | Alta |
| G11 | Continuação (`"fiz"`, `"próximo"`) depende da LLM escolher `avancar_procedimento` — não há âncora | nenhuma receita emite `avancar_procedimento` | Alta |
| G12 | Turno com anexo faz short-circuit e `return`: o texto que acompanha o print nunca chega ao planejador | `Kernel.ts`, bloco `if (anexo)` | Média — ver §10 |

## 4. Arquitetura proposta

```
              treinar_procedimento          (habilidade orquestrada, 1 só)
                       |
        +--------------+---------------+
        |                              |
  IntencaoPedagogica.ts        ProgressoDeTreinamento.ts
  (puro, determinístico)       (estado PEDAGÓGICO, por operador+revisão)
        |                              |
        +--------------+---------------+
                       |  LÊ, NUNCA ESCREVE
        +--------------v---------------+
        |   CAMADA OPERACIONAL         |
        |   ProcedimentosEmCurso       |  <- só iniciar/avançar/encerrar escrevem
        |   GuardiaoDoProcedimento     |
        |   ConferenciaDeTela          |
        +--------------+---------------+
                       |
                 BaseProcedimentos  (11 POPs — autoridade)
```

**A regra que sustenta o desenho:** a camada pedagógica pode *ler tudo* da
operacional e *não escreve nada* nela. Verificado por teste de fronteira, não
por comentário.

## 5. Máquina de estados — duas, independentes

### Operacional (existente, inalterada)

`aguardando_evidencia` · `bloqueada` · `concluida`

### Pedagógica (nova) — **cinco estados, não sete**

```
descobrindo --ensinou--> aprendendo --"deixa eu tentar"--> praticando
                              ^                                |
                              +------ desistiu / errou --------+
                              |                                |
                              +--------- "me testa" -----------+--> avaliando
                                                                       |
                                                          sem incorretas
                                                                       v
                                                                  dominado
```

**`com_duvida` e `corrigindo` foram cortados de propósito.** O repositório já
registra que *"um estado que nada distingue do vizinho é complexidade
ornamental"*. Uma dúvida não muda o que a IARA faz **depois** de respondê-la —
ela volta ao estado em que estava; é um **evento**, e vira
`DificuldadeRegistrada`. Corrigir é o que acontece dentro de `aprendendo`.
Ambos teriam entrada sem saída própria.

`dominado` é amarrado a `hash_origem`: **POP revisado derruba o domínio.**

## 6. Contratos novos

`lib/treinamento.ts` (puro, sem I/O, espelha `lib/procedimento.ts`):

```ts
export type EstadoPedagogico =
  'descobrindo' | 'aprendendo' | 'praticando' | 'avaliando' | 'dominado';

export type ModoPedagogico =
  'consulta' | 'ensino' | 'execucao' | 'duvida'
  | 'diagnostico' | 'pratica' | 'avaliacao' | 'retomada';

export type NivelDeExplicacao = 'iniciante' | 'intermediario' | 'avancado';

export type TipoDeDificuldade =
  | 'duvida_de_localizacao'       // "onde clico"
  | 'duvida_conceitual'           // "o que é MDF-e", "por que faço isso"
  | 'erro_de_sistema'             // "deu erro", "apareceu uma mensagem"
  | 'elemento_nao_encontrado'     // "não aparece esse botão"
  | 'evidencia_insuficiente'      // "acho que fiz"
  | 'possivel_divergencia_do_pop' // "o POP está errado", "meu colega faz diferente"
  | 'fora_do_pop';                // a pergunta não é coberta

export type ResultadoDeResposta = 'correta' | 'parcial' | 'incorreta' | 'nao_coberta';
```

**`erro_de_procedimento` e `erro_de_contexto` foram recusados.** A IARA não
instrumenta o GW; não há evidência que permita atribuí-los. **Uma categoria que
o sistema nunca tem como preencher honestamente é uma categoria que vai ser
preenchida por chute** — a mesma razão pela qual `SituacaoNaParada` tem
`indefinido` em vez de fingir certeza.

## 7. Fluxo de treinamento

```
fala do operador
   |
   +- âncora determinística (Percepcao) ----> receita (Planejador)
   |
   v
classificarPedagogica(bruto)  ->  ModoPedagogico + TipoDeDificuldade?
   |
   v
treinar_procedimento
   |
   +- lê ProcedimentosEmCurso    (posição, evidência, conferência)   [SÓ LÊ]
   +- lê BaseProcedimentos       (o que fazer — verbatim, com fonte)
   +- lê ProgressoDeTreinamento  (estado pedagógico, dificuldades)
   |
   +- decide PROFUNDIDADE (nível derivado, nunca campo manual)
   +- decide se ENSINA ou PERGUNTA (socrático, com teto de 2)
   |
   +- escreve SÓ em ProgressoDeTreinamento

mover ponteiro / concluir etapa continua sendo
   avancar_procedimento -> GuardiaoDoProcedimento -> ProcedimentosEmCurso
```

## 8. Modelo de memória

```ts
ProgressoDeTreinamento {
  id_usuario, codigo, hash_origem, revisao,
  estado: EstadoPedagogico,
  iniciado_em, atualizado_em,
  paradas_ensinadas: string[],      // "etapa/slide"
  paradas_praticadas: string[],
  dificuldades: DificuldadeRegistrada[],   // {tipo, parada, assinatura, instante}
  avaliacoes: AvaliacaoRegistrada[],       // {parada, resultado, instante}
  conceitos_explicados: string[],
  pergunta_pendente: PerguntaDeAvaliacao | null,
  socraticas_na_parada: number,
}
```

**Campos recusados e por quê:**

| Campo pedido | Recusa |
|---|---|
| `etapasDeclaradas`, `etapasConferidas` | Já são `evidencia` e `conferencia` no ponteiro. Duplicar estado é o antipadrão nº 4 da própria lista |
| `etapaAtual`, `ultimoPonto` | São o ponteiro. Uma segunda cópia é como dois espelhos passam a discordar |
| `tentativas` | Derivável de `avaliacoes.length` |
| `pontosQuePrecisamReforco` | Derivável — função pura `precisamReforco()` |
| `nivel` do operador | Nunca persistido como fato sobre a pessoa. Derivado da parada e do histórico |

**Chaveado por `hash_origem`.** Progresso de revisão anterior não é equivalente:
a retomada diz isso em vez de continuar contando.

## 9. Matriz de testes

26 frases adversariais × asserções de intenção, procedimento, estado
operacional, estado pedagógico, evidência e avanço. Mais 12 provas de
segurança pedagógica. Ver `testes/treinamento-adversarial.test.ts` e
`testes/treinamento.test.ts`.

## 10. O problema dos dois turnos — análise

**Fato medido no código:** `Kernel.ts` faz `return` ao fim do bloco `if (anexo)`.
Logo `print + "pronto, fiz"` produz **um** turno de visão: a conferência é
gravada, a posição não anda, e o texto do operador nunca chega ao planejador.
O avanço acontece no turno seguinte.

| Opção | Preserva o guardião | Caminho paralelo | Custo |
|---|---|---|---|
| A. Avançar dentro do turno visual | Só replicando o guardião ali | **Sim** — segundo chamador na frente do guardião | Inaceitável |
| B. Não fazer short-circuit quando há parada e o texto é procedimental: grava conferência, publica a leitura e **cai no fluxo normal** | Sim — quem avança continua sendo `avancar_procedimento` | Não — é o mesmo caminho, apenas não interrompido | Duas mensagens no mesmo turno; dupla contabilidade de orçamento e histórico |
| C. Manter dois turnos e tornar a costura explícita | Sim | Não | Uma volta a mais para o operador |

**Recomendação: C agora, B depois, e nunca A.** A conferência **já** é
persistida e **já** é aceita como `anexada` no turno seguinte — o mecanismo está
correto e provado. O que falta é o turno 1 dizer com precisão que a declaração
foi ouvida e o que falta para o avanço. B é um alargamento legítimo, mas mexe no
turno de 109 KB do Kernel e duplica contabilidade; entra com teste próprio, não
junto desta fase.

## 11. Riscos e antipadrões vigiados

1. **Segunda escala de confiança** — `ResultadoDeResposta` é pedagógico e sai
   sempre com `RESSALVA.inferencia`. Nunca entra em `Verdade.ts`.
2. **Avaliação virando habilitação** — constante `AVISO_AVALIACAO` obrigatória
   na resposta: responder certo não habilita ninguém.
3. **Camada pedagógica movendo ponteiro** — teste de fronteira.
4. **Interrogatório socrático infinito** — teto de 2 perguntas por parada.
5. **Limiar inventado** — nenhum número novo sem medição. A avaliação usa
   questões de múltipla escolha construídas do próprio POP: acerto é **exato**,
   sem limiar.
6. **Categoria inatribuível** — recusadas em §6.
7. **Texto solto** — toda frase de contrato mora em constante nomeada.
