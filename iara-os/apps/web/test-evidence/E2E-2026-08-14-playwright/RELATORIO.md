# E2E real via Playwright — pipeline de habilidades — 2026-08-14

Servidor local isolado (porta 3056, código desta sessão, sem tocar nos dev
servers das outras sessões), login real da operadora, browser Chromium
headed dirigido por Playwright **exclusivamente pela interface** — digitar,
clicar Enviar, ler o balão, ler o Painel Técnico. Nenhuma chamada interna,
nenhum mock, nenhuma injeção de DOM. Evidência bruta: `resultados.json` +
um PNG por turno neste diretório.

Ambiente relevante: `ANTHROPIC_API_KEY` ativa (LLM real), `MS_GRAPH_TOKEN`
automático (planilha LUFT REAL conectada), mãos locais no processo do motor
(`criar_pasta` executa de verdade), `IARA_LATITUDE/IARA_CIDADE` presentes na
rodada 1 (comportamento de escritório configurado).

## Rodada 1 — 19 turnos, código pós-correção dos Bugs A e B

| Teste | Entrada | Rota (painel) | Skill/executor | Resultado real | Status |
|---|---|---|---|---|---|
| T01a/b | "Oi" / "Conte uma curiosidade." | `raciocinio_direto` | nenhuma (correto) | conversa | 🟢 |
| T02 | "Vai chover hoje?" | `plano_local` | `consultar_clima` | previsão real da posição do aparelho ("Região Metropolitana de Campinas, SP", 48%, 0.2mm) | 🟢 |
| T03 | "Vai chover em Valinhos hoje?" | `plano_local` | `consultar_clima` + geocodificação | **previsão de Valinhos, São Paulo** (48%, 0.9mm — dados distintos de Campinas, coordenada realmente diferente) | 🟢 Bug B fechado |
| T04a/b | "Como está o clima?" → "Valinhos" | `plano_local` → `raciocinio_direto` | clima → nenhuma | com localização disponível a IARA respondeu direto; "Valinhos" isolado foi salvo pelo contexto da conversa (honesto, citou a consulta anterior) — sem mecanismo formal nesta rodada | 🟡 → fechado na etapa final (ver §Rodada 2) |
| T05 | "Quantas cargas foram coletadas hoje na operação LUFT?" | **`plano_cognitivo`** | `consultar_cargas_luft` | **"hoje (14/08): 6 cargas" com OCIs reais** (210368 ARARANGUA→VACARIA, 209406 IPORA→RIO VERDE…) | 🟢 Bug A fechado |
| T06 | "Qual motorista tem mais cargas?" | `plano_cognitivo` | `consultar_estatisticas_cargas_luft` | **LINO — 209 cargas**, ranking completo | 🟢 |
| T07 | "Qual rota teve maior faturamento?" | `plano_cognitivo` | estatísticas LUFT | **Três Pontas → Pouso Alegre, R$ 336.351,00 em 192 cargas** | 🟢 |
| T08 | "Qual o total faturado?" | `plano_cognitivo` | estatísticas LUFT | **R$ 4.573.249,52 (2649 cargas)** | 🟢 |
| T09a-c | "Motoristas disponíveis agora?" (+2 variações) | `raciocinio_direto` | nenhuma | resposta honesta ("status de motorista não está em nenhuma fonte que eu alcance") — verdadeiro: não existe habilidade de disponibilidade | 🟡 roteamento por forma; fechado na etapa final |
| T10 | "Leia meus emails recentes." | `plano_cognitivo` | `ler_emails` → Graph real | **HTTP 400 real exposto honestamente** ("/me só vale em fluxo delegado") — bug de integração pré-existente descoberto | 🔴→fix na etapa final (`MS_GRAPH_CAIXA`) |
| T11 | "Envie uma mensagem para o motorista." | `plano_cognitivo` | `enviar_whatsapp` | SKILL IDENTIFICADA / EXECUÇÃO BLOQUEADA (sem credencial, dito com todas as letras) | 🟢 |
| T12 | "Crie uma pasta chamada TestePlaywright." | `plano_local` | `criar_pasta` | **pasta existia fisicamente em `C:\Users\daian\Desktop`** — verificada por PowerShell fora da IARA e removida | 🟢 efeito real |
| T13 | "Faça um diagnóstico do sistema." | `plano_local` | `diagnosticar_sistema` | painel real (Motor ONLINE win32, Braço, Banco…) | 🟢 |
| T14 | "O que você acha interessante sobre logística?" | `raciocinio_direto` | nenhuma (correto) | opinião, zero execução | 🟢 |
| T15 | "Qual foi a carga que eu fiz ontem às 15h37?" | `plano_cognitivo` | LUFT | consultou o dado REAL, explicou que hora não é filtrável, deu o total de ontem (16 cargas) — **zero alucinação** | 🟢 |

**O critério central foi provado**: pergunta operacional curta → intenção →
skill escolhida pela LLM → executor real → dado real da planilha → resposta
na interface. Não é mais `rota == plano_cognitivo` como proxy: são os OCIs,
os valores em reais e a pasta no disco.

## Etapa final — pendências corrigidas após a rodada 1

1. **Descoberta de capacidades** (`DescobertaCapacidades.ts`): o portão de
   rota ganhou um terceiro sinal, por ASSUNTO — índice léxico construído dos
   próprios manifestos do catálogo (tokens específicos, frequência de
   documento como stopword automática). "Motoristas disponíveis agora?"
   passa a alcançar `plano_cognitivo` sem nenhum interrogativo nem verbo de
   comando — e sem nenhuma âncora nova: habilidade futura entra no índice
   pelo próprio manifesto (Open/Closed).
