# IARA — ESPECIFICAÇÃO DO PROJETO (v2, aprimorada)

Assistente Operacional Inteligente • Arquitetura, Produto e Personalidade
Documento-base para arquitetura, desenvolvimento e implementação — revisão sobre a especificação conceitual original, agora ancorada no código existente do `iara-os`.

---

## O que mudou nesta versão (resumo executivo)

1. **Evoluir, não recomeçar.** A especificação original descreve o sistema como se fosse greenfield, mas o repositório `IARA_WCA/iara-os` já implementa cerca de um terço do que ela pede: motor cognitivo com roteador determinístico (que já resolve ~80% das intenções sem gastar tokens — exatamente o "princípio central" da seção 2), estado atômico com trava, RAG com contrato de privacidade, teoria da mente, voz, snapshot agnóstico de renderizador, Supabase e PWA. A v2 mapeia cada componente da spec para o que existe e define apenas o **delta** a construir.
2. **Contrato de ferramentas formalizado** — a spec original listava as ferramentas, mas não dizia como uma ferramenta se declara, pede permissão, é versionada ou falha. Agora há um manifesto formal (seção 19).
3. **Modelo de risco e confirmação em 4 níveis (R0–R3)** — substitui a regra vaga "confirmação para ações destrutivas" por uma política verificável (seção 18.2).
4. **Protocolo agente↔backend especificado** — identidade por dispositivo, pareamento, revogação, fila offline e o princípio "o agente puxa tarefas; nunca abre porta de entrada" (seção 22).
5. **Política de escalonamento de modelos e orçamento de custo** — três camadas: roteador local → modelo rápido para classificação → modelo forte para planejamento (seção 20).
6. **Pipeline de memória concreto** — promoção sessão → operacional → conhecimento com aprovação humana, esquema de tabelas, TTL e direito ao esquecimento (seções 9–10).
7. **Riscos assumidos explicitamente** — WhatsApp, automação de Office via COM e captura de tela têm riscos reais que a spec original não nomeava; agora cada um tem decisão e mitigação (seção 28).
8. **LGPD como requisito estrutural** — a IARA processa dados de terceiros (motoristas, clientes, conversas); minimização, retenção e base legal entram na arquitetura, não como etapa posterior (seção 18.4).
9. **Critérios de sucesso mensuráveis** — a seção 24 vira métricas com número, não frases de intenção.
10. **Roadmap reordenado** — as fases agora partem do que já existe e cada uma tem entrega testável e critério de aceite (seção 23).

---

## 1. Visão do projeto

*(mantida da v1, com um acréscimo)*

IARA não deve ser construída como um simples chatbot. Ela deve funcionar como uma camada de inteligência operacional entre o usuário e o computador, os sistemas corporativos e os serviços digitais. Seu papel é compreender objetivos, decidir como executá-los, acionar ferramentas, acompanhar a execução, registrar resultados, aprender com ocorrências e agir proativamente quando houver valor real para o usuário.

A inspiração funcional é uma combinação de assistente pessoal avançado, automação de desktop e uma central operacional. A inspiração visual pode remeter a JARVIS: presença constante, elegante e tecnológica, sem depender de um avatar humano ou de um MetaHuman.

**Acréscimo v2:** a IARA já tem uma identidade visual e conceitual construída — o "escritório digital vivo" do `iara-os` (sala em pixel art + presença 3D, ambas alimentadas pelo mesmo `SnapshotCognitivo`). O desktop não substitui essa identidade; ele é uma **terceira projeção** do mesmo kernel. A pergunta de design continua sendo a do CLAUDE.md do repositório: *"que objeto da sala é isto?"*, nunca *"que componente de dashboard preciso?"*.

## 2. Princípio central: IA não é o centro

*(mantido — e já validado em produção no código)*

O diferencial é a arquitetura: a IA é um componente do sistema, enquanto o núcleo operacional executa ações determinísticas sem consultar um modelo de linguagem a cada passo.

