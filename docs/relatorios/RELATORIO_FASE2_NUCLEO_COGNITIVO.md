# Fase 2 — reconstrução e validação do núcleo cognitivo da IARA

Árvore: `IARA_WCA/iara-os/apps/web`. Continuação de
`RELATORIO_AUDITORIA_COGNITIVA_2026-08-11.md`.

**Suíte: 188/188 verdes** (139 ao início da fase), `tsc --noEmit` sem erros no
código do projeto, 17 arquivos de teste.

Prova comportamental executável: `npx tsx scripts/prova-cognitiva.ts`.

---

## A. O que foi encontrado

Quatro defeitos novos, **todos descobertos por testes escritos nesta fase** —
não por leitura de código. Isso importa mais que os defeitos em si: significa
que a suíte passou a encontrar o que a revisão humana não encontrava.

### A.1 — A suíte testava a camada morta (causa-raiz da Fase 1)

`RoteadorIntencoes.rotear()` calculava rota completa (clima, banco, RAG, busca,
agenda, confiança, parâmetros). O kernel lia **um único campo** dela —
`recusa_sigilo` — e descartava todo o resto. Quem decidia era a `Percepcao`,
com uma cópia divergente das mesmas regras.

E `testes/regressoes.test.ts` — os seis testes que documentavam exatamente as
correções de roteamento — apontava para `rotear()`. **Testava a camada morta.**

> Foi por isso que "quanto tempo leva o relatório?" respondia previsão do tempo
> com 126 testes verdes: os testes verificavam o objeto que não decidia nada.

### A.2 — Sigilo só reconhecia nome completo

`PortaoSigilo` casava `t.includes(normalizar(nomeCompleto))`. Com o time de
teste chamado "Operador 2" funcionava — a string aparece inteira na frase. Com
nomes reais, **"o que a Marina falou ontem?" não casava "Marina Alves"** e a
sondagem passava direto pelo portão.

Ninguém se refere a um colega pelo nome completo. Falha de segurança real,
encontrada pelo teste `decisao.test.ts`.

### A.3 — `frota` solta como âncora acionável

A âncora `infraestrutura` era `\b(quantas centrais|centrais ativas|servidores
ativos|frota|quantos veiculos)\b`. Todas as alternativas são frases de
contagem; **`frota` era a única palavra solta**.

Resultado: *"elabore uma estratégia de redução de custo para a frota"* →
plano determinístico → *"11 centrais ativas, 449 veículos"*. Resposta impecável
para uma pergunta que ninguém fez. Mesma família do bug de `tempo`.

### A.4 — `enviar_whatsapp` era risco alto sem saber se verificar

O teste de contrato `toda habilidade de risco médio ou alto declara
verificação` reprovou o catálogo na primeira execução.

---

## B. O que foi corrigido — 6 incrementos, cada um testado antes do seguinte

### 1. Consolidação: uma autoridade por decisão

| Decisão | Autoridade única | Antes |
|---|---|---|
| Normalizar texto | `nucleo/texto.ts` | dentro do roteador |
| Bloquear shard alheio | `kernel/Sigilo.ts` | `RoteadorIntencoes` |
| Intenção canônica | `kernel/Percepcao.ts` | **duplicado** com o roteador |
| Rota e ação | `kernel/FuncaoExecutiva.ts` | idem |
| Plano | `kernel/Planejador.ts` | — |

`RoteadorIntencoes.ts` **removido**. Os seis testes de regressão foram
retargetados para a camada viva — os casos são os mesmos, agora apontando para
quem decide.

### 2. Camada de verdade — `kernel/Verdade.ts`

Procedência ordenada por força: `fato_verificado` > `fato` >
`resultado_ferramenta` > `documento` > `memoria` > `inferencia` > `hipotese` >
`desconhecido`.

`maisForte()` desempata **por procedência primeiro, recência só dentro da mesma
procedência** — é a resolução do conflito "relatório às 16h vs. às 17h": uma
memória de hoje não derruba um fato verificado de ontem.

Onze estados de execução, incluindo `desconhecido`. `VERBO_DO_ESTADO` garante
que `executado` nunca produza "pronto":

```
executado  → "solicitei a execução, mas não consegui confirmar o resultado"
verificado → "está feito e confirmado"
desconhecido → "não consigo provar o que aconteceu"
```

### 3. Verifier real — a quinta porta

`verificar?()` no contrato de habilidade. `GerenciadorHabilidades.
executarVerificando()` devolve `{resultado, verificacao, estado}` — o relato do
executor e a apuração do mundo **lado a lado, nunca fundidos**.

Implementações:

