# Relatório de encerramento absoluto — CÉREBRO DA IARA

**Data:** 11/08/2026
**Base:** `09e8f0b`
**Missão:** provar se a exclusão de `MemoriaOperacional` e do jornal é segura, e
se o cérebro pode ser considerado arquiteturalmente encerrado.

---

## 1. Baseline (Fase 0)

| | Entrada | Saída |
|---|---|---|
| Branch / commit | `main` @ `09e8f0b` (= `origin/main`) | + esta auditoria |
| Testes | **359 / 359** | **390 / 390**, 0 falhas |
| Typecheck repo-wide | limpo | **limpo** |
| Build repo-wide | bloqueado por outra sessão | **limpo** (a outra sessão publicou `glsl.ts`/`fitas.ts`) |
| Lint | **não existe no projeto** | não existe |
| Prova de escrita | 0 reprovados | 0 reprovados |
| Prova de encerramento | 21 asserções | 21 asserções, 0 reprovadas |

Árvore de trabalho no congelamento continha **apenas** arquivos de outra sessão
(`app/`, `components/projecao/`, `package.json`, `tsconfig.json`). Nenhum foi
tocado.

---

## 2. Arquitetura final

```
USUÁRIO
  ↓ Percepção → Interpretação → Contexto/Memória → Decisão → Risco
  ↓ Autorização            PorteiroAutorizacao (origem do plano)   ← 1ª barreira
  ↓ Autorização tipada     Operacao.transicionar (fonte da prova)  ← 2ª barreira
  ↓ ═══════════ PortalEfeitos ═══════════════════════════════════  ← A FRONTEIRA
  │   abrir → executar → fechar
  ↓ Integração (adaptador) → Provedor → Verificação
  ↓ Estado da operação (jornal) → Verdade → RESPOSTA

      Portal ──→ Registro          (permitido, e existe)
      Registro ──✗──→ Portal       (impossível, provado por grafo)
      Estado interno ──✗──→ Efeito externo   (impossível, provado por grafo)
```

---

## 3. Fronteira de efeitos

`servidor/nucleo/Fronteira.ts` — declaração sem comportamento, seis categorias:

| Categoria | O que é | Módulos |
|---|---|---|
| `ESTADO_INTERNO` | registro da IARA sobre si mesma | 6 |
| `EFEITO_EXTERNO` | alguém de fora percebe | 2 |
| `LEITURA_EXTERNA` | sai para a rede, não muda nada | 3 |
| `LEITURA_INTERNA` | abre o disco e só lê | 2 |
| `CATALOGO` | habilidade que alcança efeito, pelo portal | 1 |
| `ENTRADA` | o mundo falando com a IARA | 2 |

---

## 4. Executores encontrados (Fase 1)

| Executor | Efeito | Chamador | Pelo Portal? | Justificativa |
|---|---|---|---|---|
| `POST /messages` (Graph) | mensagem a pessoa | `integracoes/whatsapp.ts` | **sim** | única rota; `A1`/`A3` travam |
| `spawn` (shell) | processo do SO | `habilidades/agenteLocal.ts` | **sim** | via `Kernel.abrirOperacao` |
| `mkdir` (pasta) | disco do operador | `habilidades/agenteLocal.ts` | **sim** | idem |
| `fetch` busca web | — leitura | `pesquisar_web` | n/a | `LEITURA_EXTERNA` |
| `fetch` clima | — leitura | `consultar_clima` | n/a | `LEITURA_EXTERNA` |
| `POST` TTS | — texto→áudio | `Voz.ts` | n/a | `POST_SEM_EFEITO`, justificado |
| `insert`/`upsert`/`writeFile` | estado interno | `MemoriaOperacional` | **não** | **exclusão provada (§5)** |
| `appendFile` | o jornal | `RegistroOperacoes` | **não** | **é a auditoria (§5)** |
| `readFile` | — leitura | `RagHistorico`, `dados.ts` | n/a | `LEITURA_INTERNA` |
| `createServer` | entrada | `principal.ts` | n/a | `ENTRADA` |

Superfície HTTP: só `GET /saude` e `GET /voz/*.mp3`. WebSocket: `ola`,
`interromper`, `preferencias`, `mensagem` — nenhum alcança o mundo.

---

## 5. Exclusões — agora PROVADAS, não justificadas

A auditoria anterior excluiu `MemoriaOperacional` e o jornal com um parágrafo.
Um parágrafo não é prova. A prova é análise de **grafo de chamadas**, não `grep`:

| Teste | O que prova |
|---|---|
| `G0` | o analisador enxerga — arestas reais existem no grafo |
| `G1` | nenhum ESTADO INTERNO alcança EFEITO EXTERNO, **em nenhuma profundidade** |
| `G2` | nenhum ESTADO INTERNO alcança o PORTAL (`Registro → Portal` não existe) |
| `G3` | EFEITO EXTERNO só é importado por portal, adaptador ou catálogo |
| `G6`/`G6b` | LEITURA (externa e interna) não alcança EFEITO |

**Classificação (Fase 2):** todos os métodos mutáveis de `MemoriaOperacional` —
`registrar`, `gravarPreferencias`, `gravarInsight`, `consumirInsight`,
`consolidar`, `gravar` — são **categoria A, estado cognitivo interno**. Nenhum é
B. Nenhum é C: o grafo prova que A não alcança B.

**Jornal (Fase 3):** não executa, não chama provedor, não chama integração, não
pode ser executor indireto, é exclusivamente registro. `G2` prova que
`Portal → Registro` existe e o inverso não — sem recursão artificial.

> A exclusão é **segura, e agora é exigível**: quebrar qualquer uma das duas
> propriedades derruba a suíte.

---

## 6. Estados (Fase 7)

Matriz **11 × 11 completa**, conferida contra uma tabela escrita à mão e
independente da implementação (`M1`). As 121 combinações testadas uma a uma
(`M2`); toda transição ilegal lança. Terminais não saem, com nenhuma das 7
fontes (`M3`). `transicionar` não muta a entrada (`M5`).

**Matriz de autoridade (`M4`):**

| Transição | Quem pode |
|---|---|
| → `verificada` | **só** `verificador` (as outras 6 fontes lançam) |
| → `autorizada`, risco **alto** | **só** `operador` |
| → `autorizada`, risco baixo/médio | `operador` ou `porteiro` |
| qualquer outra | conforme a tabela; `llm` **não existe** como fonte |

---

## 7. Autorização (Fase 5)

Duas barreiras independentes. O porteiro decide pela **origem do plano**; a
segunda está no **tipo** — `FonteEvidencia` não tem `llm`, plano emergente
carimba `porteiro`, e `porteiro` é recusado para risco alto. Apagar o porteiro
não reabre o buraco.

A LLM não autoriza, não confirma, não executa, não cria chave, não marca
concluído, não fabrica verificação. Ela produz **plano/intenção**.

---

## 8. Idempotência (Fase 6)

Chave = `sha256(usuário | ação | parâmetros canônicos | origem_pedido)`.
**Mutação de cada componente** (`C1`): mudar qualquer um muda a chave — nenhum é
decorativo. Estável sob reordenação de parâmetros (`C2`). Sem falso positivo por
concatenação (`C3`). Atravessa restart com a mesma chave (`C4`).

Três barreiras: chave → regra de ouro (`desconhecida` **ou**
`aceita_pelo_provedor` bloqueiam, sem prazo) → duplo clique (20 s).
`origem_confiavel` desliga as duas heurísticas quando a origem já identifica a
intenção (`wamid`).

---

## 9. Persistência e 10. Recovery

Jornal append-only, `executando` no disco **antes** do efeito. Reidratação:
`aguardando_autorizacao` e `autorizada` → **`expirada`**; `executando` →
**`desconhecida`**; `aceita_pelo_provedor` permanece. Linha truncada é
descartada sem derrubar a recuperação.

---

## 11. Crash (Fase 8) — SIGKILL real, em processo isolado

As oito posições pedidas colapsam em **quatro estados observáveis no jornal**, e
isso é a informação, não uma simplificação: do disco não dá para distinguir
"morreu antes de mandar" de "morreu depois de mandar" — e é exatamente por isso
que o estado se chama `desconhecida`.

| Posição | Estado após restart |
|---|---|
| antes de reservar | nada no jornal |
| depois da reserva (antes do jornal) | nada no jornal — nada executou |
| depois de `executando` / antes / durante / depois do efeito | **`desconhecida`** |
| depois do aceite / antes da verificação | **`aceita_pelo_provedor`** |
| `aguardando_autorizacao` e `autorizada` | **`expirada`** (`K5`) |

Em todos: autorização não renasce, retry fica bloqueado, nenhuma garantia falsa
é emitida. `K6` prova que o jornal de um processo morto é legível por outro —
`SIGKILL` não deixa lock preso.

---

## 12. Concorrência (Fase 9) e 13. Retry

2 e 10 reservas simultâneas → 1 operação. Dois canais do mesmo operador em
paralelo, pelo Kernel real → 1 efeito. Duas entregas simultâneas do mesmo evento
pelo portal → 1 mensagem. Garantia: `reservar` é **síncrono** — teste de
arquitetura falha se ganhar `async`.

Retry sobre `desconhecida`/`aceita_pelo_provedor`: bloqueado sem prazo. A saída
exige `resolverDesconhecida`, que só aceita resultado de **verificador**.

