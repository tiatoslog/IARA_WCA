# Relatório de encerramento — ESCRITA

**Data:** 11/08/2026
**Base:** `f515e10` (281 testes, 0 falhas) → estado desta auditoria
**Escopo:** fechar D1 (idempotência) e D2 (persistência de autorização) e provar que
o cérebro da IARA tem condições arquiteturais para executar escrita real.

---

## 1. VEREDITO

> ### NÃO ENCERRADO

E a razão é **uma só**, nomeada abaixo — não um estado geral de fragilidade.

Os dois bloqueadores que motivaram este trabalho **estão fechados**:

| Bloqueador | Estado | Onde |
|---|---|---|
| **D1 — idempotência** | ✅ fechado | `Operacao.ts`, `RegistroOperacoes.ts`, `Kernel.abrirOperacao` |
| **D2 — persistência de autorização** | ✅ fechado | jornal append-only + `reidratar` + `autorizar` |

O que impede o veredito de encerramento é um **terceiro bloqueador, descoberto
durante esta auditoria** e não presente no diagnóstico anterior:

> **D3 — o canal WhatsApp responde por fora do Kernel.**
> `PortaWhatsapp.atender()` chama `WhatsApp.responder()`, que faz `POST` ao
> Graph da Meta. Essa escrita alcança uma pessoa e **não passa pelo Kernel, pelo
> porteiro, pelo jornal, por idempotência nem por verificador**. Ver §7 e §10.

O critério da Fase 28 exige *"nenhum executor escapa do Kernel"*. Com D3 aberto,
esse item é falso, e declarar encerramento seria a falsa conclusão que o próprio
prompt proíbe. **A escrita pelo catálogo de habilidades está encerrada; a do
canal de resposta não.**

---

## 2. Estado técnico

| Item | Resultado |
|---|---|
| Testes | **332 / 332**, 0 falhas (`npm test`) — eram 281 |
| Suíte nova `cerebro-escrita-integridade.test.ts` | **51 testes**, 0 falhas |
| Typecheck | **limpo** (`tsc --noEmit`, 0 erros) |
| Build | **limpo** (`next build`, distDir isolado `PORT=39997`) |
| Lint | **não existe no projeto** — sem `eslint.config`, sem script `lint`. Não declaro "limpo" o que não roda. |
| Prova cognitiva (anterior) | intacta, 14 cenários |
| **Prova de escrita** (`scripts/prova-escrita-final.ts`) | **0 reprovados**, 9 cenários |
| Teste de mutação | **8 mutações aplicadas, 8 detectadas** (§7) |
| Crash | **simulado**, não real — ver §9 |
| Restart | **testado** (jornal reconstruído sobre o mesmo arquivo) |
| Concorrência | **testada** (2 e 10 reservas simultâneas; 2 canais em paralelo) |
| Integração controlada | **executor + verificador falsos**, 6×5 modos |
| Integração externa real | **nenhuma** — WhatsApp e Graph seguem sem executor |

---

## 3. Arquitetura final — o caminho real

```
USUÁRIO
  ↓ Percepção            (Percepcao.ts — âncoras, modo irrealis, citação)
  ↓ Interpretação        (FuncaoExecutiva — rota, ambiguidade)
  ↓ Contexto / Memória   (MemoriaOperacional, MemoriaFatos — desempate resolvido)
  ↓ Decisão              (Planejador determinístico | MotorRaciocinio emergente)
  ↓ Risco                (PoliticaRisco — baixo / médio / alto)
  ↓ Autorização          (PorteiroAutorizacao — origem do plano)   ← 1ª barreira
  ↓ OPERAÇÃO PERSISTIDA  (RegistroOperacoes.reservar → jornal)     ← NOVO
  ↓ IDEMPOTÊNCIA         (chave + impressão + regra de ouro)       ← NOVO
  ↓ Autorização tipada   (Operacao.transicionar — fonte da prova)  ← 2ª barreira
  ↓ Executor             (GerenciadorHabilidades — 4 portas + relógio)
  ↓ Verificador          (5ª porta — confere o MUNDO)
  ↓ Verdade              (Verdade.ts → Operacao — estado persistido)
  ↓ RESPOSTA
```

