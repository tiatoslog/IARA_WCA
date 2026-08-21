# Auditoria do núcleo cognitivo da IARA — 11/08/2026

Árvore auditada: `IARA_WCA/iara-os/apps/web` (HEAD `557b3fd`), a mais avançada
das três cópias presentes na máquina. Núcleo cognitivo: ~5.300 linhas em
`servidor/nucleo/`.

Método: inspeção do código, sonda executável sobre a cadeia real de decisão
(`Percepcao → FuncaoExecutiva → Planejador → catálogo`) e execução da suíte
antes e depois de cada alteração. Nenhum defeito abaixo é hipótese — todos foram
reproduzidos.

---

## A. Diagnóstico geral

**A IARA não é um chatbot que chama ferramentas. Ela já é, estruturalmente, o
sistema cognitivo que o pedido descreve.** Os módulos existem e estão separados
corretamente:

| Camada pedida | Onde já vive |
|---|---|
| Cognitive Router | `Percepcao.ts` + `FuncaoExecutiva.ts` + `RoteadorIntencoes.ts` |
| Context Manager | `MemoriaTrabalho.ts` |
| Memory Manager | `MemoriaOperacional.ts` (shards privados) |
| Knowledge Manager | `RagHistorico.ts` + `dados.ts` (memória corporativa) |
| Planner | `Planejador.ts` + `MotorRaciocinio.planejar` |
| Tool Registry | `Habilidade.ts` + `GerenciadorHabilidades.ts` |
| Executor | `Kernel.executarPlano` |
| Security Manager | `Seguranca.ts` (política, sandbox, auditoria, vazão) |
| LLM Provider | `ClienteClaude.ts` — substituível, isolado |

A LLM já **não** escreve estado, já **não** executa ferramenta e já tem plano
descartado quando alucina habilidade inexistente (`MotorRaciocinio:142`).

**Portanto o diagnóstico não é "falta arquitetura". É:**

1. **Defeitos concretos** faziam a IARA responder errado e afirmar ações que
   nunca executou. Eram quatro, todos reproduzidos e corrigidos (seção B).
2. **Faltam dois órgãos** dos treze pedidos: **Verifier** e **Learning/Error
   Manager**. Esses sim precisam ser construídos.
3. **A suíte de testes não protegia os invariantes.** 126 testes passavam com o
   catálogo quebrado. Dois comentários no código afirmavam garantias que não
   existiam.

Uma reescrita seria destrutiva e injustificada. O caminho é reparar, adicionar
os dois órgãos ausentes e travar tudo com testes de regressão.

---

## B. Problemas encontrados

### CRÍTICO-1 — Quatro habilidades órfãs → **ação inventada** ✅ corrigido

`Planejador.RECEITAS` emitia planos citando `criar_pasta`, `abrir_aplicativo`,
`acionar_energia` e `resolver_confirmacao`. **Nenhuma das quatro estava no
catálogo.**

*Evidência (sonda, antes):*

```
ENTRADA    crie uma pasta chamada Relatórios
âncoras    [pasta]  confiança 0.92
rota       plano_local  (zero)
plano      Criar pasta no computador -> passos [criar_pasta]
>>> FALHA  habilidade inexistente no catálogo: criar_pasta
```

*Cadeia do defeito:* `Kernel:246` não encontra manifesto → `continue` mudo →
`saidas` vazio → `comporResposta` cai no raciocínio livre → a LLM recebe "crie
uma pasta chamada Relatórios" **sem ferramenta e sem saber que algo falhou** e
responde de forma plausível: *"pasta criada"*. Nenhuma pasta foi criada.

**Este é o mecanismo exato de "inventar ações executadas" relatado.**

Agravante de segurança: `desligue o computador` também caía aqui — o fluxo de
confirmação de 60 s do `AgenteLocal` não estava apenas quebrado, estava
**ausente do caminho de execução**.

*Causa-raiz:* o commit `5e07db0` ("Reconstrói as âncoras do Agente Local")
restaurou âncoras e receitas após a remoção acidental de 10/08, mas o arquivo de
habilidades que registrava o `AgenteLocal` no catálogo nunca foi recuperado.
`AgenteLocal.ts` (262 linhas, completo, com 9 testes verdes) estava órfão: só o
próprio teste o importava.