- Ações determinísticas são executadas por ferramentas locais e serviços próprios.
- Modelos de linguagem são usados quando há necessidade real de interpretação, planejamento, resumo, classificação ou raciocínio.
- A IARA mantém estado, tarefas, histórico, memória e resultados independentemente do provedor de IA.
- O sistema permite trocar Anthropic/Claude por outro modelo sem reescrever a plataforma.
- O agente local executa ações no computador com permissões explícitas e controle de segurança.

**Evidência no código:** o `RoteadorIntencoes` (Camada 1) já decide em microssegundos, sem gastar um token, para onde cada mensagem vai. A v2 estende esse princípio ao desktop: *antes de chamar um modelo, o orquestrador verifica se a tarefa casa com uma ferramenta determinística* (seção 20).

**Invariante herdado do código, agora promovido a requisito da spec:** **a LLM não escreve estado.** Ela emite intenções estruturadas; o `EstadoAtomico` valida e aplica sob trava. Intenção inválida é descartada com log, nunca aplicada pela metade. Esse mesmo padrão vale para o agente local: a LLM propõe um plano; quem executa e escreve resultado é o núcleo determinístico.

## 3. Arquitetura proposta — mapeada sobre o existente

| Camada (spec v1) | Situação no `iara-os` | Delta a construir |
|---|---|---|
| Motor Cognitivo/Orquestrador | **Existe** — `servidor/nucleo` (EstadoAtomico, RoteadorIntencoes, OrquestradorAcoes, TeoriaDaMente, RagHistorico, CicloAutonomo) | Evoluir `OrquestradorAcoes` para planos multi-etapas **persistidos** (hoje o plano vive em memória do processo) |
| Interface Desktop (bolha, chat, painel) | Não existe | App Tauri: bolha flutuante nativa + webview reutilizando as projeções web existentes via `SnapshotCognitivo` |
| Agente Local (executa no SO) | Não existe | Sidecar do Tauri (Rust) com as ferramentas da seção 19 |
| Camada de Ferramentas | **Parcial** — manifesto de capacidades em `lib/capacidades.ts` (6 domínios) | Formalizar o contrato de ferramenta (seção 19) e separar ferramentas de nuvem × ferramentas locais |
| Backend | **Existe** — servidor próprio (porta 8787) + Supabase (Autenticacao, ClienteSupabase) | Fila de tarefas para agentes, registro de dispositivos, auditoria |
| Banco de dados | **Existe** — Supabase/PostgreSQL, com shards privados por usuário | Tabelas novas: `tarefas`, `etapas`, `dispositivos`, `permissoes`, `auditoria`, `artefatos` (seção 8.2) |
| PWA/Workspace Web | **Existe** — app Next com service worker (`RegistrarPWA`) | Painéis de administração: dispositivos, permissões, auditoria |
| Modelo de IA intercambiável | **Parcial** — `ClienteClaude` é um módulo único | Extrair interface `ProvedorIA` (chat, classificação, embedding, STT/TTS) e fazer `ClienteClaude` ser a primeira implementação |

**Regra de fronteira (herdada e mantida):** o `SnapshotCognitivo` continua sendo **a única coisa** que atravessa a fronteira do kernel. A bolha do desktop, o painel Tauri e o PWA são consumidores do snapshot — nenhum deles conhece módulo interno do servidor. Trocar de projeção não muda uma linha do servidor.

## 4. Stack

| Componente | Tecnologia/estratégia | Observação v2 |
|---|---|---|
| Frontend/PWA | Next.js/React | Já em uso |
| Desktop | Tauri (Rust + webview) | O webview **reaproveita** os componentes React existentes; o código Rust fica restrito a: bolha nativa, atalho global, bandeja, auto-update e agente local |
| Backend/Banco | Servidor Node próprio + Supabase/PostgreSQL | Já em uso; pgvector para embeddings de memória |
| Deploy Web | Vercel | — |
| Código | GitHub | Monorepo: `apps/web`, `apps/desktop`, `packages/contratos` (tipos compartilhados) |
| Comunicação | WebSocket (já existe: `PonteProjecao`/`SessaoOperador`) | O agente local usa o **mesmo barramento**, com identidade de dispositivo |
| IA | Anthropic inicialmente, atrás da interface `ProvedorIA` | Três funções distintas: classificar (modelo rápido/barato), planejar+raciocinar (modelo forte), embeddings |
| Voz | STT/TTS desacoplados (`Voz.ts` já existe) | Mover para trás de `ProvedorIA.voz` para permitir troca |
| Atualização do agente | Tauri Updater com assinatura | Requisito de segurança, não conveniência: agente desatualizado é superfície de ataque |