**Leitura não passa pelo jornal**, e é deliberado: consulta repetida devolve o
mesmo, não há duplicidade a evitar, e dar identidade persistida a cada leitura de
relógio encheria o jornal de linhas que ninguém consulta. A fronteira é a
**semântica declarada no manifesto**, não uma lista de nomes — habilidade nova de
escrita nasce coberta.

---

## 4. Contrato de operação

`servidor/nucleo/kernel/Operacao.ts` — puro, sem I/O.

**Campos:** `id_operacao`, `chave_idempotencia`, `id_usuario`, `sessao`,
`habilidade`, `risco`, `semantica`, `parametros`, `estado`, `nonce`,
`autorizada_em`, `expira_em`, `criada_em`, `atualizada_em`, `historico[]`.

**Estados** (10): `planejada`, `aguardando_autorizacao`, `autorizada`,
`executando`, `executada_nao_verificada`, `verificada`, `falhou`, `desconhecida`,
`cancelada`, `expirada`.

**Transições permitidas:**

```
planejada              → aguardando_autorizacao | autorizada | cancelada | expirada | falhou
aguardando_autorizacao → autorizada | cancelada | expirada
autorizada             → executando | cancelada | expirada
executando             → executada_nao_verificada | verificada | falhou | desconhecida
executada_nao_verif.   → verificada | falhou | desconhecida
desconhecida           → verificada | falhou          (só com evidência de verificador)
verificada / falhou / cancelada / expirada  → (terminais)
```

**Proibidas, e por quê** — as ausências são o conteúdo da tabela:

- `planejada → verificada` e `aguardando_autorizacao → verificada`: não se prova
  efeito que nunca foi autorizado a acontecer;
- `falhou → *`: "não aconteceu" é apurado; mudar de ideia exige operação nova;
- `cancelada → autorizada`: um "confirmo" atrasado não ressuscita o que o
  operador desistiu de fazer;
- `expirada → *`: janela vencida não reabre.

**Duas regras que a tabela não expressa e `transicionar` impõe:**

1. **Só `fonte: 'verificador'` promove a `verificada`.** Executor, porteiro,
   relógio e operador são todos recusados. *Execução não é verificação.*
2. **Risco alto só chega a `autorizada` com `fonte: 'operador'`.** Nem o porteiro
   serve.

`FonteEvidencia` **não tem `llm`, não tem `documento`, não tem `memoria`**. Não é
omissão — é a regra. Conteúdo externo e saída de modelo entram como matéria,
nunca como prova.

---

## 5. Idempotência

**Quem gera.** O Kernel, em `abrirOperacao`, antes de qualquer efeito.

**O que identifica.** `sha256(id_usuario | habilidade | parâmetros canônicos | origem_pedido)`,
onde `origem_pedido` é o **traço do turno** (`barramento.tracoAtual`, renovado uma
vez por mensagem do operador).

Não é hash do prompt. *"Manda de novo"* e *"reenvia"* são o mesmo efeito com
textos diferentes; *"manda pro João"* duas vezes são efeitos diferentes com o
mesmo texto — hash de prompt erra os dois. O discriminador de turno separa
exatamente o que precisa ser separado:

- mesmo turno reentregue/reexecutado → mesma chave → **é retry, deduplica**;
- turno novo com mesmo conteúdo → chave nova → **é intenção nova, executa**.

> Uma pessoa que pede duas vezes quis duas vezes. Um webhook reentregue não quis
> nada — quis o provedor.

**Onde persiste.** `dados/operacoes/<id_usuario>.jsonl`, append-only, uma linha
por transição. Caminho derivado do `id_usuario` da sessão (mesma regra dos
shards; o operador nunca informa qual arquivo). Ignorado no git.

**Como deduplica.** Três barreiras, nesta ordem, dentro de `reservar`:

1. **chave de idempotência** — mesmo turno, mesmo efeito;
2. **regra de ouro** (§ abaixo) — efeito idêntico em `desconhecida`;
3. **duplo clique** — mesma impressão de efeito, `escrita_nao_idempotente`, ≤20 s.

**Concorrência.** `reservar` é **síncrono**, e essa é a garantia inteira: Node
roda o método sem ceder o laço de eventos, então entre o teste e a reserva não
existe ponto de suspensão. O anti-padrão é explícito:

