# Inventário de habilidades da IARA

**43 habilidades** em 12 grupos, derivadas de `CATALOGO` — o mesmo objeto que o Kernel oferece à LLM. Nenhuma linha foi escrita à mão.

## O que a contagem já diz

| | |
|---|---|
| habilidades no catálogo | 43 |
| planejáveis pela LLM | 37 |
| exigem confirmação prévia | 6 |
| alteram o mundo (escrita ou externo) | 12 |
| com verificador próprio | 23 |
| **exigem verificação e NÃO têm verificador** | **0** |
| **sem nenhuma bateria citando o id** | **10** |
| sem exemplo de entrada no manifesto | 0 |
| com texto livre obrigatório | 19 |

### Texto livre obrigatório — superfície a triar, não lista de defeitos

Parâmetro `texto` obrigatório sem `dentre` e sem sinônimos. **A maioria é legítima**: a consulta de `pesquisar_web` e a mensagem de `enviar_whatsapp` são texto livre por natureza, e enumerá-las não faria sentido. O que esta lista existe para separar é o subconjunto em que o parâmetro **é uma lista fechada que vive fora do esquema** — ali o modelo aprende os valores pela prosa da descrição, e uma palavra fora deles morre no executor em vez de morrer no esquema.

É a forma do defeito de 18/08 (`agrupar_por` fora do enum matou o turno) e o oposto do que salvou a medição de 19/08: `uf` TEM `dentre`, o erro morreu no esquema com a lista dos aceitos na mensagem, e o laço se corrigiu sozinho na volta seguinte.

| habilidade | parâmetro | risco | a lista existe fora do esquema? |
|---|---|---|---|
| `pesquisar_web` | `consulta` | baixo | a conferir |
| `buscar_historico` | `consulta` | baixo | a conferir |
| `consultar_memoria_corporativa` | `consulta` | baixo | a conferir |
| `extrair_texto_documento` | `arquivo` | baixo | a conferir |
| `enviar_whatsapp` | `destinatario` | alto | a conferir |
| `enviar_whatsapp` | `mensagem` | alto | a conferir |
| `buscar_documento_sharepoint` | `consulta` | baixo | a conferir |
| `criar_evento_calendario` | `assunto` | alto | a conferir |
| `criar_evento_calendario` | `quando` | alto | a conferir |
| `criar_pasta` | `nome` | medio | a conferir |
| `abrir_aplicativo` | `aplicativo` | medio | sim — allowlist em AgenteLocal |
| `fechar_aplicativo` | `aplicativo` | medio | sim — allowlist em AgenteLocal |
| `atualizar_repositorio` | `repositorio` | medio | sim — RepositoriosAutorizados |
| `abrir_sessao_agente_codigo` | `repositorio` | alto | sim — RepositoriosAutorizados |
| `abrir_sessao_agente_codigo` | `instrucao` | alto | a conferir |
| `enviar_para_agente_codigo` | `sessao` | alto | a conferir |
| `enviar_para_agente_codigo` | `instrucao` | alto | a conferir |
| `encerrar_agente_codigo` | `sessao` | medio | a conferir |
| `agendar_lembrete` | `assunto` | medio | a conferir |
| `agendar_lembrete` | `quando` | medio | a conferir |
| `consultar_cargas_luft` | `periodo` | baixo | a conferir |
| `descrever_planilha` | `arquivo` | baixo | a conferir |
| `consultar_planilha_generica` | `arquivo` | baixo | a conferir |
| `diagnosticar_qualidade_planilha` | `arquivo` | baixo | a conferir |

### Nenhuma bateria menciona o id

- `buscar_historico` — Procura no índice de incidentes por assinatura semelhante e devolve a resolução 
- `recusar_por_sigilo` — Recusa cortês a pedido sobre registro de outro operador.
- `ler_emails` — Lê e-mails recentes da caixa corporativa do operador, filtrando por remetente ou
- `ver_agenda_calendario` — Lista os próximos compromissos do calendário real (Google Calendar) do operador,
- `capturar_tela` — Fotografa a tela do computador onde o motor roda e salva um PNG numa pasta autor
- `atualizar_repositorio` — Puxa as novidades de um repositório autorizado com git pull --ff-only. O alvo é 
- `abrir_sessao_agente_codigo` — Abre uma nova sessão do Claude Code num repositório AUTORIZADO e envia uma instr
- `enviar_para_agente_codigo` — Envia uma nova instrução para uma sessão do Claude Code JÁ ABERTA, continuando o
- `acompanhar_agente_codigo` — Diz o estado das sessões do Claude Code abertas nesta conversa: qual repositório
- `encerrar_agente_codigo` — Encerra uma sessão do Claude Code que está em andamento. Use para "para o Claude

## operacionais — 6

### `consultar_clima`