## 5. Aplicativo Desktop

*(mantido, com precisões)*

O aplicativo desktop dá à IARA acesso controlado ao computador. Não é um segundo PWA: é um aplicativo instalado no Windows, com instalador simples (MSI/NSIS via Tauri), login e autorização de capacidades **uma a uma** no primeiro uso (modelo de consentimento progressivo, como permissões de celular).

O agente deve ser capaz de, progressivamente:

- Criar, ler, mover, copiar, renomear e organizar arquivos e pastas **dentro de raízes autorizadas** (o usuário marca pastas-raiz; fora delas o agente não enxerga).
- Executar scripts **previamente registrados e com hash conferido** (seção 18.3).
- Abrir aplicações e arquivos.
- Interagir com recursos do Office (estratégia na seção 28.2).
- Capturar tela ou áreas autorizadas para análise (estratégia na seção 28.3).
- Executar rotinas locais agendadas.
- Monitorar eventos autorizados (pasta observada, processo, janela).
- Desligar, reiniciar ou suspender o computador — sempre R2 (confirmação explícita).
- Receber tarefas do orquestrador e devolver status, resultado e erros estruturados.

**Precisão v2 — modo offline:** sem rede, o agente continua aceitando comandos determinísticos locais (abrir app, criar pasta, rodar script registrado) via bolha; enfileira telemetria e sincroniza ao reconectar. A dependência de nuvem é da *cognição*, não da *execução*. Isso segue o padrão já existente: sem `ANTHROPIC_API_KEY`, o sistema roda completo em modo local **e avisa isso na interface** em vez de improvisar.

## 6. Interface da IARA

*(mantida integralmente: bolha flutuante arrastável, atalho global, entrada/saída por texto e voz, painel de tarefas, área de resultados, histórico, indicador de estado, workspace 2.5D opcional)*

**Precisões v2:**

- O indicador de estado da bolha **é uma projeção do `EstagioCognitivo`** que o kernel já publica — não inventar uma máquina de estados paralela no desktop.
- Vale para a bolha o invariante das duas famílias de animação: *ambiente* (nunca reage a dado, nunca para) e *reativa* (só muda porque um campo do estado mudou). Misturar as duas faz a bolha mentir.
- Movimento calmo (ciclos 4–20 s, piso ~0,8 s mesmo em "pensando") e **nunca vermelho saturado** — alerta é coral quente. São invariantes de identidade já estabelecidos.

## 7. Modelo de interação

*(exemplos mantidos)* — “IARA, envie bom dia para o motorista Devair no WhatsApp.” • “extraia um relatório das cargas de hoje” • “rode o script de anexar comprovante” • “crie uma pasta chamada Contratos na área de trabalho” • “desligue meu computador” • “analise esta planilha” • “gere um relatório de vendas e envie para meu chefe” • “esse erro já aconteceu antes?”

**Acréscimo v2 — classificação de cada exemplo por rota e risco**, para que os exemplos sirvam de casos de teste:

| Comando | Rota | Risco |
|---|---|---|
| Criar pasta | Roteador local → FileSystemTool | R1 |
| Desligar computador | Roteador local → PowerTool | R2 (confirmação) |
| Rodar script registrado | Roteador local → ScriptTool | R1 ou R2 conforme registro |
| Enviar WhatsApp | Plano (IA valida destinatário/mensagem) → MessagingTool | R3 (política + confirmação) |
| Extrair relatório de cargas | Plano → ferramenta de dados + ReportTool | R1 |
| Analisar planilha | IA + leitura de arquivo | R0 |
| Gerar relatório e enviar ao chefe | Plano multi-etapas (seção 8) | R1 + R3 na etapa de envio |
| "Esse erro já aconteceu?" | Roteador local → RAG/Memória (+ IA se precisar sintetizar) | R0 |