```ts
if (!existe) { await gravar(); executar() }   // ← a duplicata nasce no await
```

Há teste de arquitetura que falha se alguém tornar `reservar` assíncrono.

**Retry.** O Kernel não tem retry automático — e isto **não é apresentado como
garantia**, porque ausência de retry é lacuna, não trava. A garantia é positiva:

> **REGRA DE OURO.** Uma escrita **não idempotente** cuja impressão de efeito
> coincide com uma operação em `desconhecida` é **bloqueada**, sem prazo. A
> resposta ao operador é *"não repeti; confira antes de pedir de novo"*.

Sem prazo de propósito: envelhecer uma dúvida não a resolve, só a torna
confortável de ignorar. A única saída é `resolverDesconhecida`, que exige um
resultado de **verificador**.

**Crash.** O jornal grava `executando` **antes** de chamar o executor. Um crash
no meio deixa a linha lá.

**UNKNOWN.** Ver §6 e §8.

---

## 6. Autorização

**Como nasce.** Risco baixo/médio: o porteiro autoriza e fica registrado que foi
ele (`fonte: 'porteiro'`). Risco alto: só `fonte: 'operador'`, e a fala humana
tem que existir.

**Como é vinculada.** `autorizar()` confere **sete** coisas:

1. a operação existe;
2. está em `aguardando_autorizacao` — bloqueia **replay** do mesmo "confirmo";
3. o **nonce** bate;
4. o **usuário** bate;
5. a **sessão** bate;
6. a janela não venceu;
7. a prova é carimbada `operador` (imposto por `transicionar`).

**Como expira.** `expira_em` explícito (60 s por padrão), varrido por
`expirarVencidas()` e conferido em `autorizar`.

**Como é cancelada.** `cancelada` é terminal. Nenhuma aresta sai dela.
Cancelamento continua **assimétrico** em relação a confirmar — desistir nunca
exige a prova que agir exige.

**Como sobrevive a restart.** **Não sobrevive, e é o desenho.** `reidratar`
converte `aguardando_autorizacao` **e** `autorizada` em `expirada`. Uma
autorização é uma fala dita a um processo que não existe mais; não há como saber,
do outro lado do restart, se o operador ainda quer aquilo. Recusar custa uma
frase, executar custa o efeito.

O que **sobrevive** é o **registro de que a operação existiu** — e era exatamente
essa a lacuna de D2. Antes, o restart apagava toda memória do ciclo; *"não sei que
existiu"* é indistinguível de *"nunca aconteceu"*, o operador pede de novo, e o
efeito sai duas vezes.

---

## 7. Falhas encontradas

### F1 — idempotência inexistente (D1, confirmada)
| | |
|---|---|
| **Severidade** | P0 |
| **Reprodução** | `grep -rni "idempot\|dedup\|nonce"` → só comentários e um teste. Nenhum mecanismo. |
| **Causa** | Um passo de plano era objeto anônimo que nascia e morria em `executarPlano`: sem nome, sem estado persistido, sem identidade. |
| **Correção** | `Operacao.ts` + `RegistroOperacoes.ts` + porta em `Kernel.abrirOperacao`. |
| **Teste** | `cerebro-escrita-integridade` 4, 4b, 5, 6, 7, 8, 9, 10, 10b, 10c |

### F2 — autorização sem registro persistido (D2, confirmada com correção do diagnóstico)
| | |
|---|---|
| **Severidade** | P0 |
| **Reprodução** | `AgenteLocal.pendencias` é `Map` num singleton de processo. |
| **Causa** | O diagnóstico anterior dizia "a autorização não sobrevive ao restart". Está **certo e é o comportamento seguro**. O defeito real é outro: **a operação também não sobrevive**, e sem ela um crash durante a execução vira silêncio. |
| **Correção** | Jornal append-only; `executando` → `desconhecida` na reidratação. |
| **Teste** | 26, 27, 28, 29, 30 |

### F3 — nonce escrito e nunca conferido
| | |
|---|---|
| **Severidade** | P1 |
| **Reprodução** | `Pendencia.id` era gerado e usado só em string de log. |
| **Causa** | Identidade criada sem consumidor. |
| **Correção** | `autorizar()` confere nonce, usuário, sessão, estado e janela. |
| **Teste** | 18, 19, 20, 21, 22, 23, 24, 25 |