### CRÍTICO-2 — Passo inexistente falhava em silêncio ✅ corrigido

`Kernel:246-249` fazia `registrarErro(); continue;` — sem evento, sem auditoria,
sem `PASSO_CONCLUIDO` (mas `PASSO_INICIADO` já havia sido publicado, então a
interface mostrava um passo que nunca terminava).

Este silêncio é o que **converte um erro de catálogo em mentira**. Sem ele,
CRÍTICO-1 teria sido uma mensagem de falha visível no primeiro uso.

### CRÍTICO-3 — Resposta errada com confiança 0,92 ✅ corrigido

*Evidência (sonda, antes):*

```
ENTRADA    quanto tempo leva para gerar o relatório mensal?
âncoras    [clima]  confiança 0.92
plano      Informar a condição externa -> passos [consultar_clima]
```

A âncora `clima` da `Percepcao` incluía a palavra `tempo` sem nenhuma guarda de
duração. Pergunta sobre prazo respondia previsão do tempo — com a confiança
máxima do sistema, portanto sem chance de escalar para raciocínio.

*Causa-raiz — e este é o padrão mais importante do relatório:* **existem duas
camadas de roteamento com regras duplicadas, e a corrigida não é a que
decide.** `RoteadorIntencoes:115` **já tinha** a guarda `quanto tempo`. Mas o
`RoteadorIntencoes` só é consultado para a checagem de sigilo; quem decide a
rota é a `Percepcao`, que carrega uma cópia divergente das mesmas regras.

O teste novo encontrou sozinho uma **terceira instância** do mesmo padrão:
`Percepcao` usava `/\bpesquis\b/`, que nunca casa "pesquise" ou "pesquisa" — o
`\b` após prefixo exige não-letra em seguida. O `RoteadorIntencoes:172` tem a
correção (`pesquis\w*`) e um comentário explicando o porquê. A cópia não tem.
Toda busca web caía no raciocínio pago.

### ALTO-4 — `escrita` não distinguia máquina local de terceiro ✅ corrigido