Tempo no perímetro operacional, ou numa cidade que o operador nomeie. `horizonte: agora` devolve a MEDIÇÃO corrente (temperatura, umidade, precipitação da última hora); `hoje` e `amanha` devolvem a PREVISÃO do dia (probabilidade de chuva, acumulado, máxima e mínima). Escolha pelo tempo verbal da pergunta: "está chovendo" é agora, "vai chover" é previsão. `cidade` é OPCIONAL: preencha com o nome que o operador disse ("clima em Valinhos" → cidade: "Valinhos"). Sem cidade, a resposta usa a localização do aparelho (se concedida) ou o padrão do escritório.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Vai chover hoje?" · "Como está o tempo em Valinhos?" · "Está chovendo aí?" · "Qual a previsão para amanhã?" |
| **parâmetros** | `horizonte`:texto ∈ {agora\|hoje\|amanha}<br>`cidade`:texto |
| **alcança** | internet |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | sim |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 6000 ms |
| **baterias que citam o id** | `testes/cerebro-integridade.test.ts` `testes/clima-geocodificacao.test.ts` `testes/estabilizacao.test.ts` `testes/propriedades-criticas.test.ts` `testes/zero-trust-adversarial.test.ts` |

### `consultar_infraestrutura`

Centrais ativas e frota vinculada, por UF. Use para "quantas centrais", "quantos veículos", "status da operação". Funciona com ou sem banco configurado.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Quantas centrais temos ativas?" · "Quantos veículos tem a frota no MT?" · "Como está a operação por estado?" |
| **parâmetros** | `uf`:texto ∈ {GERAL\|MT\|MS\|GO\|SP\|PR\|RO} |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | sim |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 5000 ms |
| **baterias que citam o id** | `testes/escalada-no-kernel.test.ts` `testes/habilidades.test.ts` `testes/kernel.test.ts` `testes/navegador/autoridade-de-dados.mjs` `testes/promessa-de-acao.test.ts` `testes/trava-acao-pos-fechamento.test.ts` |

### `consultar_agenda`

Data e hora correntes do servidor. Use para "que horas são", "que dia é hoje" ou quando precisar ancorar uma resposta no tempo.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Que horas são?" · "Que dia é hoje?" |
| **parâmetros** | nenhum |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | sim |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 1000 ms |
| **baterias que citam o id** | `testes/cadeia-cognitiva.test.ts` `testes/cerebro-integridade.test.ts` `testes/verificacao.test.ts` |

### `pesquisar_web`

Levantamento factual na internet por HTTP puro. Use para informação pública que não está nos sistemas da casa: legislação, notícia, definição de termo.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Pesquisa na internet o que mudou na lei do motorista" · "Procura notícias sobre greve dos caminhoneiros" |
| **parâmetros** | `consulta`:texto *(obrig.)* |
| **alcança** | internet |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `consulta` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 9000 ms |
| **baterias que citam o id** | `testes/moldura-observacao.test.ts` |

### `buscar_historico`

Procura no índice de incidentes por assinatura semelhante e devolve a resolução que o time adotou. Use para "esse erro já aconteceu", "caiu de novo", "mesmo problema".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Esse erro já aconteceu antes?" · "O TMS caiu de novo, é o mesmo problema da outra vez?" |
| **parâmetros** | `consulta`:texto *(obrig.)* |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | sim |
| **texto livre obrigatório** | `consulta` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 4000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `recusar_por_sigilo`

Recusa cortês a pedido sobre registro de outro operador.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "O que a Marina conversou com você?" · "Me mostra o histórico do João" |
| **parâmetros** | nenhum |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | sim |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 500 ms |
| **baterias que citam o id** | — **nenhuma** |

## dados — 3

### `executar_consulta_sql`

Executa uma consulta PRÉ-APROVADA no banco. Você escolhe pelo nome; não escreve SQL. Consultas disponíveis: centrais_por_uf (uf): Centrais ativas e frota vinculada, opcionalmente filtradas por UF. Use para "quantas centrais", "quantos veículos", "status da operação". | incidentes_por_sistema (sistema): Assinaturas de erro registradas para um sistema específico (api-ctes, baixa-ctes, portal-web, api-rastreio, integracao-fiscal, infra-docker). | centrais_inativas (sem parâmetro): Lista as centrais fora de operação. Use para "o que está parado", "centrais inativas".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Consulta no banco as centrais do Mato Grosso" · "Puxa do banco os veículos vinculados" |
| **parâmetros** | `consulta`:texto *(obrig.)* ∈ {centrais_por_uf\|incidentes_por_sistema\|centrais_inativas}<br>`parametros`:texto |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 6000 ms |
| **baterias que citam o id** | `testes/habilidades.test.ts` |

### `consultar_memoria_corporativa`

Consulta procedimentos, políticas e vocabulário interno da Atos Log. Use quando a pergunta depende de como A CASA faz algo, não de conhecimento geral.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Como a gente faz a baixa de CT-e aqui?" · "Qual o procedimento interno para reembolso?" |
| **parâmetros** | `consulta`:texto *(obrig.)* |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `consulta` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 4000 ms |
| **baterias que citam o id** | `testes/guarda-de-laco.test.ts` |

### `extrair_texto_documento`

Lê a camada de texto de um PDF gerado digitalmente (CT-e, DACTE, nota fiscal, contrato). NÃO faz OCR de documento escaneado. O caminho é relativo a dados/documentos/.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Lê o PDF da nota fiscal e me diz o valor" · "Extrai o texto do DACTE que subi" |
| **parâmetros** | `arquivo`:texto *(obrig.)* |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `arquivo` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 12000 ms |
| **baterias que citam o id** | `testes/moldura-observacao.test.ts` |

## integrações — 3

