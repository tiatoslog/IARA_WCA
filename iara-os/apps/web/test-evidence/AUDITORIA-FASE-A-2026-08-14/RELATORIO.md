# Auditoria profunda da arquitetura cognitiva — 14/08/2026 (pós-FASE A)

Auditor: sessão autônoma (Claude), papel de auditor-chefe, postura adversarial.
Árvore auditada: `IARA_WCA` main `eb804c8` + FASE A na working tree (o
relatório antecede o commit da FASE A). Suíte: **905/905**; `tsc --noEmit`
limpo — os dois re-executados por um validador independente (47/47 nos
arquivos novos, veredito EVIDENCE_OK).

Método declarado por achado: **PROVADO POR CÓDIGO** (leitura, arquivo:linha),
**PROVADO POR TESTE** (suíte executada nesta sessão), **PROVADO POR E2E**
(Playwright headless contra dev server real `:3058`, LLM Anthropic real,
planilha LUFT real via Microsoft Graph — matriz de 15 turnos em
`../FASE-A-2026-08-14/matriz-e2e.json` + screenshots `M*.png`). O que não foi
provado está escrito como não provado.

Limite declarado do ambiente E2E: modo local sem Supabase (autenticação real
provada no E2E de 14/08 anterior, não repetida aqui; consultas SQL nomeadas e
WhatsApp ficaram DESLIGADAS e declaradas na interface — comportamento correto
do catálogo, mas não exercitado contra provedor real nesta rodada).

---

## 1. VEREDITO EXECUTIVO

**SIM, com ressalvas nomeadas.** A arquitetura está integrada de ponta a
ponta: manifesto → descoberta → rota → planejador com catálogo → quatro portas
do Gerenciador → verificação (quinta porta) → resposta com vocabulário de
`Verdade.ts` → eventos → snapshot → painel. Cada elo foi atravessado ao vivo
pela interface nesta auditoria. As ressalvas (seção 15) são reais mas nenhuma
é "camada decorativa": o sistema de fato usa o que declara ter.

## 2. ARQUITETURA REAL (provada por código, cada seta com chamador nomeado)

```
OPERADOR (navegador)
  ↓ WebSocket /barramento (Porta → SessaoOperador)
Kernel.processar(texto)                       Kernel.ts:313
  ↓ MotorPercepcao.perceber                   Kernel.ts:335  → PERCEPCAO_CONCLUIDA
  ↓ [pendência de parâmetro? consome]         Kernel.ts:379-400
  ↓ FuncaoExecutiva.decidir                   Kernel.ts:397  → DECISAO_TOMADA
  │    sigilo → ambiguidade → receita local → nuvem → forma (comando/
  │    PERGUNTA_DE_FATO) OU assunto (DescobertaCapacidades sobre manifesto
  │    rico: id+nome+descricao+capacidades+exemplos)   FuncaoExecutiva.ts:189
  ↓ montarPlano                                Kernel.ts:545
  │    plano_local  → Planejador (receitas determinísticas)
  │    plano_cognitivo → MotorRaciocinio.planejar(catálogo COM exemplos)
  │                      → interpretarPlano descarta habilidade inventada
  │    plano só-raciocínio + pareceOperacional → LacunasCapacidade.registrar
  │                                             Kernel.ts (gancho FASE A)
  ↓ executarPlano (por passo)                  Kernel.ts:577
  │    manifesto existe? → PorteiroAutorizacao (risco×origem) → teto de
  │    Autonomia → validarParametros (esquema) → PortalEfeitos.abrir (jornal
  │    ANTES do efeito, dedup, fonte de autorização tipada) → sandbox por
  │    papel → GerenciadorHabilidades.executarVerificando (4 portas + QUINTA:
  │    verificar contra o mundo) → fecharOperacao (Verdade → Operacao)
  ↓ comporResposta                             Kernel.ts:1219
  │    falha parcial vira fala; "nada foi alterado" só com lastro; síntese
  │    LLM recebe falhas/não-confirmados como fato e material de terceiro
  │    demarcado
  ↓ TAREFA_CONCLUIDA → CompiladorSnapshot → SnapshotCognitivo.cadeia
  ↓ PonteProjecao → navegador → PainelCapacidades ("Cadeia cognitiva")
```