2. **Intenção pendente multiturno** (`ResultadoHabilidade.pendencia` +
   Kernel): habilidade que responde pedindo um parâmetro declara qual;
   o Kernel guarda `{habilidade, parametros, parametro}` por UM turno; a
   resposta curta seguinte vira o valor e a MESMA habilidade roda — pelo
   caminho normal (esquema, porteiro, jornal). `consultar_clima` é a
   primeira adotante ("Me diga a cidade…" → "Valinhos" → executa).
3. **Graph `/me` em fluxo de aplicativo** (`MS_GRAPH_CAIXA`): client
   credentials nunca pôde usar `/me`; com a caixa declarada a rota vira
   `/users/{caixa}/messages`. Sem a variável, comportamento antigo mantido.
4. **Fronteira de efeitos**: `ClientePlanilhaOcis.ts` (débito de outro
   commit de hoje) declarado no teste A2 com justificativa — leitura pura,
   zero POST (verificado por grep antes de declarar).

Suíte após a etapa final: **886/886 verde**, `tsc --noEmit` limpo.
Testes novos: `descoberta-capacidades.test.ts` (6),
`pendencia-parametro.test.ts` (2, atravessando o Kernel real em dois turnos),
`clima-geocodificacao.test.ts` (5), + seções novas em `decisao.test.ts` e
`estabilizacao.test.ts`.

## Rodada 2 — validação Playwright da etapa final

Servidor reiniciado com o código final e coordenadas de escritório em
BRANCO (o cenário da produção). Resultados em
`evidencia-rodada2/resultados.json` + PNGs (R01…R06).

| Teste | Entrada | Rota | Resultado real | Status |
|---|---|---|---|---|
| R01 | "Quantas cargas foram coletadas hoje na operação LUFT?" | `plano_cognitivo` | mesmos 6 OCIs reais da rodada 1 — regressão zero | 🟢 |
| R02 | "Motoristas disponíveis agora?" | **`plano_cognitivo`** (antes: `raciocinio_direto`) | a descoberta de capacidades levou a frase ao planejador; a IARA CONSULTOU o dado real e respondeu com o inverso disponível ("quem está comprometido…"), explicando que disponibilidade não existe em fonte nenhuma — honesto E fundamentado em dado | 🟢 fechou o buraco da pergunta implícita |
| R03a | "Como está o clima?" | `plano_local` | a geolocalização do navegador continuou concedida no perfil do Playwright, então o aparelho respondeu (Campinas, 19,6°C) — o caminho "pergunta a cidade" não disparou NESTA execução | 🟢 (comportamento correto para quem tem localização) |
| R03b | "Valinhos" | **`plano_cognitivo`** | **a previsão de Valinhos veio (19,1°C, céu limpo)** — a mensagem isolada foi roteada semanticamente e `consultar_clima{cidade: Valinhos}` executou | 🟢 |
| R04 | "Crie uma pasta chamada TestePlaywright2." | `plano_local` | **pasta verificada em disco por PowerShell** (criada 23:03:30) e removida | 🟢 efeito real |
| R05 | "O que você acha sobre logística?" | conversa | zero execução; lembrou da resposta anterior e trouxe ângulo novo | 🟢 |
| R06 | "Leia meus emails recentes." | cognitivo | **o 400 do `/me` sumiu** — com `MS_GRAPH_CAIXA`, a rota `/users/{caixa}` alcançou a caixa e o erro restante é REAL e acionável: o app do Azure AD não tem o escopo Mail.Read. Falha honesta, um degrau adiante do bug anterior | 🟡 infra (Azure), não código |

**Nota de método (R03)**: o caminho "IARA pergunta a cidade → pendência → resposta
curta executa" não foi exercitado na interface porque a geolocalização do
perfil permaneceu concedida — o aparelho sempre respondia primeiro, que é o
comportamento correto. O mecanismo de pendência está provado por teste
automatizado que atravessa o Kernel real em dois turnos
(`testes/pendencia-parametro.test.ts`), no cenário exato da produção (sem
coordenadas, sem geolocalização). Na prática os dois caminhos convergem: a
resposta curta com nome de cidade também resolve pela rota cognitiva, como
R03b provou ao vivo.

## Veredito

🟡 **APROVADO COM DÉBITOS** — o pipeline
`pergunta → intenção → habilidade → executor → dado real → resposta` está
comprovado pela interface, com efeito verificado por fora (disco) e dado real
(planilha LUFT). Débitos remanescentes, todos nomeados: escopo Mail.Read no
app do Azure AD (infra), `resolver_confirmacao{confirmo}` de energia nunca
testado até o fim (por desenho), pendência multiturno provada por teste de
kernel mas não pela interface (convergência com a rota cognitiva demonstrada
ao vivo).

## Limitações honestas

- Playwright roda na máquina da operadora; login manual dela (política: a
  automação nunca digita senha).
- A planilha LUFT é a REAL — os números conferidos são os do dia; não há
  fixture congelada para comparação bit a bit.
- `resolver_confirmacao{confirmo}` de energia continua nunca testado até o
  fim, por desenho (desligaria a máquina real).
- Voz, vigília e projeção 3D fora do escopo desta bateria.