### `ler_emails`

Lê e-mails recentes da caixa corporativa do operador, filtrando por remetente ou assunto.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Leia meus emails recentes" · "Chegou algum email da LUFT hoje?" · "Tem email novo sobre a fatura?" |
| **parâmetros** | `filtro`:texto<br>`limite`:numero |
| **alcança** | internet, shard do operador |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 10000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `enviar_whatsapp`

Envia mensagem de WhatsApp para um contato da operação. NUNCA executa direto: registra uma pendência e pede confirmação explícita do operador.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Manda um whatsapp para o João avisando do atraso" · "Avisa a Marina no zap que a coleta foi remarcada" |
| **parâmetros** | `destinatario`:texto *(obrig.)*<br>`mensagem`:texto *(obrig.)* |
| **alcança** | internet, terceiro (em nome do operador) |
| **risco / repetir** | alto / escrita_idempotente |
| **segurança** | confirmação prévia: sim · verificação obrigatória: sim · planejável pela LLM: — |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `destinatario`, `mensagem` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 10000 ms |
| **baterias que citam o id** | `testes/calendario-arm-confirmar.test.ts` `testes/cerebro-escrita-integridade.test.ts` `testes/cerebro-integridade.test.ts` `testes/encerramento-absoluto.test.ts` `testes/fronteira-efeitos.test.ts` `testes/fronteira-interna.test.ts` `testes/integridade-cognitiva.test.ts` `testes/proatividade-adversarial.test.ts` `testes/promessa-de-acao.test.ts` `testes/propriedades-criticas.test.ts` `testes/validacao/exfiltracao.ts` `testes/validacao/quedaFilho.ts` `testes/zero-trust-adversarial.test.ts` |

### `buscar_documento_sharepoint`

Localiza documentos no SharePoint corporativo por título ou conteúdo e devolve o link e um resumo.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Acha no SharePoint a planilha de fechamento" · "Procura o documento do contrato da LUFT" |
| **parâmetros** | `consulta`:texto *(obrig.)* |
| **alcança** | internet, base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `consulta` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 12000 ms |
| **baterias que citam o id** | `testes/agente-local.test.ts` |

## calendário — 2

### `ver_agenda_calendario`

Lista os próximos compromissos do calendário real (Google Calendar) do operador, num período de dias à frente. Use para "o que eu tenho hoje/essa semana", "quais são meus próximos compromissos", "tenho reunião amanhã".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "O que eu tenho essa semana?" · "Quais são meus próximos compromissos?" · "Tenho alguma reunião amanhã?" |
| **parâmetros** | `dias_a_frente`:numero |
| **alcança** | internet, shard do operador |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 10000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `criar_evento_calendario`

Cria um evento real no Google Calendar do operador. NUNCA executa direto: registra uma pendência e pede confirmação explícita do operador, mesmo desenho de enviar_whatsapp. O parâmetro "quando" recebe a EXPRESSÃO DE TEMPO exatamente como foi dita ("amanhã às 14h", "sexta que vem às 10h") — não converta para data, quem interpreta é o motor. v1 não convida ninguém: o evento fica só no calendário do operador. Use para "marca uma reunião", "agenda um compromisso", "bota isso no calendário".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Marca uma reunião com o financeiro amanhã às 14h" · "Agenda uma consulta sexta às 10h, uma hora de duração" · "Bota no calendário: dentista quinta-feira às 9h" |
| **parâmetros** | `assunto`:texto *(obrig.)*<br>`quando`:texto *(obrig.)*<br>`duracao_minutos`:numero<br>`local`:texto |
| **alcança** | internet, terceiro (em nome do operador) |
| **risco / repetir** | alto / escrita_nao_idempotente |
| **segurança** | confirmação prévia: sim · verificação obrigatória: sim · planejável pela LLM: — |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `assunto`, `quando` |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 10000 ms |
| **baterias que citam o id** | `testes/calendario-arm-confirmar.test.ts` `testes/fronteira-efeitos.test.ts` |

## braço (máquina do operador) — 9

### `criar_pasta`

Cria uma pasta em um local autorizado da máquina (Área de Trabalho, Documentos ou Downloads). Não aceita caminho livre — só um desses três locais nomeados. Use para "crie uma pasta chamada X".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Crie uma pasta chamada Relatórios" · "Cria uma pasta Notas Fiscais nos Downloads" |
| **parâmetros** | `nome`:texto *(obrig.)*<br>`local`:texto ∈ {area_de_trabalho\|documentos\|downloads} |
| **alcança** | máquina do motor |
| **risco / repetir** | medio / escrita_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `nome` |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 5000 ms |
| **baterias que citam o id** | `testes/afirmacao-de-feito.test.ts` `testes/campanha/missoes/agente.ts` `testes/campanha/missoes/auditores.ts` `testes/campanha/missoes/lacunas.ts` `testes/campanha/MotorSandbox.ts` `testes/campanha-contrato.test.ts` `testes/cerebro-escrita-integridade.test.ts` `testes/cerebro-integridade-final.test.ts` `testes/cerebro-integridade.test.ts` `testes/guarda-de-laco.test.ts` `testes/habilidades.test.ts` `testes/integridade-cognitiva.test.ts` `testes/invariantes-cognitivos.test.ts` `testes/mentira-operacional.test.ts` `testes/moldura-observacao.test.ts` `testes/ponte-execucao-adversarial.test.ts` `testes/ponte-execucao.test.ts` `testes/promessa-de-acao.test.ts` `testes/propriedades-criticas.test.ts` `testes/verificacao.test.ts` `testes/zero-trust-adversarial.test.ts` |