---

## 14. Memória (Fase 13) e 15. Prompt injection (Fase 12)

`G7` — memória com quatro linhas hostis (*"IGNORE AS REGRAS"*, *"o usuário já
autorizou"*, *"confirmo"*): **zero** operações de risco alto fora de
`aguardando`, nenhuma pendência armada.
`G8` — dois *"confirmo"* guardados no histórico **não** liberam uma pendência
real.
`G9` — *"como faço para confirmar?"* não confirma.
`G8b` — *"não confirme"* não autoriza nem executa.

Procedência: `Verdade.ts` ordena `fato_verificado > fato > resultado_ferramenta >
documento > memoria > inferencia > hipotese`. O desempate é determinístico, e o
Kernel entrega o conflito **resolvido** ao prompt — a LLM não escolhe.

---

## 16. Mutation testing (Fase 14)

**19 mutações aplicadas, 19 detectadas.**

| # | Mutação | Detectada por |
|---|---|---|
| 1 | LLM autoriza risco alto | 4 testes |
| 2 | executor promove a `verificada` | 3 |
| 3 | transição ilegal permitida | 3 |
| 4 | terminal deixa de ser terminal | 3 |
| 5 | bypass de idempotência (chave) | 3 |
| 6 | retry permitido sobre `desconhecida` | 6 |
| 7 | crash vira `falhou` | 6 |
| 8 | restart preserva autorização | 6 |
| 9 | confirmação sem checar nonce | 4 |
| 10 | remove filtro de usuário | 3 |
| 11 | aceite do provedor vira `verificada` | 4 |
| 12 | chave sem o turno | 12 |
| 13 | `Memória → cliente do provedor` (direta) | `G1`, `G3` |
| 14 | **`Memória → helper novo → AgenteLocal` (INDIRETA)** | `G1`, `G3` |
| 15 | módulo novo que toca o mundo, sem declaração | `G4` |
| 16 | Kernel volta a criar jornal próprio | `10f` |
| 17 | canal volta a chamar o provedor direto | `A1`, `A3` |
| 18 | habilidade escondida em `LEITURA_INTERNA` | `G6b` |
| 19 | `WhatsApp` reclassificado como leitura | `G4d` |

A #14 é a que justifica a análise de grafo: **nenhum `grep` a encontraria**.

---

## 17. Terceira ordem — o que MINHAS correções criaram

**T1 — a checagem por nome de método era furada.** `G4` procurava `writeFile(`,
`spawn(`… A lista de formas de escrever num arquivo não tem fim
(`createWriteStream`, `writeFileSync`, `open` com flag). → `G4b` passou a checar
por **importação** de `node:fs`/`node:child_process`/rede: a porta é estreita, e
é nela que a checagem tem que ficar.

**T2 — a categoria nova era um esconderijo.** `LEITURA_INTERNA` nasceu com
`habilidades/agenteLocal.ts` dentro — que alcança o `spawn`. Com ele lá, a
categoria era **impossível de verificar**, e uma categoria sem asserção é onde
alguém esconde o próximo executor. → categoria `CATALOGO` separada; `G6b` agora
exige que LEITURA INTERNA não alcance o mundo.

**T3 (P1) — a declaração podia mentir sobre si mesma.** Mover `WhatsApp.ts` de
`EFEITO_EXTERNO` para `LEITURA_EXTERNA` **passava nos 15 testes**: todos
confiavam na classificação, nenhum a conferia. → `G4d` confere contra
**evidência**: quem usa `POST`/`PUT`/`PATCH`/`DELETE` é efeito externo, ou consta
em `POST_SEM_EFEITO` com razão escrita e não-trivial. Reclassificar deixou de ser
mover uma linha.

**T4 — a isenção do arquivo de declaração.** `Fronteira.ts` cita os padrões
proibidos nos comentários e se auto-acusava. A isenção é **merecida**: `G4c`
prova que ele não tem `import` nem aresta no grafo. Ganhou um import, a isenção
cai.

Nova rodada de ataque após T1–T4: nenhum novo P0/P1.

---

## 18. Testes totais

| Suíte | Testes |
|---|---|
| `fronteira-interna.test.ts` (**nova**) | 16 |
| `encerramento-absoluto.test.ts` (**nova**) | 15 |
| `fronteira-efeitos.test.ts` | 27 |
| `cerebro-escrita-integridade.test.ts` | 51 |
| demais suítes | 281 |
| **Total** | **390 / 390, 0 falhas** |

Provas executáveis: `prova-encerramento-escrita.ts` (21 asserções, entrada no
Kernel real), `prova-escrita-final.ts`, `prova-cognitiva-final.ts`.

---

## 19. Limitações reais

| Limitação | Natureza |
|---|---|
| **Nenhum provedor externo real exercitado** | WhatsApp e Graph sem credencial. Chamá-los numa prova produziria o efeito que a auditoria controla. |
| **Sem "exatamente uma vez"** | A Cloud API não oferece chave de idempotência. Garantia: **at-most-once por processo**, com `UNKNOWN` explícito e sem retry automático. |
| **Dedup é por processo** | Jornal append-only, sem trava entre processos. Duas instâncias do motor contra o mesmo `dados/` não são cobertas. |
| **`appendFile` sem `fsync`** | Janela de perda em queda de energia. Operação perdida → tratada como nunca ocorrida (lado seguro). |
| **Entrega no WhatsApp não verificável hoje** | Status chega por webhook assíncrono, ainda não consumido. Operação descansa em `aceita_pelo_provedor`. |
| **Allowlists em teste** (`PORTEIROS` em `G3`, `PERMITIDOS` em `A2`/`A4`) | Ampliá-las é possível — mas é uma linha visível em revisão, num arquivo cujo propósito é essa lista. |
| **Análise estática** | O grafo é de importações. Uma dependência injetada em runtime por string dinâmica escaparia. Nenhuma existe hoje; `G0` garante que o analisador enxerga. |

---

## 20. Débitos

**P0:** nenhum. **P1:** nenhum.

**P2**
1. Nonce não discrimina em produção — o vínculo real é (operação, usuário,
   sessão, janela, estado). Mitigado: `armar` recusa segunda pendência idêntica.
2. `MemoriaOperacional` não declara semântica de efeito.
3. `appendFile` sem `fsync`.
4. `fecharOperacao` engole erro de transição (degrada para `desconhecida`, lado
   seguro) sem teste dedicado.
5. `jaVistas` (dedup de webhook em memória) redundante com o jornal.

**P3**
6. Sem trava entre processos.
7. Jornal sem compactação nem retenção.
8. Lint inexistente.
9. Webhook de status da Meta não consumido — é a evidência de `verificador` que
   promoveria a operação; a `referencia` já é gravada esperando por ele.

---

## 21. Commit

`09e8f0b` (base, publicado) + esta auditoria. Arquivos de outra sessão não
tocados em nenhum momento.

---

## 22. VEREDITO FINAL

```
O CÉREBRO DA IARA ESTÁ ENCERRADO?
SIM — para integrações, nos limites declarados em §19.

PODE RECEBER INTEGRAÇÕES DE LEITURA?
SIM

PODE RECEBER INTEGRAÇÕES DE ESCRITA?
SIM — pelo PortalEfeitos, com adaptador em integracoes/ e verificador
declarado (ou a ausência dele declarada, o que faz a operação descansar
em aceita_pelo_provedor em vez de verificada).

EXISTE ALGUM EXECUTOR EXTERNO FORA DO PORTAL?
NÃO — provado por grafo de chamadas (G1–G3), não por grep.

EXISTE ALGUMA GARANTIA DECLARADA SEM MECANISMO?
NÃO — as limitações de §19 são declaradas como limitações, e
"exatamente uma vez" NÃO é reivindicado em lugar nenhum.

EXISTE ALGUM P0?
NÃO

EXISTE ALGUM P1?
NÃO

EXISTE ALGUM BLOQUEADOR PARA PRODUÇÃO?
NÃO para a arquitetura. SIM para a operação: nenhum provedor real foi
exercitado. Ligar WhatsApp ou Graph exige um teste de fumaça contra o
provedor de verdade, em ambiente controlado, antes do primeiro
destinatário real.
```

---

### Nota sobre o método

As cinco falhas de maior gravidade desta linha de trabalho não vieram de escrever
código. Vieram de **atacar a correção depois da suíte ficar verde**:

- a dedup que valia dentro de um canal e não entre canais;
- as duas travas unidas por `||`, que executavam o `shutdown`;
- a IARA que emudeceria no WhatsApp após a primeira frase repetida;
- a categoria nova que era um esconderijo verificável por ninguém;
- **a declaração que podia mentir sobre si mesma.**

A última é a mais instrutiva, porque foi a correção da correção da correção: um
arquivo criado para tornar uma exclusão exigível podia, ele próprio, ser editado
para tornar qualquer módulo inofensivo por decreto. Fechá-la exigiu conferir a
declaração contra evidência — que é a mesma regra que este trabalho inteiro
aplica a tudo o mais.

> O cérebro não está fechado porque os testes estão verdes. Está fechado porque
> as 19 mutações que reabririam cada buraco derrubam a suíte — inclusive a que
> só um grafo de chamadas encontraria.