| Habilidade | Verificação | Resultado |
|---|---|---|
| `criar_pasta` | `existsSync` no caminho resolvido | confirma de fato |
| `abrir_aplicativo` | — | **declara a limitação**: processo desanexado |
| `acionar_energia` | pendência registrada? | confirma o que promete |
| `resolver_confirmacao` | cancelar: pendência sumiu / confirmar: — | metade verificável |
| `enviar_whatsapp` | sem provedor ligado | declarada, não implementável |

Regras que caem fora do sucesso:
- verificação `divergente` → `falhou`
- verificação `sem_meio_de_verificar` → `desconhecido`
- **risco ≥ médio sem `verificar` → `desconhecido`**, nunca sucesso
- verificador que lança → `desconhecido` (não derruba o turno)

### 4. Política de risco — `kernel/PoliticaRisco.ts`

`risco` obrigatório em todos os 16 manifestos.

| Risco | Confirmação prévia | Verificação | Piso de confiança |
|---|---|---|---|
| baixo | não | não | 0,50 |
| médio | não | **sim** | 0,85 |
| alto | **sim** | **sim** | 0,90 |

A tese: *"desligue o computador"* tem confiança 0,92 — a IARA entendeu
perfeitamente, e **entender perfeitamente é o que torna a ação perigosa**. Um
sistema que usa confiança como autorização executa com mais vontade quanto
melhor entende. Confiança decide se sabe O QUE fazer; risco decide QUANTA PROVA
precisa.

Risco de plano = o do passo mais arriscado, nunca a média.

### 5. Rota de esclarecimento — `kernel/Ambiguidade.ts`

Sexta rota `esclarecer` + `AcaoCognitiva` nomeando a decisão no vocabulário do
domínio (`responder`, `perguntar`, `executar`, `pesquisar`,
`recuperar_memoria`, `criar_plano`, `recusar`).

**A ordem é a política:** sigilo → ambiguidade → receita → nuvem → decomposição.
Ambiguidade vem **antes** de receita de propósito: depois de escolhida a
receita já é tarde para perguntar.

O detector recebe `historicoRecente` (6 turnos) e `pessoasConhecidas`:

| Pedido | Contexto | Decisão |
|---|---|---|
| "faz aquele relatório de ontem" | histórico menciona relatório | **executa** |
| "faz aquele relatório de ontem" | histórico não menciona | *"Preciso saber a qual relatório você se refere"* |
| "manda pro João" | dois Joões | *"Preciso saber qual João: João Silva ou João Pereira?"* |
| "manda pra Marina" | uma Marina | **executa** |
| "me manda aquele documento" | — | não é envio a terceiro |
| "manda pro Ricardo" | desconhecido | **não pergunta** — é lacuna de dado |

Perguntar custa **zero token**: o kernel curto-circuita antes do plano.

### 6. Gestor de erros — `kernel/RegistroErros.ts`

Seis classes de erro cognitivo, cada uma nascida de um defeito real. Assinatura
pela **forma** do pedido (não conteúdo): "manda pro João" e "manda pro Pedro"
colidem. Repetições contam ocorrências em vez de acumular linhas.

`casoDeRegressao()` emite o esqueleto do teste — com a asserção deliberadamente
`TODO`. Uma asserção inventada por máquina protegeria o que a máquina supôs ser
o problema, e teste que protege a coisa errada é pior que teste nenhum.

---

## C. O que permaneceu intencionalmente inalterado

- **`AgenteLocal.ts`** — raízes autorizadas, allowlist, pendência de 60 s.
  Funciona, é testado, as fronteiras estão certas. Só ganhou a ponte que faltava.
- **`ClienteClaude.ts`** — cache de prefixo estável, streaming, normalização de
  histórico. Nada a melhorar.
- **`MemoriaOperacional.ts`** — isolamento de shard é sólido: `id_usuario` vem
  da sessão, `idSeguro()` bloqueia travessia, nenhum método lê dois operadores.
  A camada de fato tipado **não foi construída** (ver O).
- **`Seguranca.ts`, `consultasNomeadas.ts`** — SQL por consulta nomeada,
  travessia bloqueada, quatro portas. A superfície de injeção já estava fechada.
- **`RagHistorico`, `TeoriaDaMente`, barramento, projeções** — só o import de
  `normalizar` mudou.

---

## D. Arquitetura cognitiva final

```
IARA
├── Cognitive Router ──── Percepcao (intenção) + FuncaoExecutiva (rota+ação)
├── Context Manager ───── MemoriaTrabalho + ContextoDecisao (histórico na decisão)
├── Memory Manager ────── MemoriaOperacional (shards privados)
├── Knowledge Manager ─── RagHistorico + memória corporativa
├── Planner ───────────── Planejador (receitas) + MotorRaciocinio (emergente)
├── Tool Registry ─────── Habilidade + GerenciadorHabilidades
├── Executor ──────────── Kernel.executarPlano
├── Verifier ──────────── verificar() + executarVerificando()      ← NOVO
├── Learning Manager ──── RegistroErros                             ← NOVO
├── Security Manager ──── Sigilo + Seguranca + PoliticaRisco        ← ampliado
├── Truth Layer ───────── Verdade (procedência + estados)           ← NOVO
└── LLM Provider ──────── ClienteClaude (substituível)
```