## 8. Orquestração e planos

Uma solicitação complexa é representada como **objetivo + plano + etapas + ferramentas + estado + resultado**, nunca como uma única chamada de IA.

### 8.1 Ciclo de vida de uma tarefa

```
recebida → planejada → aguardando_aprovacao? → executando → revisando → concluida
                                    ↘ rejeitada          ↘ falhou → replanejada (máx. N) → falhou_definitivo
                                                          ↘ cancelada (usuário pode cancelar em qualquer estado)
```

- Cada **etapa** referencia exatamente uma ferramenta, com entrada e saída tipadas pelo contrato da ferramenta.
- Etapas R2/R3 pausam o plano em `aguardando_aprovacao` — a aprovação chega pela bolha, pelo painel ou pelo PWA.
- Replanejamento é limitado (padrão: 2 tentativas) e **sempre registra** o motivo da falha na memória operacional — é daí que sai o aprendizado da seção 11.
- Falha de uma etapa não destrói o plano: o orquestrador decide entre repetir a etapa, replanejar a partir dela ou abortar, conforme a taxonomia de erro (transitório / permissão / dado inválido / ferramenta indisponível).

### 8.2 Modelo de dados (Supabase)

Tabelas novas mínimas: `tarefas` (objetivo, origem, estado, plano_versao, criada_por, dispositivo_alvo), `etapas` (tarefa_id, indice, ferramenta, entrada, saida, estado, erro, iniciada_em, concluida_em), `artefatos` (tarefa_id, tipo, caminho/URL, hash, origem_dados), `dispositivos`, `permissoes`, `auditoria`. Campos em `snake_case` português, seguindo o invariante de nomenclatura do repositório.

O `PlanoProjetado` que o snapshot já publica (objetivo, origem `deterministico|emergente`, passos, passo atual) passa a ser a projeção de leitura dessas tabelas — o contrato visual não muda.

## 9. Memória da IARA

*(tipologia mantida: sessão, operacional, histórica, conhecimento/procedimentos, preferências)*

**Acréscimo v2 — implementação concreta:**

| Tipo | Onde vive | Retenção | Como entra |
|---|---|---|---|
| Sessão | Memória do processo + snapshot | Termina com a sessão | Automática |
| Operacional | Tabelas `tarefas`/`etapas`/`artefatos` | 12 meses (configurável) | Automática — toda tarefa executada |
| Histórica | Tabela `ocorrencias` + embedding (pgvector) | Indefinida, com revisão anual | Automática para erros; sob sugestão para o resto |
| Conhecimento | Tabela `procedimentos` + documentos + embedding | Indefinida | **Somente com aprovação humana** (pipeline abaixo) |
| Preferências | Tabela `preferencias` | Até o usuário mudar | Explícita ("prefiro X") ou confirmada ("notei que você sempre faz X — salvo como preferência?") |

**Pipeline de promoção:** sessão → (classificador, seção 10) → operacional/histórica → (detecção de recorrência) → *sugestão* de conhecimento → aprovação do usuário → procedimento reutilizável. Nada vira conhecimento permanente sem passar pelo usuário — este é o mesmo princípio da seção 11 (aprender operacionalmente, nunca por auto-modificação).

**Invariante herdado do RAG existente, mantido como requisito:** o RAG **nunca injeta log bruto** no contexto — só hash, assinatura sintática de uma linha e a resolução adotada. É o contrato que protege contexto, custo e privacidade ao mesmo tempo.

## 10. Política inteligente de memória

*(mantida integralmente)* Regras simples para os casos óbvios; IA apenas quando a classificação exigir interpretação. Conversa cotidiana não persiste; tarefa executada vai ao histórico operacional; erro vira ocorrência estruturada (data, contexto, causa, solução, resultado); procedimento recorrente vira sugestão de conhecimento; preferência explícita é salva; informação ambígua não é assumida.

**Precisão v2:** o classificador de memória usa o **modelo rápido** da política de escalonamento (seção 20) — classificar memória com o modelo forte é desperdício estrutural.