### F4 — deduplicação valia dentro de um canal, não entre canais *(3ª ordem)*
| | |
|---|---|
| **Severidade** | P0 |
| **Reprodução** | O Kernel é **um por sessão**; o mesmo operador tem dois (`Porta.ts` e `PortaWhatsapp.ts`). Cada um construía o próprio `RegistroOperacoes`: **mesmo arquivo de jornal, índices separados em memória**. "Avisa o João" no navegador e repetido no WhatsApp passaria pelas duas reservas. |
| **Causa** | Trava correta amarrada na granularidade errada — mesmo formato do defeito que a auditoria anterior achou na pendência de energia. |
| **Correção** | `registroOperacoes` como instância única do processo; Kernel usa a compartilhada por padrão. |
| **Teste** | 10d (mecanismo), 10e + 10f (fiação de produção) |

### F5 — as duas travas se completavam com `||` em vez de se exigirem *(3ª ordem, defeito criado pela própria correção)*
| | |
|---|---|
| **Severidade** | P0 |
| **Reprodução** | Encontrado pela `prova-escrita-final.ts`. Em `resolver_confirmacao`, o ramo era `if (!operacaoPendente \|\| !havia) return { texto: agenteLocal.confirmar(...) }`. Com o **dispositivo armado** e o **jornal sem pendência nesta conversa**, a chamada **executava o `shutdown`**, contornando inteiramente a autorização persistida recém-construída. |
| **Causa** | Duas fontes de verdade unidas por `||` viram uma só — a mais permissiva. |
| **Correção** | Discordância recusa. Sem operação persistida correspondente, não executa; e `acionar_energia` não arma o dispositivo quando não consegue registrar a operação. |
| **Teste** | 34b, 34c |

### F6 — teste que passava com o mecanismo removido *(2ª ordem)*
| | |
|---|---|
| **Severidade** | P2 (defeito de prova, não de produção) |
| **Reprodução** | Mutação "sem dedup por chave" → 45/45 continuavam verdes. |
| **Causa** | O teste 4 usa `escrita_nao_idempotente`, onde **duas** barreiras respondem. Desligando a primeira, a segunda pegava o caso e o teste não notava. |
| **Correção** | Teste 4b isola a barreira usando `escrita_idempotente`, que não entra na janela de duplo clique. |
| **Teste** | 4b (verificado por mutação: cai quando a dedup por chave morre) |

### F7 — canal WhatsApp escreve por fora do Kernel *(D3, aberto)*
| | |
|---|---|
| **Severidade** | **P1 — bloqueia o encerramento** |
| **Reprodução** | `servidor/canais/WhatsApp.ts:184` — `POST ${GRAPH}/${phoneId}/messages`, chamado por `PortaWhatsapp.atender()`. |
| **Causa** | A resposta do canal foi tratada como transporte, não como escrita. Mas alcança uma pessoa por um provedor externo. |
| **Correção** | **Não feita.** Ver §11. |
| **Teste** | nenhum |

---

## 8. Invariantes agora protegidos

Cada um tem teste, e cada um foi **verificado por mutação** — a trava foi
removida e o teste caiu:

| Invariante | Onde é imposto | Mutação detectada |
|---|---|---|
| `EXECUTION_IS_NOT_VERIFICATION` | `transicionar` — só `verificador` promove | ✅ |
| `HIGH_RISK_NEVER_EXECUTES_WITHOUT_AUTHORIZATION` | `transicionar` — risco alto exige `operador` | ✅ |
| `LLM_OUTPUT_IS_NOT_AUTHORIZATION` | `FonteEvidencia` não tem `llm`; plano emergente carimba `porteiro` | ✅ |
| `UNKNOWN_NEVER_BECOMES_VERIFIED_WITHOUT_EVIDENCE` | `resolverDesconhecida` exige verificador | ✅ |
| `NON_IDEMPOTENT_OPERATION_REQUIRES_IDEMPOTENCY_CONTROL` | `reservar` + regra de ouro | ✅ |
| `CANCELLED_OPERATION_CANNOT_EXECUTE` | tabela de transições (terminal) | ✅ |
| `EXPIRED_AUTHORIZATION_CANNOT_AUTHORIZE` | `autorizar` porta 6 | ✅ |
| `AUTHORIZATION_IS_BOUND_TO_OPERATION` | `autorizar` portas 1–5 | ✅ |
| `RESTART_NEVER_CREATES_AUTHORIZATION` | `reidratar` → `expirada` | ✅ |
| `CRASH_NEVER_INVENTS_FAILURE` | `reidratar` → `desconhecida` | ✅ |
| `DEDUP_IS_PROCESS_WIDE` | `registroOperacoes` singleton + teste 10f | ✅ |
| `DEVICE_AND_JOURNAL_MUST_AGREE` | `resolver_confirmacao` recusa na discordância | ✅ |