### `abrir_aplicativo`

Abre um aplicativo de uma lista fechada e revisada (Bloco de Notas, Calculadora, Paint, Explorador de Arquivos, Chrome, Edge). Não executa comando arbitrário. Para Chrome/Edge, aceita opcionalmente um "site" (endereço http:// ou https:// completo) para abrir já naquela página — outros aplicativos da lista não têm o que fazer com um endereço.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Abre o bloco de notas" · "Abre o Chrome no site da LUFT" |
| **parâmetros** | `aplicativo`:texto *(obrig.)*<br>`site`:texto |
| **alcança** | máquina do motor |
| **risco / repetir** | medio / escrita_nao_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `aplicativo` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 25000 ms |
| **baterias que citam o id** | `testes/cerebro-escrita-integridade.test.ts` `testes/habilidades.test.ts` `testes/integridade-cognitiva.test.ts` `testes/ponte-execucao-adversarial.test.ts` `testes/ponte-execucao.test.ts` |

### `fechar_aplicativo`

Fecha um aplicativo da lista autorizada no computador do operador, pedindo educadamente ao Windows (nunca forçando). Se houver trabalho não salvo, o programa recusa e a IARA diz isso. Use para "feche o bloco de notas", "pode fechar o Chrome".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Fecha o bloco de notas" · "Pode fechar o Chrome" |
| **parâmetros** | `aplicativo`:texto *(obrig.)* |
| **alcança** | máquina do motor |
| **risco / repetir** | medio / escrita_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `aplicativo` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 25000 ms |
| **baterias que citam o id** | `testes/investigacao.test.ts` `testes/planos-autorizados.test.ts` |

### `listar_arquivos`

Lista pastas e arquivos de um local autorizado do computador do operador (Área de Trabalho, Documentos ou Downloads). Não aceita caminho livre. Use para "o que tem na minha área de trabalho", "liste os arquivos de Downloads".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "O que tem na minha área de trabalho?" · "Lista os arquivos de Downloads" |
| **parâmetros** | `local`:texto ∈ {area_de_trabalho\|documentos\|downloads} |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 15000 ms |
| **baterias que citam o id** | `testes/agente-local.test.ts` `testes/campanha/missoes/seguranca.ts` `testes/ponte-execucao-adversarial.test.ts` `testes/ponte-execucao.test.ts` |

### `informacoes_sistema`

Consulta o estado do computador do operador: memória em uso, processador, tempo ligado e interfaces de rede. Use para "quanto de memória meu computador está usando", "meu computador está conectado", "como está o PC". SÍNCRONA: o resultado sai nesta mesma resposta, em poucos segundos — nunca diga que vai avisar depois, porque não há um "depois" aqui.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Quanto de memória meu computador está usando?" · "Como está o PC agora?" |
| **parâmetros** | nenhum |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 15000 ms |
| **baterias que citam o id** | `testes/investigacao.test.ts` |

### `capturar_tela`

Fotografa a tela do computador onde o motor roda e salva um PNG numa pasta autorizada (Área de Trabalho, Documentos ou Downloads). Devolve o caminho e o tamanho do arquivo — NUNCA o conteúdo da imagem, que não é lido nem transmitido. Use para "tira um print", "captura a tela", "salva uma foto do que está aberto".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Tira um print da tela" · "Captura a tela e salva nos Documentos" |
| **parâmetros** | `local`:texto ∈ {area_de_trabalho\|documentos\|downloads} |
| **alcança** | máquina do motor |
| **risco / repetir** | medio / escrita_nao_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 20000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `acionar_energia`

Prepara desligar, reiniciar ou suspender a máquina. NUNCA executa direto: registra uma pendência e pede confirmação explícita do operador.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Desliga o computador" · "Reinicia a máquina para mim" |
| **parâmetros** | `acao`:texto ∈ {desligar\|reiniciar\|suspender} |
| **alcança** | máquina do motor |
| **risco / repetir** | alto / escrita_idempotente |
| **segurança** | confirmação prévia: sim · verificação obrigatória: sim · planejável pela LLM: — |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 3000 ms |
| **baterias que citam o id** | `testes/autonomia-vigia-aprendizado.test.ts` `testes/campanha-contrato.test.ts` `testes/cerebro-escrita-integridade.test.ts` `testes/cerebro-integridade.test.ts` `testes/decisao.test.ts` `testes/fronteira-interna.test.ts` `testes/integridade-cognitiva.test.ts` `testes/planos-autorizados.test.ts` `testes/propriedades-criticas.test.ts` `testes/zero-trust-adversarial.test.ts` |

### `atualizar_repositorio`

Puxa as novidades de um repositório autorizado com git pull --ff-only. O alvo é o APELIDO de um repositório declarado, nunca um caminho. Recusa se houver trabalho não salvo e nunca resolve conflito. Use para "atualize o repositório X" ou "puxa as novidades do X".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Atualiza o repositório da IARA" · "Puxa as novidades do repositório" |
| **parâmetros** | `repositorio`:texto *(obrig.)* |
| **alcança** | máquina do motor |
| **risco / repetir** | medio / escrita_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `repositorio` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 80000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `resolver_confirmacao`

Fecha o ciclo de uma ação que ficou aguardando confirmação: executa se o operador confirmou, aborta se cancelou. Sem pendência válida, diz isso em vez de executar qualquer coisa.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "confirmo" · "não, cancela" |
| **parâmetros** | `resposta`:texto *(obrig.)* ∈ {confirmo\|cancelar} |
| **alcança** | máquina do motor |
| **risco / repetir** | alto / escrita_nao_idempotente |
| **segurança** | confirmação prévia: sim · verificação obrigatória: sim · planejável pela LLM: — |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 3000 ms |
| **baterias que citam o id** | `testes/calendario-arm-confirmar.test.ts` `testes/cerebro-escrita-integridade.test.ts` `testes/cerebro-integridade.test.ts` `testes/fronteira-efeitos.test.ts` `testes/fronteira-interna.test.ts` `testes/integridade-cognitiva.test.ts` `testes/planos-autorizados.test.ts` |

## agente de código — 4

### `abrir_sessao_agente_codigo`

Abre uma nova sessão do Claude Code num repositório AUTORIZADO e envia uma instrução de trabalho. O repositório é escolhido por apelido de uma lista fechada — nunca por caminho. Use para "abra uma sessão do Claude Code no repositório X e peça para ele fazer Y".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Abra uma nova sessão do Claude Code no repositório IARA e peça para auditar a camada de voz" · "Manda o Claude Code corrigir os testes quebrados no iara" · "Abre o Claude Code no repositório iara e pede para revisar os botões" |
| **parâmetros** | `repositorio`:texto *(obrig.)*<br>`instrucao`:texto *(obrig.)* |
| **alcança** | máquina do motor |
| **risco / repetir** | alto / escrita_nao_idempotente |
| **segurança** | confirmação prévia: sim · verificação obrigatória: sim · planejável pela LLM: — |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `repositorio`, `instrucao` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 20000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `enviar_para_agente_codigo`

Envia uma nova instrução para uma sessão do Claude Code JÁ ABERTA, continuando o trabalho dela. Exige o id da sessão. Use para "manda o Claude Code continuar", "diz para ele também corrigir Z".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Manda o Claude Code continuar a tarefa" · "Diz para a sessão do Claude Code também rodar os testes" |
| **parâmetros** | `sessao`:texto *(obrig.)*<br>`instrucao`:texto *(obrig.)* |
| **alcança** | máquina do motor |
| **risco / repetir** | alto / escrita_nao_idempotente |
| **segurança** | confirmação prévia: sim · verificação obrigatória: sim · planejável pela LLM: — |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `sessao`, `instrucao` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 20000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `acompanhar_agente_codigo`

Diz o estado das sessões do Claude Code abertas nesta conversa: qual repositório, se ainda está trabalhando, se terminou, se falhou. Use para "o que o Claude Code está fazendo?", "a sessão terminou?".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "O que o Claude Code está fazendo?" · "A sessão do Claude Code já terminou?" · "Como está o agente de código?" |
| **parâmetros** | `sessao`:texto |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 5000 ms |
| **baterias que citam o id** | — **nenhuma** |

### `encerrar_agente_codigo`

Encerra uma sessão do Claude Code que está em andamento. Use para "para o Claude Code", "encerra essa sessão", "cancela o agente".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Encerra a sessão do Claude Code" · "Para o agente de código" |
| **parâmetros** | `sessao`:texto *(obrig.)* |
| **alcança** | máquina do motor |
| **risco / repetir** | medio / escrita_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `sessao` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 5000 ms |
| **baterias que citam o id** | — **nenhuma** |

## agenda — 3

### `agendar_lembrete`

Marca um lembrete para o operador e o anuncia quando a hora chegar. O parâmetro "quando" recebe a EXPRESSÃO DE TEMPO exatamente como ela foi dita ("amanhã às 9", "em 20 minutos", "hoje às 15h30") — não converta para data, quem interpreta é o motor. Use para "me lembre de X", "não me deixe esquecer de Y".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Me lembre de ligar para o cliente em 20 minutos" · "Não me deixe esquecer da reunião amanhã às 9" |
| **parâmetros** | `assunto`:texto *(obrig.)*<br>`quando`:texto *(obrig.)* |
| **alcança** | shard do operador |
| **risco / repetir** | medio / escrita_nao_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `assunto`, `quando` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 6000 ms |
| **baterias que citam o id** | `testes/agenda.test.ts` |

### `listar_lembretes`

Lista os lembretes que o operador ainda tem pendentes comigo, do mais próximo ao mais distante. Use para "quais lembretes eu tenho", "o que eu marquei", "minha agenda".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Quais lembretes eu tenho?" · "O que eu marquei com você?" |
| **parâmetros** | nenhum |
| **alcança** | shard do operador |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 5000 ms |
| **baterias que citam o id** | `testes/agenda.test.ts` |

### `cancelar_lembrete`

Remove um lembrete pendente. O parâmetro "termo" é um trecho do assunto ("a reunião", "ligar para o cliente"); vazio só funciona quando existe um único lembrete marcado. Use para "cancela o lembrete de X", "esquece aquele lembrete".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Cancela o lembrete da reunião" · "Esquece aquele lembrete de ontem" |
| **parâmetros** | `termo`:texto |
| **alcança** | shard do operador |
| **risco / repetir** | medio / escrita_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: sim · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 6000 ms |
| **baterias que citam o id** | `testes/agenda.test.ts` |

## diagnóstico — 1

### `diagnosticar_sistema`

Relata o estado real de cada parte da IARA: motor, banco, computador do operador, executor, catálogo de ferramentas e serviços externos — mais as últimas execuções e onde cada uma parou. Use para "faça um diagnóstico", "você está funcionando?", "por que não abriu?".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Faça um diagnóstico do sistema" · "Você está funcionando direito?" · "Por que não abriu o aplicativo?" |
| **parâmetros** | nenhum |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 8000 ms |
| **baterias que citam o id** | `testes/autonomia-vigia-aprendizado.test.ts` `testes/persistencia-degradada.test.ts` `testes/regressoes.test.ts` |

## investigação — 2

### `investigar_lentidao`

Investiga por que o computador do operador está lento: mede processador, memória, disco e os processos que mais consomem, separa o que está fora da faixa normal, levanta hipóteses com o grau de confiança que as evidências sustentam e propõe planos comparados por benefício, risco e esforço. NÃO executa nenhum plano — devolve a proposta e pede autorização. Quando já houve uma investigação antes, compara e diz se a ação anterior resolveu. Use para "por que meu computador está lento", "investigue a lentidão", "veja se resolveu", "meça de novo".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Por que meu computador está lento?" · "Investiga essa lentidão aqui" · "Mede de novo e vê se resolveu" |
| **parâmetros** | nenhum |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 40000 ms |
| **baterias que citam o id** | `testes/investigacao.test.ts` `testes/planos-autorizados.test.ts` |

### `assumir_plano`

Registra que o operador autorizou um dos planos que a IARA propôs na investigação e anuncia o que vai acontecer. Não executa o plano: os passos de efeito vêm em seguida, cada um pelas portas de sempre. Sem proposta viva, diz isso em vez de assumir qualquer coisa.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Pode executar o plano A" · "Autorizo o plano recomendado" |
| **parâmetros** | `plano`:texto |
| **alcança** |  |
| **risco / repetir** | baixo / escrita_idempotente |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 3000 ms |
| **baterias que citam o id** | `testes/calendario-arm-confirmar.test.ts` `testes/planos-autorizados.test.ts` `testes/validacao/falsaConclusao.ts` `testes/validacao-falsa-conclusao.test.ts` |

## auditoria — 1

### `auditar_sistema`

Audita as quatro áreas que a IARA consegue observar de si mesma: capacidades desligadas por falta de credencial, erros cognitivos que se repetiram, planos que foram tentados e nunca resolveram, e a integridade da prova do jornal. Declara explicitamente o que NÃO auditou. Também relata o que pediram e ela ainda não sabe fazer (lacunas de capacidade). Use para "faça uma auditoria", "o que está errado por aqui", "o que precisa de atenção".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Faça uma auditoria do sistema" · "O que está errado por aqui?" · "O que te pediram que você não soube fazer?" |
| **parâmetros** | nenhum |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | — *nenhuma declarada* |
| **timeout** | 8000 ms |
| **baterias que citam o id** | `testes/autonomia-vigia-aprendizado.test.ts` `testes/lacunas-capacidade.test.ts` |

## planilha LUFT — 6

### `consultar_cargas_luft`

Conta e lista as cargas (OCIs) com coleta marcada num período, lendo a planilha oficial da operação LUFT. O parâmetro "periodo" recebe a EXPRESSÃO como foi dita ("hoje", "amanhã", "essa semana", "17/08") — não calcule a data, quem interpreta é o motor. Use para "quantas cargas vamos coletar hoje/amanhã", "o que temos essa semana", "cargas do dia 17/08".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Quantas cargas foram coletadas hoje?" · "Quantas coletas temos amanhã na LUFT?" · "O que temos de carga essa semana?" · "Me mostra as cargas do dia 17/08" |
| **parâmetros** | `periodo`:texto *(obrig.)* |
| **alcança** | internet, base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `periodo` |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 75000 ms |
| **baterias que citam o id** | `testes/cadeia-cognitiva.test.ts` `testes/guarda-de-laco.test.ts` `testes/holdout/cenarios.ts` `testes/moldura-observacao.test.ts` `testes/promessa-de-acao.test.ts` |

### `consultar_estatisticas_cargas_luft`

Conta, soma valor ou agrupa as cargas da operação LUFT — motorista com mais cargas, faturamento por rota, cargas por status, valor total ou médio. "periodo" é opcional (vazio = todas as cargas cadastradas) e recebe a EXPRESSÃO como foi dita ("essa semana", "17/08"), nunca uma data já calculada. "agrupar_por" é um de: motorista, rota, origem, destino, status (texto exato da célula), status_normalizado (agrupa FINALIZADO/finalizado/FINALIZADA juntos), nenhum. NESTA OPERAÇÃO a origem é o POSTO que despacha e o destino é a CENTRAL que recebe: "por posto" = origem, "por central" = destino. Há um cliente só (LUFT), então não existe agrupamento por cliente. "metrica" é um de: contagem, valor_total, valor_medio, distintos, sem_movimento. Use sem_movimento com um "periodo" para "quais centrais/postos/motoristas NÃO tiveram carga nos últimos 30 dias" — ela lista quem a planilha do ano conhece e não apareceu na janela, e EXIGE período (sem janela não existe "parou"). Use para "qual motorista fez mais cargas", "faturamento por rota", "quantas cargas por status", "valor total das cargas desta semana". Para "QUANTOS motoristas/rotas/destinos DIFERENTES existem", use metrica=distintos com o agrupar_por da dimensão — ela devolve a contagem única já descontando as cargas sem o campo preenchido. NUNCA some os grupos de uma listagem para chegar a esse número: a listagem é truncada e o rodapé "e mais N" não é somável.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Qual motorista tem mais cargas?" · "Quantos motoristas diferentes temos?" · "Quantas cargas por posto?" · "Qual central recebeu mais cargas?" · "Quais centrais não tiveram cargas nos últimos 30 dias?" · "Quais postos ficaram sem carga essa semana?" · "Quantas rotas distintas existem?" · "Motoristas disponíveis agora?" · "Qual rota teve maior faturamento?" · "Qual o total faturado essa semana?" · "Quantas cargas estão finalizadas?" |
| **parâmetros** | `periodo`:texto<br>`agrupar_por`:texto ∈ {motorista\|rota\|origem\|destino\|status\|status_normalizado\|nenhum} +23 sinônimos<br>`metrica`:texto ∈ {contagem\|valor_total\|valor_medio\|distintos\|sem_movimento\|margem} +27 sinônimos<br>`ano`:texto ∈ {\|2026\|2025\|2024} |
| **alcança** | internet, base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | sinônimos declarados no esquema · valor padrão · verificador confere depois |
| **timeout** | 75000 ms |
| **baterias que citam o id** | `testes/autoridade-de-dados.test.ts` `testes/catalogo-no-prefixo.test.ts` `testes/contrato-factual.test.ts` `testes/decisao.test.ts` `testes/descoberta-capacidades.test.ts` `testes/elipse-conversacional.test.ts` `testes/fi-escalada-e2e.test.ts` `testes/holdout/cenarios.ts` `testes/lacunas-capacidade.test.ts` |

### `comparar_semanas_luft`

Compara contagem e valor total de cargas entre duas semanas da operação LUFT. Os parâmetros "periodo_atual" e "periodo_anterior" recebem a EXPRESSÃO como foi dita ("essa semana", "semana passada", "17/08") — não calcule a data. Use para "como essa semana está em relação à passada", "comparar com a semana anterior", "crescemos ou caímos essa semana".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Como essa semana está em relação à passada?" · "Comparar essa semana com a semana anterior" · "Crescemos ou caímos em relação à semana passada?" · "Faturamento dessa semana comparado com a semana anterior" |
| **parâmetros** | `periodo_atual`:texto<br>`periodo_anterior`:texto |
| **alcança** | internet, base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 75000 ms |
| **baterias que citam o id** | `testes/cargasLuft-habilidades.test.ts` `testes/holdout/cenarios.ts` |

### `relatorio_executivo_luft`

Consolida num único relatório: total de cargas cadastradas, contagem e faturamento do período pedido, os motoristas com mais cargas no período e a distribuição por status. "periodo" recebe a EXPRESSÃO como foi dita ("essa semana", "hoje") e é opcional (vazio = essa semana). Use para "me dá um relatório da operação", "resumo executivo da semana", "como está a operação hoje".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Me dá um relatório da operação essa semana" · "Resumo executivo da LUFT" · "Como está a operação hoje?" · "Relatório da semana passada" |
| **parâmetros** | `periodo`:texto |
| **alcança** | internet, base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | valor padrão · verificador confere depois |
| **timeout** | 75000 ms |
| **baterias que citam o id** | `testes/cargasLuft-habilidades.test.ts` |

### `declarar_lacuna_de_dado`

Declara, com o motivo, que a planilha da operação LUFT não tem a coluna que a pergunta pede. Use quando o operador pedir agregação por CLIENTE ou por VEÍCULO/PLACA: esses campos não existem na fonte, e qualquer número apresentado como se existissem viria da coluna errada. "dimensao" é um de: cliente, veiculo.

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Quantas cargas por cliente?" · "Qual cliente teve mais cargas?" · "Quantas cargas por veículo?" · "Faturamento por placa" |
| **parâmetros** | `dimensao`:texto *(obrig.)* ∈ {cliente\|veiculo} |
| **alcança** |  |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | verificador confere depois |
| **timeout** | 500 ms |
| **baterias que citam o id** | `testes/ano-fora-de-alcance.test.ts` `testes/contrato-factual.test.ts` |

### `comparar_anos_luft`

Compara DOIS ANOS da operação LUFT: volume de cargas, faturamento, motoristas distintos ou margem. "ano_atual" e "ano_anterior" são um de: 2026, 2025, 2024. "metrica" é um de: contagem, valor_total, distintos, margem. "agrupar_por" é opcional e, quando informado (motorista, rota, origem/posto, destino/central), DECOMPÕE a diferença mostrando quem explica o movimento. Use para "compare 2025 com 2026", "qual ano teve mais cargas", "a margem melhorou", "qual central caiu mais", "quanto crescemos".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Compare 2025 com 2026" · "A margem melhorou de 2025 para 2026?" · "Qual ano teve mais cargas?" · "Qual central mais caiu de 2025 para 2026?" · "Quanto o faturamento cresceu em relação ao ano passado?" |
| **parâmetros** | `ano_atual`:texto ∈ {2026\|2025\|2024}<br>`ano_anterior`:texto *(obrig.)* ∈ {2026\|2025\|2024}<br>`metrica`:texto ∈ {contagem\|valor_total\|distintos\|margem} +8 sinônimos<br>`agrupar_por`:texto ∈ {motorista\|rota\|origem\|destino\|status\|status_normalizado\|nenhum} +23 sinônimos |
| **alcança** | internet, base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **evidência independente** | verificador próprio |
| **recuperação** | sinônimos declarados no esquema · valor padrão · verificador confere depois |
| **timeout** | 75000 ms |
| **baterias que citam o id** | `testes/holdout/cenarios.ts` |

## planilha genérica — 3

### `descrever_planilha`

Lê uma planilha (.xlsx ou .xls) de dados/documentos/ e devolve as abas disponíveis, as colunas do cabeçalho com o tipo predominante de cada uma e quantas linhas de dado tem — sem calcular nada sobre o conteúdo. "arquivo" é o nome do arquivo como está em dados/documentos/; "aba" é opcional (vazio = primeira aba com dado). Use para "o que tem essa planilha", "quais colunas tem o arquivo X.xlsx", "quantas linhas tem essa planilha".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "O que tem na planilha vendas.xlsx?" · "Quais colunas tem o arquivo relatorio.xlsx?" · "Quantas linhas tem essa planilha?" · "Lê a planilha estoque.xlsx e me diz o que ela contém" |
| **parâmetros** | `arquivo`:texto *(obrig.)*<br>`aba`:texto |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `arquivo` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 12000 ms |
| **baterias que citam o id** | `testes/habilidades-planilha-generica.test.ts` |

### `consultar_planilha_generica`

Conta, soma, tira média, mínimo ou máximo de uma planilha genérica de dados/documentos/, agrupando por qualquer coluna do cabeçalho REAL do arquivo — não uma lista fixa. "agrupar_por" e "coluna_metrica" recebem o NOME DA COLUNA como foi dito ("por região", "a coluna valor") — a habilidade casa isso com o cabeçalho de verdade; se não achar, ela diz quais colunas existem em vez de adivinhar. "metrica" é um de: contagem, soma, media, minimo, maximo (exige "coluna_metrica" quando não é contagem). "filtro_coluna"/"filtro_valor" filtram por igualdade antes de agregar, ambos opcionais. Use para "quanto vendemos por região", "qual cliente comprou mais", "soma da coluna valor por status".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Quanto vendemos por região na planilha vendas.xlsx?" · "Qual cliente tem mais pedidos no arquivo pedidos.xlsx?" · "Soma a coluna valor agrupado por status" · "Quantas linhas tem por categoria?" |
| **parâmetros** | `arquivo`:texto *(obrig.)*<br>`aba`:texto<br>`agrupar_por`:texto<br>`metrica`:texto ∈ {contagem\|soma\|media\|minimo\|maximo}<br>`coluna_metrica`:texto<br>`filtro_coluna`:texto<br>`filtro_valor`:texto |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `arquivo` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 15000 ms |
| **baterias que citam o id** | `testes/habilidades-planilha-generica.test.ts` |

### `diagnosticar_qualidade_planilha`

Analisa a qualidade dos dados de uma planilha de dados/documentos/: valores numéricos fora do padrão estatístico (outlier pela cerca de Tukey), colunas com taxa de vazio anormal, colunas dominadas por um único valor e linhas duplicadas — todas por convenção estatística padrão, nunca por regra de negócio do domínio representado na planilha. Levanta hipóteses sobre ONDE o dado é suspeito, com o grau de confiança que as evidências sustentam; nunca afirma a causa de negócio (atraso, erro de operação etc.). Use para "tem algo estranho nesses dados", "analisa a qualidade da planilha X", "essa planilha tem erro?".

| campo | valor |
|---|---|
| **entrada** (exemplos do manifesto) | "Essa planilha tem algum problema?" · "Analisa a qualidade dos dados de vendas.xlsx" · "Tem algo estranho nesses dados?" · "Encontra anomalias na planilha estoque.xlsx" |
| **parâmetros** | `arquivo`:texto *(obrig.)*<br>`aba`:texto |
| **alcança** | base da operação |
| **risco / repetir** | baixo / leitura |
| **segurança** | confirmação prévia: — · verificação obrigatória: — · planejável pela LLM: sim |
| **papel somente-leitura alcança** | — |
| **texto livre obrigatório** | `arquivo` |
| **evidência independente** | — *a resposta é o resultado* |
| **recuperação** | valor padrão |
| **timeout** | 20000 ms |
| **baterias que citam o id** | `testes/habilidades-planilha-generica.test.ts` |