## 11. Aprendizado com erros e melhoria contínua

*(mantido integralmente)* — registrar tentativa, ferramenta, resultado, erro e resolução; identificar padrões; sugerir automações; usuário aprova, rejeita ou edita; soluções aprovadas viram procedimentos reutilizáveis. A IARA aprende operacionalmente, **não** por alteração automática do próprio código.

**Acréscimo v2:** a detecção de padrões roda no `CicloAutonomo` já existente (processo em segundo plano), sobre a memória operacional — não em tempo de conversa. Sugestões aparecem como notificação informativa (nível 1 da seção 13), nunca interrompem.

## 12. Proatividade

*(mantida)* Detectar recorrências e sugerir automação; avisar sobre falhas relevantes; lembrar tarefas importantes; acompanhar processos que a própria IARA iniciou; escalar quando realmente urgente.

**Regra v2 que resume a seção:** proatividade **sugere, nunca executa**. Toda ação proativa de efeito externo nasce como sugestão aguardando aprovação — exceto as que o usuário já transformou em rotina aprovada.

## 13. Comunicação e escalonamento

*(mantido: 4 níveis — informativo, atenção, importante, crítico — com canais crescentes)* A IARA não liga nem envia mensagens externas por conta própria sem política de autorização clara.

**Precisão v2:** "importante" e "crítico" exigem canal configurado **e** janela de silêncio configurável (ex.: não escalar entre 22h e 6h exceto crítico). Escalonamento crítico registra na auditoria quem foi notificado, quando e por qual canal.

## 14–16. Personalidade, modos e presença visual

*(mantidos integralmente — personalidade inteligente e objetiva, humor leve contextual, nunca em situação crítica; modos Profissional/Equilibrada/Descontraída; estados visuais da bolha)*

**Precisões v2:**

- Personalidade é **configuração, não prompt fixo**: os três modos são presets de parâmetros (frequência de humor, formalidade, verbosidade) armazenados em `preferencias`. O prompt do sistema é montado a partir deles.
- A troca automática para tom sério em incidente crítico é **determinística** (disparada pelo nível do evento, seção 13), não deixada ao critério do modelo.
- Os oito estados da bolha (disponível, ouvindo, interpretando, executando, revisando, aguardando, concluído, erro) mapeiam 1:1 para o `EstagioCognitivo` do kernel — tabela de mapeamento vive junto do `mapaFacial.ts`, seguindo o padrão "a tradução mora na projeção".

## 17. Relatórios, arquivos e resultados

*(mantido)* Todo resultado tem destino rastreável: arquivo gerado, caminho, data/hora, origem dos dados, status da tarefa, histórico de envio, abertura direta.

**Precisão v2:** isso é a tabela `artefatos` (seção 8.2) com **hash do arquivo** — permite responder "qual versão foi enviada?" com certeza criptográfica, não por convenção de nome.

## 18. Segurança e permissões

Segurança é requisito estrutural. Tudo da v1 permanece (autenticação por usuário, tokens nunca no frontend, permissões por capacidade, confirmação para ações destrutivas, auditoria, revogação remota, criptografia, menor privilégio). A v2 torna cada item verificável:

### 18.1 Identidade em três entidades

**Usuário** (Supabase Auth) ≠ **dispositivo/agente** (chave própria gerada no enrollment, seção 22) ≠ **sessão**. O backend nunca assume que o computador é confiável só porque o usuário está autenticado — princípio já presente na v1, agora com mecanismo: toda tarefa destinada a um agente é assinada para *aquele* dispositivo, e revogar o dispositivo mata o acesso sem mexer na conta do usuário.

### 18.2 Níveis de risco (política única para todas as ferramentas)

| Nível | Definição | Exemplos | Exigência |
|---|---|---|---|
| **R0** | Leitura, sem efeito externo | ler arquivo, consultar memória, capturar tela autorizada | Permissão da capacidade |
| **R1** | Escrita reversível, escopo local | criar/mover arquivo em raiz autorizada, gerar relatório | Permissão + registro em auditoria |
| **R2** | Destrutivo ou de alto impacto local | deletar, sobrescrever, desligar, rodar script com efeitos | Confirmação explícita por ação |
| **R3** | Efeito externo a terceiros | enviar mensagem, e-mail, publicar | Política de destinatários + confirmação + auditoria com conteúdo |