## E. Fluxo de decisão final

```
ENTRADA
  → normalizar()
  → Percepcao          tipo, urgência, âncoras, confiança, leitura
  → PortaoSigilo       shard alheio? RECUSAR
  → DetectorAmbiguidade   falta algo que o contexto NÃO responde? PERGUNTAR
  → Planejador.temReceita?   EXECUTAR | PESQUISAR | RECUPERAR_MEMORIA
  → nuvem ligada?      não → RESPONDER declarando a limitação
  → composto?          sim → CRIAR_PLANO   não → RESPONDER
```

## F. Fluxo de execução final

```
por passo:
  habilidade existe?  não → FALHA registrada + evento + assinatura de erro
  sandbox (papel)  →  permissões  →  esquema  →  timeout
  executar  →  ResultadoHabilidade { texto, detalhe, resolveu }
                                       ↑ AUTODECLARADO, não é verdade
```

## G. Fluxo de verificação final

```
ResultadoHabilidade
  → verificar(resultado, ctx)   confere O MUNDO, não o próprio relato
  → Verificacao { confirmado, evidencia, motivo }
  → estado:
       confirmado           → verificado    → "está feito e confirmado"
       divergente           → falhou        → registra erro cognitivo
       sem_meio_de_verificar→ desconhecido  → "solicitei, não consigo confirmar"
       risco≥médio sem verificador → desconhecido
  → a ressalva viaja no texto E no contexto da LLM:
       "--- executados mas NÃO CONFIRMADOS (diga que solicitou, não que está feito) ---"
```

## H. Arquitetura da memória

| Nível | Onde | Estado |
|---|---|---|
| Trabalho | `MemoriaTrabalho` | ✅ morre com a tarefa |
| Sessão | `EstadoAtomico` | ✅ dura o socket |
| Decisão | `ContextoDecisao` (6 turnos) | ✅ **novo** — histórico entra na decisão |
| Histórica | `MemoriaOperacional` | ✅ shard privado |
| Preferências | `operador_preferencias` | ✅ |
| Conhecimento | camada global + RAG | ✅ |
| Procedência | `Verdade.Procedencia` | ✅ **novo** — vocabulário pronto |
| Fato tipado persistido | — | ❌ **não construído** (ver O) |

A janela de decisão (6) é menor que a do raciocínio (20) de propósito: resolver
"aquele relatório" com algo dito há trinta mensagens não é recuperar contexto,
é inventar vínculo.

## I. Política de confiança

Confiança mede **"sei agir sobre isto"**, não "reconheci uma palavra". Só âncora
acionável eleva o número; âncora temática (`analise`) fica no meio.

`0,92` acionável · `0,85` saudação · `0,50` temática · `0,35` nada reconhecido

Ela **nunca é autorização sozinha** — cruza com risco (J) e com ambiguidade (K).

## J. Política de risco

Ver B.4. O ponto: os dois eixos são independentes, e o piso de confiança nunca
chega a 1 — o que fecha a diferença em risco alto é a confirmação do operador,
não mais certeza da máquina.

## K. Política de esclarecimento

Três gatilhos, todos exigindo que o **contexto não resolva**:
`destinatario_multiplo`, `destinatario_ausente`, `referencia_sem_antecedente`.

Não perguntar quando: há candidato único, o histórico tem antecedente, o
destinatário é o próprio operador ("me manda"), ou o nome é desconhecido
(lacuna de dado, não de intenção).

A pergunta é **fechada e oferece candidatos** — nunca "pode esclarecer?".

## L. Política anti-alucinação

1. LLM não executa, não decide permissão, não declara estado real.
2. Plano citando habilidade inexistente é descartado **inteiro**.
3. Habilidade ausente → falha registrada, evento, assinatura de erro.
4. Plano determinístico sem saída **assume a falha**, não cai na LLM.
5. Falhas e não-confirmações entram no contexto sob rótulo explícito.
6. Sem chave da Anthropic, **declara a limitação** em vez de improvisar.
7. `podeAfirmarSemRessalva()` só para `fato` e `fato_verificado`.

## M. Testes adicionados