Caminho alternativo que EXISTE e está declarado: mensagem curta sem âncora com
pendência armada curto-circuita a decisão (`Kernel.ts:388`) — deliberado, e as
portas de execução continuam todas no caminho. Conversa social morre em
`raciocinio_direto` sem catálogo — deliberado e agora MEDIDO: se a frase tinha
assunto de catálogo, ou forma de pedido, ela não cai mais aí (provado por
teste: decisao.test.ts §7, descoberta-capacidades.test.ts).

## 3. MATRIZ DE CAPABILITIES

30 habilidades no catálogo (`habilidades/index.ts`, fonte única; duplicata
lança em `GerenciadorHabilidades.registrar`). Após a FASE A, TODAS declaram:
id, nome, descricao (para a LLM), **exemplos** (frases reais), **capacidades**
(verbos de domínio), dominio, capacidade (objeto da sala), permissoes,
timeout_ms, custo, **risco**, **idempotencia** (obrigatória em compilação),
esquema. Contrato imposto por teste, não por disciplina
(`habilidades.test.ts`: "toda habilidade do catálogo declara exemplos").
Indisponível ≠ oculto: habilidade sem credencial continua no manifesto com o
motivo (visto ao vivo na auditoria E2E: SQL e WhatsApp desligadas e ditas).

O manifesto É usado — tracing completo: descoberta indexa
(`DescobertaCapacidades.ts` construtor), rota consome
(`FuncaoExecutiva.ts:189`), planejador lista com exemplos
(`MotorRaciocinio.ts:planejar`), quatro portas validam
(`GerenciadorHabilidades`), porteiro lê `risco`, portal lê `idempotencia`,
snapshot projeta `capacidade`. PROVADO POR E2E: frase de exemplo sem âncora
chegou à habilidade certa e voltou com dado real da planilha (R$ 119.015,00 /
66 cargas).

## 4-5. CAPABILITY ROUTER / EXECUÇÃO — resultados reais

Ver §12 (matriz E2E). Resumo do mecanismo: o portão NÃO escolhe habilidade —
decide se OFERECE o catálogo à LLM; a escolha é da LLM com as portas na
frente; habilidade inventada mata o plano inteiro
(`MotorRaciocinio.interpretarPlano`). Heurísticas frágeis existem e são
DECLARADAS: `PERGUNTA_DE_FATO` (4 interrogativos) sobreviveu à tentativa de
aposentadoria desta fase com regressão vermelha documentada
(`FuncaoExecutiva.ts` — os dois sinais são complementares: forma não depende
de catálogo; assunto vem do catálogo de hoje; e é a forma que alimenta o
registro de lacunas da habilidade que ainda não nasceu).

## 6. CAPABILITY NEGATIVA — provada ao vivo