Deleção por padrão é *soft* (lixeira/quarentena do agente por 30 dias). Hard-delete é R2 com confirmação nomeando o que será perdido.

### 18.3 Execução de scripts

Nunca execução arbitrária. Scripts são **registrados** (nome, caminho, hash SHA-256, nível de risco, parâmetros permitidos). O agente confere o hash antes de executar; hash divergente = recusa + ocorrência na memória histórica. A LLM pode *pedir* "rode o script X com parâmetro Y"; não pode fornecer código a executar.

### 18.4 LGPD

A IARA processa dados pessoais de terceiros (motoristas, clientes, conteúdo de mensagens). Requisitos estruturais: minimização (o RAG já só guarda hash + assinatura + resolução — manter esse padrão para todo log), retenção com prazo por tipo de memória (seção 9), direito ao esquecimento (apagar memórias de uma pessoa sob demanda — as tabelas precisam de índice por titular), e auditoria de quem acessou o quê. Shards privados continuam derivados do `id_usuario` da sessão, com sondagem cruzada barrada **no roteador determinístico**, antes de qualquer prompt.

### 18.5 Credenciais

Tokens do agente vivem no cofre do SO (DPAPI no Windows), nunca em arquivo de configuração. Credenciais de integrações (WhatsApp, e-mail) vivem só no backend; o agente local nunca as vê.

## 19. Ferramentas e contrato

Lista da v1 mantida (FileSystem, Process, Script, Screen, Office, Browser, Messaging, Report, Notification, Power, Memory, Knowledge), com a divisão nova:

- **Locais** (executam no agente): FileSystem, Process, Script, Screen, Office, Notification, Power.
- **De nuvem** (executam no backend): Messaging, Report, Memory, Knowledge, Browser*.

*Browser pode existir nos dois lados; começa na nuvem por ser mais simples de sandboxar.

### Contrato de ferramenta (o que faltava na v1)

Toda ferramenta se declara por um manifesto:

```
id, versao, lado (local|nuvem), dominio (mapeia para os 6 domínios de capacidades.ts),
nivel_risco_padrao (R0–R3), permissoes_requeridas, schema_entrada, schema_saida,
suporta_dry_run (bool), idempotente (bool), timeout_ms, requer_confirmacao_quando (predicado)
```

Regras: entrada/saída sempre validadas contra o schema (entrada inválida falha **antes** de executar); toda ferramenta reporta erro estruturado `{codigo, mensagem, transitorio, detalhe}`; ferramentas R2+ devem oferecer `dry_run` quando tecnicamente possível ("isto moveria 342 arquivos"); versionamento semântico — o orquestrador recusa chamar versão major desconhecida. Adicionar capacidade = registrar habilidade num domínio; **o kernel não muda** (princípio já escrito em `capacidades.ts`).

## 20. Separação entre tarefas locais e IA — política de três camadas

A regra da v1 ("antes de chamar um modelo, verificar se uma ferramenta determinística resolve") vira pipeline explícito:

1. **Camada 1 — Roteador determinístico** (existe: `RoteadorIntencoes`): regex/normalização/mapa de intenções, decide em microssegundos, resolve a maioria dos comandos operacionais. Meta: ≥70% das interações nunca chamam modelo.
2. **Camada 2 — Modelo rápido e barato** (ex.: Haiku): classificação de intenção ambígua, classificação de memória, extração de parâmetros. Latência-alvo < 1,5 s.
3. **Camada 3 — Modelo forte** (ex.: Sonnet/Opus): planejamento multi-etapas, análise de documentos, raciocínio, redação. Só chega aqui o que as camadas 1–2 não resolvem.

**Orçamento:** custo por usuário/dia é medido e visível no painel técnico. Estouro de orçamento degrada com aviso (camada 3 passa a exigir confirmação), nunca silenciosamente.