`enviar_whatsapp` pedia `escrita`; o papel `operador` tem `escrita`. Dois
comentários afirmavam o contrário (`integracoes.ts:16-17`: *"nenhuma é concedida
ao papel operador por padrão"*).

*Evidência (antes):*

```
operador         -> PERMITIDO enviar WhatsApp em nome do operador
administrador    -> PERMITIDO enviar WhatsApp em nome do operador
somente_leitura  -> barrado
```

Latente apenas porque falta `WHATSAPP_TOKEN`. No dia em que a credencial
entrasse, a trava descrita em prosa não existiria em código.

### ALTO-5 — Vocabulário de confirmação lido ao contrário ✅ corrigido

`Planejador` mapeava a confirmação com `/^confirmo|^pode /`, enquanto a âncora
`confirmacao` casa `confirmo|confirmado|confirmar|prossiga|cancela|…`.
Resultado: **"confirmado" e "prossiga" caíam no ramo `cancelar`**. Errava para o
lado seguro, mas o operador que digita "prossiga" duas vezes sem nada acontecer
conclui, com razão, que a IARA não entende confirmação.

### ALTO-6 — Não existe rota de esclarecimento ⚠️ pendente

`RotaExecutiva` tem quatro valores: `sigilo`, `plano_local`, `plano_cognitivo`,
`raciocinio_direto`. **Nenhum é "perguntar".**

```
ENTRADA    manda pro João            → confiança 0.35 → raciocinio_direto
ENTRADA    faz aquele relatório de ontem de novo → confiança 0.35 → raciocinio_direto
```

Baixa confiança leva ao mesmo lugar que alta: a LLM adivinha. Viola §16/§19 do
pedido. Ver seção F.

### ALTO-7 — Não existe camada de verificação ⚠️ pendente

`ResultadoHabilidade.resolveu` é **autodeclarado pela própria habilidade** e
nada o confere. Não existe `ACTION → RESULT → VERIFICATION`. A exceção é o
`AgenteLocal.criarPasta`, que checa o disco antes e depois — é o único ponto do
sistema que verifica o mundo.

### ALTO-8 — Memória sem tempo, origem, confiabilidade ou conflito ⚠️ pendente

`MemoriaOperacional` é log append-only + insights. Das sete memórias pedidas,
existem quatro (sessão, trabalho, histórica, preferências). Faltam **memória de
procedimentos** e **memória de erros** estruturada. Não há `timestamp+origem+
confiabilidade+versão` por fato, e portanto **não há resolução de conflito**:
"o relatório sai às 16h" e "agora sai às 17h" coexistem sem desempate.

### MÉDIO-9 — A suíte não protegia os invariantes ✅ corrigido

126 testes verdes sobre um catálogo quebrado. `Planejador.ts:33` afirmava
*"`testes/kernel.test.ts` verifica isso"* — **esse teste não existia**. O padrão
"comentário garante invariante que o código não tem" apareceu três vezes nesta
auditoria (Planejador, integrações, Seguranca).

### MÉDIO-10 — Ordem das âncoras é ordem de declaração ⚠️ pendente

`Planejador.planejar` usa a primeira âncora encontrada, e `Percepcao` as devolve
na ordem do array `ANCORAS`. O comentário afirma *"`incidente` vem antes na
lista"* — mas `infraestrutura` está no índice 1 e `incidente` no 2. Sem impacto
hoje (os regex não colidem nos casos testados), mas é ambiguidade resolvida por
acidente de ordenação, não por relevância.

### MÉDIO-11 — Custo não é agregado ⚠️ pendente

`RACIOCINIO_CONCLUIDO` publica tokens por turno, mas nada acumula por sessão,
por operador ou por motivo. Não há orçamento nem atribuição de causa.

### BAIXO-12 — Três modos de falha indistinguíveis

`MotorRaciocinio.planejar` devolve `null` para nuvem fora, JSON inválido e
habilidade alucinada. A distinção importa para medir taxa de alucinação de
plano.

---

## C. Causa-raiz consolidada

Três causas explicam os doze problemas:

1. **Duplicação de regra entre duas camadas de roteamento** (CRÍTICO-3, e as
   duas instâncias irmãs). `Percepcao` e `RoteadorIntencoes` reimplementam o
   mesmo reconhecimento; correções foram aplicadas em uma e não na outra. Esta é
   a causa de maior alcance — produz erro *silencioso e confiante*, o pior tipo.

2. **Perda de arquivo na remoção acidental de 10/08, sem detecção** (CRÍTICO-1,
   CRÍTICO-2). O sistema não tinha como perceber: o catálogo não era validado
   contra as receitas, e o passo ausente falhava sem ruído.

3. **Comentário como substituto de teste** (ALTO-4, MÉDIO-9, MÉDIO-10). Três
   invariantes existiam apenas em prosa. Comentário não executa.

---

## D. Arquitetura atual (após esta auditoria)

```
mensagem
   ↓
Percepcao ─────────── tipo, urgência, âncoras, confiança, leitura do operador
   ↓                  (regex + contagem, custo zero)
FuncaoExecutiva ───── consulta RoteadorIntencoes (só sigilo) + Planejador.temReceita
   ↓                  decide 1 de 4 rotas
   ├── sigilo ──────────→ plano de recusa
   ├── plano_local ─────→ receita determinística (custo zero, ~5 ms)
   ├── plano_cognitivo ─→ LLM decompõe → validado contra catálogo
   └── raciocinio_direto → passo único
   ↓
Kernel.executarPlano ─ por passo: sandbox → permissões → esquema → timeout
   ↓                   falha vira FATO registrado (novo)
comporResposta ─────── determinístico com saída: devolve direto (0 tokens)
   ↓                   determinístico sem saída: assume a falha (novo)
   ↓                   com raciocínio: LLM sintetiza, falhas no contexto (novo)
resposta + shard privado
```

Ausentes do desenho: **Verifier** (entre execução e resposta) e **Learning**
(depois da resposta).

## E. Arquitetura proposta

Duas inserções no laço existente — não uma reescrita:

```
Kernel.executarPlano
   ↓
┌──────────────────────────────────────────┐
│ VERIFIER  (novo)                         │
│ a habilidade declara COMO se verifica;   │
│ o kernel confere o mundo, não a promessa │
└──────────────────────────────────────────┘
   ↓
comporResposta
   ↓
resposta
   ↓
┌──────────────────────────────────────────┐
│ LEARNING / ERROR MANAGER  (novo)         │
│ falha e correção viram fato tipado no    │
│ shard, com origem, instante e versão     │
└──────────────────────────────────────────┘
```

E uma quinta rota na `FuncaoExecutiva`: `esclarecer`.

---

## F. Alterações — feitas e pendentes

### Feitas nesta auditoria

| Arquivo | Alteração |
|---|---|
| `habilidades/agenteLocal.ts` | **novo** — 4 manifestos religando o `AgenteLocal` ao catálogo |
| `habilidades/index.ts` | registra `HABILIDADES_AGENTE_LOCAL` |
| `kernel/Kernel.ts` | falha de passo vira fato: `ExecucaoPlano {saidas, falhas}`; habilidade ausente publica `FALHA` + `PASSO_CONCLUIDO` + auditoria; plano determinístico sem saída assume a falha em vez de cair na LLM; falhas entram no contexto do raciocínio |
| `kernel/Percepcao.ts` | âncora com `exceto`; guarda de duração para `tempo`; `pesquis\w*` e `noticia\w*`; `analise` com prefixos |
| `kernel/Planejador.ts` | `ehAfirmacao()` — confirmação vs. cancelamento; comentário falso corrigido |
| `kernel/Habilidade.ts` | nova permissão `externo` |
| `kernel/Seguranca.ts` | `externo` só para `administrador` |
| `habilidades/integracoes.ts` | `enviar_whatsapp` pede `externo` |
| `testes/integridade-cognitiva.test.ts` | **novo** — 13 testes de invariante |

Resultado: **139/139 testes verdes** (126 originais + 13 novos), `tsc --noEmit`
limpo, zero regressões.

### Pendentes, em ordem de valor

1. **Rota `esclarecer`** (ALTO-6). Gatilho deliberadamente estreito: só quando a
   ambiguidade recai sobre uma ação que **alcança o mundo** — destinatário
   indeterminado, alvo de escrita indeterminado. "faz aquele relatório de
   ontem" **não** deve perguntar: o histórico de 20 turnos resolve, e perguntar
   o que já se pode saber é o outro modo de falhar (§19). A pergunta é objetiva:
   *"Qual João — João Silva ou João Pereira?"*, nunca *"pode esclarecer?"*.

2. **Verifier** (ALTO-7). `ManifestoHabilidade` ganha `verificar?(resultado,
   ctx)`. O kernel chama depois de executar; `resolveu` passa a ser **conferido,
   não declarado**. Verificação proporcional ao risco (§21): habilidade de
   leitura não paga esse custo.

3. **Fato tipado na memória** (ALTO-8). `Fato {valor, origem, instante, versão,
   confiabilidade}` com desempate por recência+origem. Habilita memória de
   procedimentos e de erros.

4. **Unificar as duas camadas de roteamento** (causa-raiz 1). O reconhecimento
   deve morar em **um** módulo consumido por ambas. Enquanto houver duas cópias,
   a próxima correção vai para a errada de novo.

5. **Agregador de custo** (MÉDIO-11) e âncoras com prioridade explícita
   (MÉDIO-10).

---

## G. Novo fluxo cognitivo

```
ENTRADA
  → NORMALIZAÇÃO          normalizar() — acento e caixa
  → PERCEPÇÃO             tipo, urgência, âncoras, confiança, leitura
  → DECISÃO EXECUTIVA     sigilo | local | cognitivo | direto | ESCLARECER*
  → PLANO                 receita determinística ou decomposição validada
  → EXECUÇÃO              4 portas por passo; falha é fato, não silêncio
  → VERIFICAÇÃO*          o mundo confirma? (proporcional ao risco)
  → COMPOSIÇÃO            0 tokens quando o determinístico já respondeu
  → MEMÓRIA               shard privado + fato tipado*
  → RESPOSTA
```
`*` pendente.

## H. Memória — arquitetura corrigida

| Nível | Vive em | Estado |
|---|---|---|
| Trabalho | `MemoriaTrabalho` | ✅ morre com a tarefa |
| Sessão | `EstadoAtomico` | ✅ dura o socket |
| Histórica | `MemoriaOperacional` | ✅ shard privado por `id_usuario` |
| Preferências | `operador_preferencias` | ✅ ficha declarada |
| Conhecimento | `camada-global.md` + RAG | ✅ trigrama, offline |
| **Procedimentos** | — | ❌ |
| **Erros** | — | ❌ |
| **Conflito** | — | ❌ sem timestamp/origem/versão por fato |

O isolamento de shard é sólido: `id_usuario` vem sempre da sessão, `idSeguro()`
bloqueia travessia, e não existe método que leia dois operadores — nem o
consolidador noturno.

## I. Ferramentas

O contrato pedido **já existe** em `Habilidade.ts`: nome, descrição (escrita
para a LLM ler), parâmetros com esquema, permissões, timeout, custo, motivo de
indisponibilidade. Quatro portas antes de qualquer executor. Falta apenas
`verificar` e `risco` no manifesto.

Ponto forte: `executar_consulta_sql` **não aceita SQL** — só consultas
pré-aprovadas por nome, com dupla validação de parâmetros. `extrair_texto_
documento` bloqueia travessia com `path.basename`. A superfície de injeção via
plano gerado por LLM está fechada.

## J. Anti-alucinação

Já existente: LLM não executa; plano com habilidade inventada é descartado
inteiro; sem `ANTHROPIC_API_KEY` a IARA **avisa** em vez de improvisar; a
persona proíbe inventar número, data e status.

Adicionado: **falha nunca é silêncio.** Plano determinístico sem saída assume a
falha; passo não executado entra no contexto do raciocínio sob rótulo explícito
*"não afirme que foram"*. A porta pela qual "criei a pasta" entrava está fechada.

Pendente: verificação pós-execução e distinção explícita fato/inferência/
hipótese na resposta.

## K. Verificação

Hoje só `criarPasta` verifica o mundo. Proposta: `verificar` opcional no
manifesto, chamado pelo kernel, com custo proporcional ao risco — `criar_pasta`
confere o disco; `consultar_clima` não paga nada.

## L. Testes cognitivos

`testes/integridade-cognitiva.test.ts` cobre hoje:

- integridade catálogo↔receitas (percorre toda âncora acionável)
- as 4 habilidades do agente local presentes; ids únicos; manifestos úteis
- duração ≠ meteorologia (6 frases) / clima real preservado (5 frases)
- vocabulário de confirmação (11 frases)
- energia sempre via pendência
- sigilo barrado antes do planejamento
- pergunta operacional não gasta token
- `operador` não alcança terceiros; agente local preservado

A cobrir: alucinação (pergunta sem fonte), memória entre sessões, ambiguidade,
recuperação de falha de ferramenta, correção de informação anterior.

**Regra de regressão cognitiva:** todo erro observado vira teste **aqui, antes**
da correção entrar no código.

## M. Métricas

| Métrica | Como medir | Fonte |
|---|---|---|
| Precisão | acertos / perguntas de gabarito | suíte |
| Taxa de alucinação | afirmações sem fonte / respostas factuais | revisão amostral |
| Ação inventada | `TAREFA_CONCLUIDA` afirmando ação com `falhas ≠ []` | barramento |
| Execução correta | passos com verificação positiva / executados | Verifier |
| Recuperação | falhas com resposta honesta / falhas | `FALHA` + resposta |
| Custo | tokens por turno, por rota, por operador | `RACIOCINIO_CONCLUIDO` |
| Economia determinística | turnos `custo_estimado: zero` / total | `DECISAO_TOMADA` |
| Latência | `ms` por rota | `TAREFA_CONCLUIDA` |
| Escolha de ferramenta | planos válidos / planos gerados pela LLM | `interpretarPlano` |

O barramento já emite quase tudo. Falta um coletor que agregue.

---

## Nota operacional

Existem **três cópias** do projeto: `Desktop/IARA/iara-os` (defasada),
`Desktop/IARA/IARA_WCA` (**a viva**, auditada aqui) e `C:\dev\iara-limpo`
(anterior ao trabalho de marca). Trabalhar na cópia errada é como o arquivo do
agente local se perdeu. Vale consolidar em uma só antes do próximo ciclo.