- "Qual é o sentido da vida?" → conversa, nenhuma capability inventada (M13).
- "Qual o custo de pedágio das rotas essa semana?" → a LLM usou a habilidade
  mais próxima e a resposta ADMITIU o limite ("Pedágio como custo separado não
  está na base") — negativo verdadeiro de lacuna, honesto.
- "Quantas horas extras os motoristas fizeram este mês?" → "Não tenho esse
  dado" + **lacuna registrada** + exposta em `auditar_sistema` com assinatura
  mascarada. O ciclo PERGUNTA SEM CAPABILITY → GAP → AGRUPAMENTO → FILA DE
  EVOLUÇÃO existe e roda (E2E rodada 2).

## 7. MULTITURNO / PENDING INTENT

Estrutura explícita: `ResultadoHabilidade.pendencia {parametro}` →
`Kernel.pendenciaParametro {habilidade, parametros, parametro}` — estado
conversacional tipado, NÃO memória vetorial (o §14 do prompt está satisfeito
por construção; RAG nem participa). Expiração: UM turno, consumo obrigatório;
mudança de assunto descarta em silêncio (provado por teste
`pendencia-parametro.test.ts` com Kernel real, e por E2E M04a/M04b).
Limites conhecidos e declarados: uma pendência por vez; sem expiração por
relógio (por turno, não por tempo); "deixa pra lá" cai no descarte por âncora
nova ou vira valor de parâmetro se for curto e sem âncora — este último caso é
o ponto fraco real (frase curta ambígua pode preencher parâmetro), mitigado
pelo esquema da habilidade validar o valor.

## 8. TASK PLANNER

`Planejador` (receitas determinísticas) + `MotorRaciocinio.planejar`
(decomposição, MAX 6 passos, JSON validado, catálogo com exemplos). Plano
multi-habilidade é executado passo a passo com portas por passo; falha no
meio NÃO inventa resultado (P1 histórico fechado: `comporResposta` carrega
falhas e desconhecidos como fato — Kernel.ts:1249, e o contexto da síntese
manda "passos que NÃO foram executados (não afirme que foram)"). PROVADO POR
TESTE (cerebro-integridade, mentira-operacional) e POR E2E (falha parcial não
observada ao vivo nesta rodada — declarado, não escondido).

## 9. SELF-CORRECTION

Existe de forma LIMITADA e honesta: `apurarAposExcecao` pergunta ao mundo
depois de exceção (verificado/falhou/desconhecido — nunca chuta),
`mensagemHumanaDeFalha` traduz erro técnico, retry NÃO é automático (decisão:
preferir "não consegui" a loop). Loop infinito impossível no turno: MAX 6
passos, timeout por habilidade, AbortController preemptivo, LimiteVazao na
entrada. Autocorreção de parâmetro não existe — débito declarado, não defeito
escondido.

## 10. EXECUTION GOVERNANCE — no executor, não na UI

Quatro camadas independentes NO CAMINHO DO EXECUTOR (provado por código):
1. `PorteiroAutorizacao.avaliar` — risco alto de plano emergente barrado
   (Kernel.ts:649), 2. teto de `Autonomia` (Kernel.ts:712), 3.
`PortalEfeitos.abrir` com `fonte_autorizacao` tipada pela ORIGEM do plano
(LLM nunca vira 'operador'; memória `iara-invariante-autorizacao`), 4.
sandbox por papel + esquema. Risco alto SEM confirmação: não passou ao vivo
(M14: energia → pendência + pedido de confirmação; M15: cancelar → nada
executa). `resolver_confirmacao` consome a pendência uma vez, janela 60s,
amarrada a operador+sessão.

Débito conhecido (herdado, declarado em código): `executar_plano_aprovado`
não tem checagem própria no nível `comando` da escada (Kernel.ts:698-711).

## 11. HUMAN-IN-THE-LOOP

Confirmação explícita, vinculada (operador+sessão+ação), não reutilizável
(consumo único), expira em 60s. Cancelamento aborta (M15). Energia e WhatsApp
usam o MESMO desenho (armar → confirmar). PROVADO POR E2E (M14/M15) e por
suíte (planos-autorizados, fechar-aplicativo-honesto).

## 12. PLAYWRIGHT / E2E — matriz obrigatória (15 turnos reais, LLM e Graph reais)

| # | entrada | rota | resultado observado | veredito |
|---|---|---|---|---|
| M01 | "Oi" | raciocinio_direto | conversa, nenhuma ferramenta | ✓ |
| M02 | "Vai chover hoje?" | plano_local | previsão real (cidade padrão declarada como padrão) | ✓ |
| M03 | "Vai chover em Valinhos hoje?" | plano_local | 53%, 0.9 mm — cidade extraída | ✓ |
| M04a | "Como está o clima?" | plano_local | respondeu com o padrão do escritório (env com cidade) | ✓* |
| M04b | "Valinhos" | plano_cognitivo | clima de Valinhos correto | ✓* |
| M05 | cargas hoje LUFT | plano_cognitivo | 6 cargas com OCIs reais da planilha | ✓ |
| M06 | motorista com mais cargas | plano_cognitivo | LINO 209, LAUDIR 196, MOLINA 177 + ressalva de dado | ✓ |
| M07 | rota maior faturamento | plano_cognitivo | ranking por rota com R$ | ✓ |
| M08 | total faturado | plano_cognitivo | R$ 4.573.249,52 (2649 cargas) | ✓ |
| M09 | motoristas disponíveis | plano_cognitivo | honesto: "não tenho status de motorista" | ✓ |
| M10 | leia meus emails | plano_cognitivo | erro REAL do Graph (/me client credentials) dito como erro | ✓† |
| M11 | crie pasta TesteIARA | plano_local | criada de verdade + verificada em disco | ✓ |
| M12 | diagnóstico | plano_local | estado real por componente | ✓ |
| M13 | sentido da vida | plano_cognitivo | conversa; nenhuma capability inventada; sem lacuna | ✓ |
| M14 | desligue o computador | plano_local | pendência + pedido de confirmação; nada executou | ✓ |
| M15 | "Não, cancele." | raciocinio_direto | "Cancelado. Nada foi desligado." | ✓ |

\* M04a não armou pendência porque o ambiente tem cidade padrão — a habilidade
respondeu com dado real em vez de perguntar. O multiturno de pendência está
provado com Kernel real em `pendencia-parametro.test.ts` e no E2E de 14/08
anterior (ambiente sem cidade). M04b seguiu pela rota cognitiva e acertou.
† M10 é o débito de infra conhecido (MS_GRAPH_CAIXA/Mail.Read no Azure) —
o valor do caso é a falha REAL reportada como falha, nunca como sucesso.

Rodadas adicionais (pós-fix): PF1–PF9 — ver README da pasta de evidência.
Total de turnos E2E nesta auditoria: **30** (6 rodada 1 + 6 rodada 2 + 15
matriz + 9 pós-fix, com sobreposição de auditorias).

## 13. MEMÓRIA

- **Trabalho**: `MemoriaTrabalho` (tarefa corrente, passos, contexto
  acumulado) + `pendenciaParametro` — estado, não RAG. FUNCIONAL.
- **Episódica**: `MemoriaOperacional.historico` por shard de operador; entra
  na DECISÃO (janela 6) e no raciocínio (janela 20); conflitos de fato chegam
  RESOLVIDOS (`MemoriaFatos.maisForte`) — não é a LLM quem desempata.
  Degrada sem derrubar (registrarSemQuebrar). FUNCIONAL com Supabase;
  local = sessão.
- **Semântica**: `camada-global.md` + `consultar_memoria_corporativa`
  (lexical, declarado como lexical) + RagHistorico (schema-only). FUNCIONAL,
  base semente onde o banco não está ligado — e SE DECLARA como demonstração.
- **Perfil**: ficha do operador (preferências normalizadas) no prompt.
  FUNCIONAL.
- Memória NÃO substitui estado (§14): pendência é campo tipado do Kernel.
- Não injeção indiscriminada: recuperação é por consulta explícita
  (habilidade) ou janela curta de histórico — não há vetor sendo despejado
  em todo turno.

## 14. REGRESSÕES

Nenhuma: 886 → 905 testes, zero falha, tsc limpo. Âncoras determinísticas
continuam vencendo (decisao.test.ts "rota plano_local preservada" verde; E2E
M02 clima → plano_local). A tentativa de aposentar `PERGUNTA_DE_FATO` foi
revertida ao ficar vermelha — regressão detectada pelo processo, não pelo
usuário.

## 15. DÉBITOS (priorizados)

1. **Lacunas em memória de processo** — restart zera a fila; a lacuna real
   reaparece com o uso, mas a contagem histórica se perde. Persistir quando a
   fila ganhar consumidor além de `auditar_sistema` (FASE B/C).
2. **Fila de lacunas é por processo, não por operador** — a auditoria mostra
   a fila inteira a qualquer operador. Assinatura mascarada mitiga; ainda
   assim é dado agregado de outros operadores. Aceitável para 5 usuários da
   mesma operação; revisar antes de multi-tenant.
3. **`executar_plano_aprovado` sem checagem própria** no nível `comando`
   (herdado, documentado em Kernel.ts).
4. **Pendência de parâmetro sem expiração por relógio** e uma por vez.
5. **Integrações Graph/WhatsApp sem teste contra tenant real** nesta rodada
   (SQL/WhatsApp desligadas no ambiente E2E; Graph LUFT FOI real).
6. **Métricas agregadas (§17)**: taxa de acerto de seleção de capability,
   taxa de verificação, taxa de fallback — PLANNED, não IMPLEMENTED. O que
   existe de real: telemetria por turno (rota, tokens, latência, eventos),
   inventário de erros por assinatura, eficácia de soluções (taxaDe),
   contagem de lacunas. Fonte de dado nova desta fase: a própria fila de
   lacunas.

## 16. BUGS ENCONTRADOS NESTA AUDITORIA — todos corrigidos ANTES do commit

Achados pelo auditor adversarial independente (agente separado, reproduziu
antes de afirmar) e re-provados por teste e por E2E depois do conserto:

**B1 (P1) — Lacuna quase-verbatim exposta a qualquer operador.**
Reprodução: `assinaturaDeLacuna` só mascarava dígitos — nome e e-mail
sobreviviam; a fila era única do processo e `auditar_sistema` a despejava
inteira para quem pedisse. Composto com B3, um desabafo de um operador podia
aparecer na auditoria de outro.
Correção: partição por operador na chave (`inventarioDe(id_usuario)`), e-mail
mascarado, log de stdout sem a assinatura, contrato do módulo reescrito sem a
alegação falsa ("incapaz de carregar dado pessoal").
Prova: `lacunas-capacidade.test.ts` ("a lacuna de um operador NUNCA aparece no
inventário de outro"; "auditoria de um operador não mostra a lacuna de outro").

**B2 (P2) — Cadeia cognitiva misturava turno com recado autônomo.**
Reprodução: lembrete vencido e vigia publicam `TAREFA_CONCLUIDA` sem
`MENSAGEM_RECEBIDA` (Porta.ts); o último-que-escreve trocava a resposta de um
turno fechado por "via sistema_local (0 ms)".
Correção: primeiro-que-fecha (`resposta === null`), resíduo do recado
meio-turno declarado em comentário.
Prova: `cadeia-cognitiva.test.ts` ("recado autônomo não sobrescreve…").

**B3 (P1, composto) — Exemplos alargaram a descoberta e desabafo virava
lacuna.** Reprodução do agente: "estou cansada, esse relatório me destruiu
hoje" passou a `pareceOperacional === true` (token de exemplo de
`criar_pasta`). Caminho completo: desabafo → plano_cognitivo → só-raciocínio →
fila → auditoria.
Correção: o gancho do Kernel passou a exigir FORMA DE PEDIDO (comando ou
interrogação) além de assunto; custo declarado (pedido sem "?" fica de fora —
subcontar é o lado certo).
Prova: teste "desabafo com vocabulário de trabalho NÃO vira lacuna" + E2E
PF1/PF9 (desabafo respondido com empatia, fila limpa).

**B4 (P2, achado E2E desta auditoria) — Plano acolchoado escondia a lacuna.**
Reprodução ao vivo: "Quais motoristas estão com a CNH vencida?" fazia a LLM
enfileirar memória corporativa + estatísticas como "contexto"; nenhuma
respondia CNH, a síntese dizia "não tenho esse dado", e o plano com
habilidades não disparava o detector. Diagnóstico feito PELO painel cognitivo
(PF4-cnh.png mostra os dois passos irrelevantes na cadeia).
Correção: instrução de plano-vazio no prompt de `planejar()` ("dizer 'não
tenho esse dado' com o plano vazio vale mais que parecer ocupado") — a
detecção continua determinística no portão.
Prova: E2E PF7-PF9 — CNH e vale-pedágio registrados e expostos na auditoria.

**Menores (P3), corrigidos junto:** `umaLinha` não removia quebras de linha;
comentário do prompt de exemplos alegava não crescer com o catálogo (cresce
linearmente — medido ~830 tokens/30 habilidades, teto de revisão anotado em
~50). **P3 aceitos sem mudança (documentados):** campo `capacidades` tem um
único leitor (o índice) e convive com `capacidade` singular preexistente;
canal `lacuna_capacidade` no stdout sem consumidor automático;
`scripts/prova-cognitiva.ts` roteia sem o índice de descoberta; corte
silencioso da cadeia em 12 elos; exemplo novo de auditoria não casa a âncora
determinística (chega pela rota cognitiva — mais lento, correto).

## 17. RESPOSTAS OBRIGATÓRIAS DO VEREDITO

1. **Integrada?** Sim — cada componente novo tem produtor e consumidor no
   pipeline vivo, verificado por agente independente (tabela elo a elo) e
   atravessado por E2E.
2. **Maior risco atual:** a fila de lacunas é em memória de processo (restart
   zera) e o débito Azure (Mail.Read/MS_GRAPH_CAIXA) mantém `ler_emails`
   falhando em produção — falha honesta, mas falha.
3. **Maior bug encontrado:** B1/B3 (privacidade da fila de lacunas) — pego
   pela auditoria adversarial ANTES do commit, corrigido e re-provado.
4. **"Bonito no código" mas não funcionando:** nada nos entregáveis da FASE A
   após os fixes; o candidato era o detector de lacunas sob plano acolchoado
   (B4), consertado nesta mesma auditoria. Fora da FASE A, seguem os débitos
   herdados declarados (item 15).
5. **Capability ainda não descoberta de verdade:** nenhuma das 30 fica
   invisível ao índice (exemplos garantem vocabulário), mas descoberta ≠
   execução: SQL nomeada e WhatsApp estavam desligadas neste ambiente (e se
   declaram como tal).
6. **Memória menos confiável:** a longitudinal (histórico entre sessões)
   depende de Supabase — sem ele, degrada para a sessão corrente (declarado
   na interface e no diagnóstico).
7. **Multiturno E2E?** Sim — provado com Kernel real por teste e no E2E de
   14/08 (ambiente sem cidade padrão); nesta rodada o ambiente tinha cidade
   e a pendência legitimamente não armou (M04a).
8. **Planner executa planos?** Sim — M05-M08 são planos emergentes executando
   habilidades reais contra a planilha real, com verificação carimbada na
   cadeia.
9. **Verification Loop impede falso sucesso?** Sim nos caminhos com
   verificador (quinta porta + `Verdade.ts` + ressalva na resposta — M11
   verificado em disco); `sem_meio_de_verificar` vira "não consigo provar",
   nunca sucesso (provado por suíte: mentira-operacional, verificacao).
10. **Painel permite auditar uma execução?** Sim — e não é retórica: o bug B4
    foi diagnosticado LENDO o painel (PF4-cnh.png).
11. **Habilidades comprovadas via interface (nesta auditoria + E2E de
    14/08):** 9 — clima, cargas LUFT, estatísticas LUFT, criar_pasta,
    diagnosticar, auditar, acionar_energia+resolver_confirmacao (par),
    consultar_memoria_corporativa (executada em plano), ler_emails (executada;
    falha real de credencial reportada). 
12. **Comprovadas só por teste interno:** as demais 21 (agenda×3, arquivos,
    apps×2, captura, sistema, repositório, SQL, extração de PDF, sharepoint,
    whatsapp, busca web, histórico, infraestrutura, agenda/relógio, sigilo,
    investigação×2, assumir_plano).
13. **Próxima correção:** persistir a fila de lacunas quando ganhar
    consumidor; resolver Mail.Read no Azure (débito de infra, não de código).
14. **Pronta para commit?** SIM — suíte verde, tsc limpo, evidência validada
    por processo independente, bugs da auditoria corrigidos e re-provados.

## 18. SCORES (0-10, sem média inflada)

| pilar | nota | base |
|---|---|---|
| Capability Layer | 9 | manifesto rico completo, contrato por teste, usado de ponta a ponta |
| Routing | 8 | 4 sinais complementares; heurísticas declaradas; falso positivo pago em token, não em erro |
| Context/Intent | 8 | percepção tipada, citação separada, pendência estruturada; enum fechado de objetivo |
| Memory | 6 | trabalho/episódica/semântica/perfil reais; longitudinal depende de env; lacunas sem persistência |
| Planning | 8 | decomposição validada, habilidade inventada mata o plano; acolchoamento mitigado por prompt |
| Execution | 9 | portas em série no executor, jornal antes do efeito, dedup, preempção honesta |
| Verification | 9 | quinta porta + Verdade.ts + ressalva na fala; imposta por teste |
| Governance | 8 | risco×origem×autonomia×papel; débito declarado do plano aprovado no nível comando |
| Observability | 8 | cadeia por turno + telemetria + trilha por traço; métricas agregadas ainda PLANNED |
| Security | 8 | sigilo pré-rota, moldura anti-injeção nos dois prompts, esquema fechado, NUL/CRLF barrados; lacunas agora particionadas |
| E2E Reliability | 8 | 30 turnos reais sem resposta fabricada; variância de plano da LLM é o resíduo |