Exemplos da v1 mantidos como casos de teste do roteador: "crie uma pasta" → FileSystemTool; "desligue o computador" → PowerTool; "rode o script X" → ScriptTool; "envie esta mensagem pronta" → MessagingTool; "leia esta planilha e identifique anomalias" → IA + arquivo; "resuma este relatório" → IA; "esse erro já aconteceu?" → Memória/RAG (+ IA se necessário).

## 21. PWA / Workspace Web

*(mantido — o PWA já existe como base; falta a camada administrativa)* Login, dashboard, históricos, relatórios/arquivos, memórias, personalidade, **permissões e dispositivos** (novo: enrollment, revogação, últimas atividades por agente), logs/auditoria, integrações, acompanhamento de tarefas em tempo real (via o mesmo WebSocket/snapshot).

## 22. Comunicação entre componentes

Fluxo conceitual mantido: Usuário → Interface → Motor Cognitivo → Plano → Ferramenta/Agente Local → Resultado → Memória/Log → Resposta.

**Protocolo agente↔backend (novo na v2):**

1. **Enrollment:** usuário logado no desktop gera pedido de pareamento; backend emite código curto com expiração; agente gera par de chaves local, envia a pública; backend registra o dispositivo (nome, usuário, chave, capacidades autorizadas).
2. **Sessão:** agente conecta por WebSocket (mesmo barramento `Porta`/`SessaoOperador`), autentica com token de dispositivo assinado; heartbeat a cada 30 s; backend marca dispositivo offline na ausência de 2 heartbeats.
3. **Tarefas:** o backend **nunca abre conexão de entrada para o agente** — o agente puxa/recebe pela sessão WebSocket que ele mesmo abriu. Firewall do usuário permanece intocado.
4. **Fila offline:** tarefas destinadas a agente offline ficam em `tarefas.estado = aguardando_dispositivo` com expiração configurável; resultados produzidos offline são enfileirados no agente e sincronizados ao reconectar.
5. **Revogação:** remota e imediata pelo PWA; o backend derruba a sessão e recusa o token; o agente local trava e exibe "acesso revogado".

## 23. Fases de desenvolvimento (reordenadas sobre o existente)

| Fase | Objetivo | Entrega testável (critério de aceite) |
|---|---|---|
| **0 — Consolidação** *(nova)* | Extrair `ProvedorIA` de `ClienteClaude`; formalizar contrato de ferramentas sobre `capacidades.ts`; criar tabelas de tarefas/auditoria | Suíte de testes do roteador com os 8 comandos da seção 7; trocar provider em config sem tocar no kernel |
| **1 — Casca desktop** | Tauri: bolha flutuante + atalho global + webview com o chat existente + login | Instalador Windows; bolha reflete `EstagioCognitivo` em tempo real |
| **2 — Agente local** | Enrollment de dispositivo + FileSystemTool, ProcessTool, PowerTool, NotificationTool | "Crie uma pasta X no desktop" executa sem chamada de modelo; PowerTool exige confirmação; revogação remota funciona |
| **3 — Orquestração persistida** | Planos multi-etapas em banco, aprovação R2/R3, replanejamento limitado | "Gere relatório e envie" pausa em `aguardando_aprovacao` na etapa de envio; falha de etapa gera ocorrência |
| **4 — Voz** | Push-to-talk na bolha, STT/TTS via `ProvedorIA.voz` (evolução de `Voz.ts`) | Comando por voz executa ação local fim a fim |
| **5 — Memória completa** | Pipeline de promoção + pgvector + "esse erro já aconteceu?" | Ocorrência registrada numa semana é encontrada na seguinte; sugestão de conhecimento exige aprovação |
| **6 — Proatividade** | Detecção de recorrência no `CicloAutonomo`, sugestões, escalonamento | Tarefa repetida 3× gera sugestão de automação; nenhuma ação proativa executa sem aprovação |
| **7 — Integrações** | ScriptTool, ScreenTool, OfficeTool, MessagingTool (decisões da seção 28) | Script registrado roda com hash conferido; envio de mensagem respeita R3 |
| **8 — PWA administrativo** | Dispositivos, permissões, auditoria, múltiplos agentes | Revogar dispositivo pelo celular derruba o agente em < 10 s |
| **9 — Escala** | Múltiplos usuários, políticas por organização, observabilidade | Auditoria responde "quem fez o quê, quando, em qual máquina" para qualquer ação R1+ |