**Duas barreiras independentes contra a LLM.** O porteiro barra pela *origem do
plano*. Se alguém apagar o porteiro amanhã, um passo de risco alto proposto pela
LLM **continua** sem conseguir chegar a `autorizada`, porque a fonte da evidência
é tipada. A segunda barreira não está no caminho do código — está no tipo, e não
se contorna reordenando blocos (teste 32).

---

## 9. Limitações externas — o que é da IARA e o que é do provedor

**Garantia da IARA (provada):**
- **no máximo uma tentativa por operação**, dentro de um processo;
- **nenhuma repetição automática** sobre resultado `desconhecida`;
- o estado de toda escrita é persistido antes do efeito e reconstruível.

**NÃO garantido — declarado, não inventado:**

| Limite | Verdade |
|---|---|
| "Exatamente uma vez" externo | **não reivindicado.** Nenhum provedor foi exercitado. |
| WhatsApp / Graph | **não testados.** Seguem sem executor (`indisponivelPorque`). Quando forem ligados, o contrato do provedor decide a semântica de entrega — não este jornal. |
| Crash real | **simulado.** O jornal é reconstruído sobre o mesmo arquivo; não houve `SIGKILL`. A escrita é `appendFile` sem `fsync`: uma linha pode não estar no disco físico numa queda de energia. |
| Multiprocesso | **não coberto.** Duas instâncias do motor contra o mesmo `dados/` não compartilham índice, e o jornal não tem trava entre processos. |
| Nonce em fluxo de texto livre | O nonce **bloqueia replay** (via estado) e está pronto para confirmação carregada pelo canal. Mas "confirmo" é texto livre: `pendenteDe` resolve para a pendência **mais recente** de (usuário, sessão). O ramo "nonce errado" só é alcançável por chamador que carregue um nonce — hoje nenhum canal carrega. **Vínculo real: (operação, usuário, sessão, janela, estado). O nonce ainda não discrimina em produção.** |

Semântica honesta do que existe hoje, no vocabulário pedido:
**`at-most-once` por processo, com `unknown` explícito e sem retry automático.**

---

## 10. Caminhos de escrita auditados

| Habilidade / caminho | Tipo | Risco | Idemp. | Autoriz. | Verific. | Persist. | Status |
|---|---|---|---|---|---|---|---|
| `criar_pasta` | `escrita_idempotente` | médio | ✅ | porteiro | ✅ disco | ✅ | OK |
| `abrir_aplicativo` | `escrita_nao_idempotente` | médio | ✅ | porteiro | ⚠️ `sem_meio` (declarado) | ✅ | OK |
| `acionar_energia` | `escrita_idempotente` | alto | ✅ | operador | ✅ pendência | ✅ | OK |
| `resolver_confirmacao` | `escrita_nao_idempotente` | alto | ✅ | operador + nonce | ⚠️ `sem_meio` (declarado) | ✅ | OK |
| `energia_da_maquina` (op. lógica) | `escrita_nao_idempotente` | alto | ✅ | operador + nonce | ⚠️ `sem_meio` | ✅ | OK |
| `enviar_whatsapp` | `escrita_nao_idempotente` | alto | ✅ | operador | declarado, sem provedor | ✅ | **desligada** |
| 9 habilidades de leitura | `leitura` | baixo | n/a | n/a | n/a | n/a (deliberado) | OK |
| **`WhatsApp.responder()`** | **escrita externa** | **não classificado** | ❌ | ❌ | ❌ | ❌ | **D3 — ABERTO** |
| `MemoriaOperacional.registrar` | escrita interna (histórico) | não classificado | ❌ | ❌ | ❌ | n/a | P2 |
| `BuscaWeb`, `Voz` (TTS) | leitura externa | baixo | n/a | n/a | n/a | n/a | OK |