| Arquivo | Testes | Cobre |
|---|---|---|
| `integridade-cognitiva.test.ts` | 13 | catálogo↔receitas, duração≠clima, confirmação, energia, sigilo, permissões |
| `verificacao.test.ts` | 14 | execução≠verdade, sem-meio-de-verificar, contrato de risco, procedência |
| `decisao.test.ts` | 20 | ambiguidade nos dois sentidos, ação cognitiva, risco ⊥ confiança |
| `mentira-operacional.test.ts` | 9 | ponta a ponta: a fala nunca afirma o que não aconteceu |
| `aprendizado-erros.test.ts` | 6 | assinatura por forma, dedupe, geração de caso |
| `regressoes.test.ts` | retargetado | os 6 casos agora na camada viva |

## N. Resultados

```
188 testes · 188 passam · 0 falham
tsc --noEmit: 0 erros no código do projeto
```

Cada um dos 4 defeitos de A foi encontrado por um desses testes **antes** de
qualquer correção, e cada correção entrou depois do teste que a exige.

## O. Riscos ainda existentes

1. **Fato tipado na memória não foi construído.** `Verdade.ts` tem o
   vocabulário e o desempate (`maisForte`), com teste. Mas
   `MemoriaOperacional` continua gravando texto plano — nada carrega
   procedência ainda. **O conflito "16h vs 17h" está resolvido em tipo, não em
   persistência.** É o maior débito remanescente.

2. **Confirmação de risco alto é específica de energia.** `PoliticaRisco` diz
   que risco alto exige confirmação prévia, mas o único fluxo que a implementa é
   a pendência do `AgenteLocal`. Não há porteiro genérico no kernel. Hoje isso
   não expõe nada — `enviar_whatsapp` é a única outra habilidade de risco alto e
   está sem provedor. **Ligar `WHATSAPP_TOKEN` sem construir o porteiro genérico
   reabre a lacuna.**

3. **Detector de ambiguidade é lexical.** Regex sobre marcas de destinatário e
   referência anafórica. Não cobre ambiguidade semântica ("o relatório de
   sempre") nem alvo em outra língua.

4. **`pessoasConhecidas` são os operadores da sessão**, não uma agenda. Quando
   entrar lista de contatos real, a resolução de destinatário precisa passar a
   consultá-la.

5. **Assinatura de erro é grosseira** — declarado no próprio módulo. Dois
   defeitos com mesma classe e forma colidem. Trade-off aceito: subcontar é
   melhor que inflar o inventário.

6. **Três cópias do repositório.** `IARA_WCA` é a viva (`557b3fd` + este
   trabalho). Consolidar antes do próximo ciclo.

## P. Próximos incrementos recomendados

1. **`Fato` persistido com procedência** — fechar o item O.1. `MemoriaOperacional`
   passa a gravar `{valor, procedencia, origem, instante, versao}`; recuperação
   usa `maisForte()`. É o que falta para a memória deixar de ser log.

2. **Porteiro genérico de risco alto** no kernel — antes de executar qualquer
   habilidade `risco: 'alto'`, exigir confirmação, reutilizando o padrão de
   pendência do `AgenteLocal`. Pré-requisito para ligar qualquer integração.

3. **Agregador de custo** — tokens por rota, por operador e por motivo. O
   barramento já emite tudo; falta o coletor.

4. **Procedência na resposta** — usar `RESSALVA` para marcar inferência e
   memória no texto final, hoje só disponível como vocabulário.

5. **Ambiguidade semântica** — quando houver embeddings locais, resolver
   antecedente por similaridade em vez de `includes`.

---

## Respondendo às três perguntas do §23

**"Quando a IARA não sabe, ela sabe que não sabe?"**
Sim, e é verificável. Sem nuvem: *"Esse pedido exige raciocínio aberto, e a
camada de nuvem está desligada. Prefiro dizer isso a improvisar."* Sem
antecedente: pergunta em vez de adivinhar. Teste: `mentira-operacional.test.ts`
garante que nenhum número apareça numa resposta sem fonte.

**"Quando a IARA executa uma ação, ela consegue provar que executou?"**
Quando a plataforma permite, sim — `criar_pasta` confere o disco. Quando não
permite, ela **diz que não pode provar**: `abrir_aplicativo` devolve
`sem_meio_de_verificar` e a fala vira "solicitei, não consegui confirmar", nunca
"pronto". Habilidade de risco ≥ médio sem verificador termina em `desconhecido`
por construção.

**"Quando a IARA erra, o sistema impede que o mesmo erro volte?"**
Os quatro defeitos da Fase 1 e os quatro desta fase têm teste permanente. O
teste de integridade percorre **toda** receita — o defeito de habilidade órfã
não pode voltar por construção, não por vigilância. E `RegistroErros` transforma
falha nova em assinatura com caso de teste pronto.

A resposta honesta às três é **sim, com as ressalvas de O** — e as ressalvas
estão nomeadas, não escondidas.