Regra mantida da v1: **não construir tudo de uma vez** — cada fase fecha o ciclo completo (comando → interpretação → plano → execução → resultado → memória) para o seu escopo antes da próxima começar.

## 24. Critérios de sucesso — agora mensuráveis

| Critério v1 | Métrica v2 |
|---|---|
| Executar ações locais sem IA a cada operação | ≥70% das interações resolvidas na Camada 1 (sem tokens) |
| Ação local rápida | p50 < 1 s do comando à execução local determinística |
| Tarefas multi-etapas acompanháveis | 100% das tarefas com plano persistido e etapas consultáveis no painel |
| Resultado rastreável | 100% dos artefatos com caminho + hash + tarefa de origem |
| Consultar ocorrências | Recall verificado em suíte de teste de memória (ocorrências plantadas são encontradas) |
| Aprender sem auto-modificação | Zero procedimentos criados sem aprovação registrada em auditoria |
| Multi-provedor | Troca de provider por configuração, coberta por teste |
| Multi-dispositivo | 2+ agentes simultâneos do mesmo usuário sem colisão de tarefas |
| Segurança | Zero execuções R2/R3 sem confirmação correspondente na auditoria (verificável por query) |
| Custo | Custo médio por usuário/dia dentro do orçamento configurado, visível no painel |

## 25–27. Diretrizes de implementação

*(mantidas)* Validar primeiro o ciclo completo; cada capacidade nova é uma ferramenta independente; o produto final é a central operacional — o modelo de IA é uma peça, o produto é a orquestração. Antes de implementar cada fase, produzir os artefatos técnicos da seção 27 da v1 (arquitetura detalhada, diagramas, modelo de dados, protocolos, contratos, permissões, memória, voz, segurança, roadmap) **para aquela fase**, não para o projeto inteiro de uma vez.

**Acréscimo:** decisões que aumentem dependência de fornecedor único continuam exigindo justificativa — e agora há teste de troca de provider (Fase 0) que mantém a promessa honesta.

## 28. Registro de riscos e decisões em aberto *(novo)*

### 28.1 WhatsApp
Não existe API oficial para automatizar WhatsApp **pessoal**; bibliotecas não-oficiais (ex.: via WhatsApp Web) violam os termos de uso e podem causar **banimento do número**. Caminho recomendado: **WhatsApp Business Cloud API** (oficial, número dedicado da empresa) para os fluxos operacionais (mensagens a motoristas). Se for indispensável usar o número pessoal, isso é uma decisão de risco do usuário, tomada explicitamente, com número que possa ser perdido. Decisão necessária antes da Fase 7.

### 28.2 Office
Automação via COM (Excel/Word abertos) é frágil: quebra com diálogos abertos, versões diferentes e sessões bloqueadas. Estratégia: **manipulação direta dos arquivos** (bibliotecas de xlsx/docx) como caminho padrão — não requer Office aberto e é testável; COM apenas para o que exigir o aplicativo vivo (imprimir, macros legadas), marcado como R2.

### 28.3 Captura de tela
Risco de privacidade alto (senhas, conversas, dados de terceiros na tela). Mitigações: captura é R0 **somente** para áreas/janelas pré-autorizadas; captura de tela inteira exige confirmação por vez; imagens capturadas não persistem por padrão (analisa e descarta); se persistir, vira artefato auditável com retenção curta.

### 28.4 Dependência do número/canal do usuário para escalonamento crítico
Ligações e SMS de escalonamento (seção 13) dependem de integração de telefonia (ex.: provedor de voz/SMS). Adiar para a Fase 9; até lá, "crítico" = notificação persistente + mensagem no canal configurado.

---

*IARA • Especificação consolidada v2 — gerada a partir da especificação conceitual original + leitura do código de `IARA_WCA/iara-os` em 07/08/2026.*