Busca estrutural executada sobre `exec`, `spawn`, `fetch`, `mkdir`, `writeFile`,
`insert`, `update`, `delete`, `upsert` em `servidor/`.

---

## 11. Débitos restantes

**P0** — nenhum.

**P1**
1. **D3 — `WhatsApp.responder()` fora do Kernel.** Escrita externa sem operação,
   sem idempotência, sem verificador. Dedup de webhook é `Map` em memória por
   10 min: após restart, uma reentrega da Meta gera resposta duplicada.
   *Encaminhamento:* transformar a resposta do canal numa operação do jornal, com
   a `id` da mensagem da Meta como `origem_pedido`.
2. **Nonce não discrimina em produção** (§9). *Encaminhamento:* fazer o canal
   carregar a referência da operação na confirmação (botão na UI; `context.id` da
   mensagem no WhatsApp).

**P2**
3. `MemoriaOperacional.registrar` não declara semântica de efeito.
4. `appendFile` sem `fsync` — janela de perda em queda de energia.
5. Crash real (`SIGKILL`) nunca exercitado; só simulação.
6. `fecharOperacao` engole erro de transição e publica `FALHA`. Degrada para
   `desconhecida` via reidratação (lado seguro), mas sem teste dedicado.

**P3**
7. Sem trava entre processos no jornal.
8. Não existe lint no projeto. `npm run verificar` é `tsc + test`.
9. Jornal cresce indefinidamente; sem compactação nem retenção.

Nenhum débito foi omitido.

---

## 12. Conclusão

**A IARA pode executar ações de escrita reais com segurança arquitetural
suficiente?**

**Pelo catálogo de habilidades do Kernel — sim.** Quando a IARA diz "vou fazer",
existe uma operação identificada e gravada em disco antes do efeito. Quando diz
"está autorizado", existe uma autorização vinculada a essa operação, a esse
usuário, a essa conversa e a uma janela. Quando diz "executei", existe uma linha
de jornal anterior ao efeito. Quando diz "foi realizado", existe evidência de
verificador — e nenhuma outra fonte consegue produzir essa afirmação. Quando não
sabe, o estado é `desconhecida`, permanece `desconhecida`, e **bloqueia a
repetição** em vez de autorizá-la. Crash não inventa falha. Restart não inventa
autorização. A LLM não tem autoridade, e agora por **duas** razões independentes.

**Pelo sistema inteiro — não, por um caminho nomeado.** A resposta do canal
WhatsApp alcança uma pessoa por fora de tudo isso. É um caminho estreito e de
consequência limitada (mensagem duplicada ao próprio operador, não a um terceiro
errado), mas é uma escrita externa não auditada, e o critério de encerramento
exige que não exista nenhuma.

**Garantias internas:** identidade, deduplicação, máquina de estados, autorização
vinculada e persistida, regra de ouro do retry, verdade reconstruída do jornal.

**Garantias que dependem do provedor externo:** todas as de entrega. Nenhum
provedor foi ligado; nada de "exatamente uma vez" é reivindicado, e não será sem
prova do provedor.

---

### Nota sobre o método

As duas correções mais importantes deste trabalho — **F4** e **F5** — não vieram
da implementação. Vieram de **atacar a própria correção depois de a suíte estar
verde**: F4 apareceu perguntando "de quem é essa instância?", F5 apareceu porque
a prova de escrita quebrou num cenário que a suíte não cobria. E **F6** mostrou
um teste que passava com o mecanismo removido.

O teste de mutação — desligar cada trava e confirmar que algum teste cai — foi o
que separou "51 testes verdes" de "51 testes com dentes". Na primeira rodada,
**uma das seis mutações sobreviveu**.

> Não parei na primeira suíte verde. As correções foram atacadas duas vezes, e as
> duas rodadas encontraram defeito P0.
