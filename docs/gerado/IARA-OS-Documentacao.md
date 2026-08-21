# IARA OS — Documentação Técnica

> Gerado de `npm run docs` no commit `54f7d1e`. Não editar: as seções derivadas do código são reescritas a cada execução.

## Visão geral

A IARA é a inteligência corporativa residente da Atos Log: um mordomo digital
que atende até cinco operadores, com isolamento de memória entre eles, e que
projeta o próprio trabalho numa sala em pixel art.

O produto **não é um dashboard**. É um escritório. A diferença não é estética —
é o critério que decide toda adição futura: ao propor qualquer elemento novo, a
pergunta é *"que objeto da sala é isto?"*, nunca *"que componente de dashboard
preciso?"*.

### O que a torna diferente de um chat com LLM

**Cerca de 80% das perguntas operacionais nunca chegam ao modelo.** Camadas mais
baratas decidem antes:

| Camada | Onde decide | Latência | Custo |
|---|---|---|---|
| Roteador semântico | percepção e planejador determinístico | microssegundos | zero |
| Ações nativas | `OrquestradorAcoes` | 1–8 ms local, cerca de 1,1 s com rede | zero |
| RAG schema-only | `RagHistorico` | cerca de 4 ms | zero |
| Raciocínio (Claude) | `ClienteClaude` | streaming | tokens |

**Transparência espacial.** Quando um assistente comum processa, aparece uma
borda genérica brilhando. Aqui, o objeto que está trabalhando é o objeto que
acende: ação local acende o terminal, busca histórica acende a estante, clima
acende a janela, raciocínio pesado põe o rack em pulsação. O evento visual é
emitido *antes* de o trabalho começar — é isso que elimina a sensação de
travamento.

**A interface nunca inventa vida.** Todo evento visual nasce de um fato
observado no laço do agente. Se um objeto acende, é porque a capacidade
correspondente está em uso agora.

### Sem chave da Anthropic, o sistema funciona

Sem `ANTHROPIC_API_KEY` a IARA roda completa em modo local — clima,
infraestrutura, histórico de incidentes, hora, busca web — e **avisa isso na
interface** em vez de improvisar resposta. É decisão de produto, não degradação:
um assistente que inventa quando não sabe é pior que um que se cala.

## Escopo

### O que está dentro

- Atendimento conversacional a até cinco operadores, por navegador, PWA
  instalável, aplicativo desktop (Tauri) e WhatsApp.
- Isolamento de memória por operador, com sondagem cruzada barrada por regra
  determinística antes de chegar ao modelo.
- Consultas operacionais: clima, infraestrutura, histórico de incidentes,
  agenda, hora, busca web.
- Ações locais na máquina do operador via IARA Desktop, sempre com confirmação
  humana.
- Projeção do estado cognitivo em duas formas: o escritório em pixel art e a
  presença 3D.
- Trilha de auditoria em jornal append-only, com selo HMAC quando
  `IARA_CHAVE_PROVA` está configurada.

### O que está fora, e por quê

- **Não é um ERP nem substitui um.** Ela consulta dados operacionais; não é
  sistema de registro deles.
- **Não decide sozinha.** Toda ação de risco alto exige confirmação explícita. A
  LLM emite intenções estruturadas; quem valida e aplica é o `EstadoAtomico`.
- **Não é multi-tenant.** O roster é lista fechada em `lib/operadores.ts`,
  revisada em commit. Não existe cadastro automático em lugar nenhum do código.
- **Não usa a persona da Convai.** Apenas o endpoint de síntese de fala é
  consumido. Colocar o SDK de personagem no lugar do roteador e do RAG mandaria
  mensagem de operador para fora do perímetro.

### Limites de capacidade declarados no código

| Limite | Valor | Onde |
|---|---|---|
| Operadores no roster | 5 | `lib/operadores.ts` |
| Espelhos simultâneos por operador | 4 | `servidor/barramento/Porta.ts` |
| Apresentações por minuto, pré-autenticação | 120 | `servidor/barramento/Porta.ts` |
| Lembretes pendentes por operador | 50 | `servidor/nucleo/Agenda.ts` |

## Arquitetura

### Onde as coisas vivem

```
iara-os/apps/web/
  lib/            contrato de domínio, compartilhado servidor e cliente
  servidor/       motor cognitivo
    nucleo/       estado, kernel, ações, RAG, teoria da mente, Claude
    barramento/   fila de telemetria e sessão WebSocket
    canais/       WhatsApp (Cloud API oficial da Meta)
  app/, components/, hooks/   camada de projeção (Next)
  dados/          base determinística e shards privados
  supabase/       schema.sql
```

### Duas projeções, um contrato

`SnapshotCognitivo` (`lib/snapshot.ts`) é a **única** coisa que atravessa a
fronteira do kernel. Duas projeções o consomem e nenhuma conhece o servidor:

- **Escritório** — a sala em pixel art. Lê `luzes` e `estagio`.
- **Presença** — a IARA em React Three Fiber. Lê `expressao`, `capacidades`,
  `plano` e `telemetria`.

Trocar de projeção não muda uma linha do servidor. Nenhum componente conhece
nome de morph target, pela mesma razão que nenhum conhece nome de arquivo de
sprite: a tradução mora em `components/projecao/mapaFacial.ts`.

### Os quatro problemas invisíveis, e onde estão resolvidos

**1. Dessincronização do laço de eventos.** O motor produz eventos em
microssegundos; o React desenha a 60 FPS. `barramento/SessaoOperador.ts`
aglutina micro-eventos e drena em janelas curtas — só marcos de transição sobem
para a sala. Fala é exceção: drena na hora, porque latência percebida é o
produto.

**2. Estouro de contexto por histórico de erros.** `nucleo/RagHistorico.ts`
nunca devolve log bruto — só hash, assinatura sintática de uma linha e a
resolução anotada pelo time. O log de dez mil linhas não existe na base, então
não há como injetá-lo.

**3. Contrapressão no WebSocket.** `barramento/FilaTelemetria.ts` é um anel de
100 pacotes com descarte semântico: pulsos e logs velhos são descartados; fala e
transição, nunca. Na reconexão vai o estado consolidado, não a enxurrada
retroativa — por isso o avatar não se teletransporta. O cliente ainda descarta
pacote com sequência menor que a última aplicada.

**4. Nomenclatura.** Domínio inteiro em português. Infraestrutura genérica pode
herdar nome de mercado (`WebSocket`, `AbortController`).

### Invariantes não negociáveis

- **A LLM não escreve estado.** Ela emite intenções estruturadas; o
  `EstadoAtomico` valida e aplica sob trava. Intenção inválida é descartada com
  log, nunca aplicada pela metade.
- **O RAG nunca injeta log bruto.**
- **Shards privados.** O caminho do shard é derivado do `id_usuario` da sessão. O
  operador nunca informa qual shard quer ler.
- **Presença não é informação.** Animação de ambiente nunca reage a dado;
  animação reativa só muda porque um campo do estado mudou. Misturar as duas faz
  a tela mentir.
- **Hierarquia espacial fixa:** Ambiente, Objetos, HUD, Conteúdo, Painéis. O
  escritório domina o campo visual; o painel de trabalho é a camada mais externa
  e recuada.
- **Nunca vermelho saturado.** Alerta é coral quente.

### Cancelamento preemptivo

Mensagem nova aborta o turno anterior no ato, inclusive um stream do Claude em
andamento. Nenhuma trava global é segurada durante chamada de rede — por isso o
cancelamento é instantâneo e a interface nunca congela.

## Stack e dependências

Derivado de `iara-os/apps/web/package.json`. Runtime único em TypeScript: o motor
cognitivo e a interface são o mesmo processo por padrão.

| Pacote | Versão declarada | Papel |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.68.0` | Camada de raciocínio (Claude). Opcional: sem chave o sistema roda local. |
| `@react-three/drei` | `^10.7.8` | Auxiliares de cena para a projeção "presença". |
| `@react-three/fiber` | `^9.7.0` | React Three Fiber — o avatar 3D. |
| `@supabase/supabase-js` | `^2.112.2` | Persistência e identidade do operador. |
| `dotenv` | `^16.4.7` | Leitura de `.env.local` fora do Next. |
| `msedge-tts` | `^2.0.7` | Voz neural gratuita (pt-BR-FranciscaNeural), sintetizada no servidor. |
| `next` | `^15.5.23` | Camada de projeção (interface). |
| `react` | `^19.0.0` | Interface. |
| `react-dom` | `^19.0.0` | Interface. |
| `three` | `^0.180.0` | Motor 3D sob o React Three Fiber. |
| `tsx` | `^4.19.2` | Execução de TypeScript sem passo de build — é como o motor sobe. |
| `ws` | `^8.18.0` | WebSocket do barramento entre motor e projeção. |

### Dependências de desenvolvimento

| Pacote | Versão declarada |
|---|---|
| `@types/node` | `^22.10.7` |
| `@types/react` | `^19.0.7` |
| `@types/react-dom` | `^19.0.3` |
| `@types/three` | `^0.180.0` |
| `@types/ws` | `^8.5.13` |
| `typescript` | `^5.7.3` |

### Versões forçadas (`overrides`)

Existem para fechar aviso de segurança em dependência transitiva — não são
escolha de funcionalidade.

| Pacote | Versão mínima |
|---|---|
| `postcss` | `^8.5.26` |
| `sharp` | `^0.35.3` |

## Superfície de rede

Derivado de `servidor/principal.ts` e `servidor/canais/`.

| Caminho | Origem no código | O que é |
|---|---|---|
| `/saude` | `servidor/principal.ts` | Healthcheck. É o caminho que o Railway consulta (`railway.toml`). |
| `/canais/whatsapp` | `servidor/canais/PortaWhatsapp.ts` | Webhook da Cloud API oficial da Meta. |

As páginas do Next são servidas pelo mesmo processo em modo unificado. Em
`IARA_MODO=headless` o motor não instancia o Next e responde apenas aos
caminhos acima.

### Páginas

- `/` — `app/page.tsx`
- `/marca/esfera` — `app/marca/esfera/page.tsx`
- `/marca/portaria` — `app/marca/portaria/page.tsx`

## Habilidades do kernel

Derivado de `servidor/nucleo/kernel/habilidades/` — **20 habilidades**, lidas do
manifesto em tempo de execução. Esta é literalmente a lista que o planejador
oferece ao modelo: se um item aparece aqui, a IARA pode planejá-lo.

| id | Nome | Domínio | Risco | Custo | Efeito |
|---|---|---|---|---|---|
| `abrir_aplicativo` | Abrir aplicativo | automacao | médio | zero | escrita_nao_idempotente |
| `acionar_energia` | Energia da máquina | automacao | ALTO | zero | escrita_idempotente |
| `agendar_lembrete` | Agendar lembrete | memoria | médio | zero | escrita_nao_idempotente |
| `buscar_documento_sharepoint` | Busca no SharePoint | operacoes | baixo | zero | só lê |
| `buscar_historico` | Histórico de incidentes | memoria | baixo | zero | só lê |
| `cancelar_lembrete` | Cancelar lembrete | memoria | médio | zero | escrita_idempotente |
| `capturar_tela` | Captura de tela | automacao | médio | zero | escrita_nao_idempotente |
| `consultar_agenda` | Relógio e calendário | memoria | baixo | zero | só lê |
| `consultar_clima` | Radar meteorológico | pesquisa | baixo | zero | só lê |
| `consultar_infraestrutura` | Base de centrais | operacoes | baixo | zero | só lê |
| `consultar_memoria_corporativa` | Memória corporativa | memoria | baixo | zero | só lê |
| `criar_pasta` | Criar pasta | automacao | médio | zero | escrita_idempotente |
| `enviar_whatsapp` | Envio de WhatsApp | comunicacao | ALTO | zero | escrita_nao_idempotente |
| `executar_consulta_sql` | Consulta ao banco operacional | automacao | baixo | zero | só lê |
| `extrair_texto_documento` | Extração de texto de documento | automacao | baixo | zero | só lê |
| `ler_emails` | Caixa de entrada | comunicacao | baixo | zero | só lê |
| `listar_lembretes` | Lembretes marcados | memoria | baixo | zero | só lê |
| `pesquisar_web` | Pesquisa web | pesquisa | baixo | zero | só lê |
| `recusar_por_sigilo` | Cláusula de sigilo | memoria | baixo | zero | só lê |
| `resolver_confirmacao` | Resolver confirmação pendente | automacao | ALTO | zero | escrita_nao_idempotente |

### As de risco alto

Risco alto significa **efeito que alcança terceiros ou o mundo fora do processo**.
Elas exigem confirmação do operador e permissão `externo` — ver
`servidor/nucleo/kernel/PoliticaRisco.ts` e `Papeis.ts`.

- `acionar_energia` — Energia da máquina. Permissões: `escrita`.
- `enviar_whatsapp` — Envio de WhatsApp. Permissões: `rede`, `externo`.
- `resolver_confirmacao` — Resolver confirmação pendente. Permissões: `escrita`.

### Parâmetros declarados

O esquema é a trava: parâmetro não declarado não chega ao provedor
(ver `Fronteira.ts`). Um campo a mais no plano derruba a chamada inteira.

| Habilidade | Parâmetro | Tipo | Padrão | Valores aceitos |
|---|---|---|---|---|
| `consultar_clima` | `horizonte` | texto | `agora` | `agora`, `hoje`, `amanha` |
| `consultar_infraestrutura` | `uf` | texto | `GERAL` | `GERAL`, `MT`, `MS`, `GO`, `SP`, `PR`, `RO` |
| `pesquisar_web` | `consulta` | texto | — | — |
| `buscar_historico` | `consulta` | texto | — | — |
| `executar_consulta_sql` | `consulta` | texto | — | `centrais_por_uf`, `incidentes_por_sistema`, `centrais_inativas` |
| `executar_consulta_sql` | `parametros` | texto | `{}` | — |
| `consultar_memoria_corporativa` | `consulta` | texto | — | — |
| `extrair_texto_documento` | `arquivo` | texto | — | — |
| `ler_emails` | `filtro` | texto | — | — |
| `ler_emails` | `limite` | numero | `10` | — |
| `enviar_whatsapp` | `destinatario` | texto | — | — |
| `enviar_whatsapp` | `mensagem` | texto | — | — |
| `buscar_documento_sharepoint` | `consulta` | texto | — | — |
| `criar_pasta` | `nome` | texto | — | — |
| `criar_pasta` | `local` | texto | `area_de_trabalho` | `area_de_trabalho`, `documentos`, `downloads` |
| `abrir_aplicativo` | `aplicativo` | texto | — | — |
| `capturar_tela` | `local` | texto | `documentos` | `area_de_trabalho`, `documentos`, `downloads` |
| `acionar_energia` | `acao` | texto | `desligar` | `desligar`, `reiniciar`, `suspender` |
| `resolver_confirmacao` | `resposta` | texto | — | `confirmo`, `cancelar` |
| `agendar_lembrete` | `assunto` | texto | — | — |
| `agendar_lembrete` | `quando` | texto | — | — |
| `cancelar_lembrete` | `termo` | texto | `` | — |

## Regras de negócio com valor no código

Cada linha diz **onde a regra está definida** e **por que ela existe** — a
justificativa é o comentário colado à declaração, não uma paráfrase. Valor cru
foi convertido para unidade legível.

| Regra | Valor | Onde | Por que existe |
|---|---|---|---|
| `CONFIANCA_SUFICIENTE` | **85%** | `servidor/nucleo/kernel/FuncaoExecutiva.ts`:77 | Acima disto, a percepção reconheceu terreno conhecido e não há por que gastar token para planejar. |
| `JANELA_ANTECEDENTE` | **6** | `servidor/nucleo/kernel/Kernel.ts`:166 | Turnos que o detector de ambiguidade consulta para procurar antecedente. Deliberadamente menor que a janela do raciocínio (20): resolver "aquele relatório" com algo dito há trinta mensagens não é recuperar contexto, é inventar um vínculo. Se o assunto sumiu por seis turnos, perguntar é o comporta… |
| `MAX_ESPELHOS` | **4** (máximo) | `servidor/barramento/Porta.ts`:45 | Espelhos simultâneos por operador. O mesmo operador pode estar no app desktop, numa aba do Chrome (a que escuta o "ei IARA") e no celular ao mesmo tempo — cada tela é uma sessão de transporte, o kernel é um só. O teto existe porque sessão zumbi de reconexão (o TCP antigo expira minutos depois) oc… |
| `APRESENTACOES_POR_MINUTO` | **120/min** | `servidor/barramento/Porta.ts`:77 | ESTRANGULAMENTO PRÉ-AUTENTICAÇÃO — a janela que não tinha dono. `Kernel.processar` já tem `LimiteVazao`, e ele protege bem o que vem DEPOIS da identidade estar resolvida. O `ola` vinha antes: cada apresentação dispara um `verificarToken`, que é uma chamada de rede ao Supabase, e a única guarda er… |

## Banco de dados

Derivado de `supabase/schema.sql`. **A persistência é opcional**: sem
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o motor lê `dados/*.json` e grava
shards em arquivo, sem trocar uma linha de código.

Tabelas: **6**.

### `public.centrais`

----------------------------------------------------------------------------- 1. Infraestrutura (substitui dados/infraestrutura.json) -----------------------------------------------------------------------------

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `bigint` | `generated always as identity primary key` |
| `nome` | `text` | `not null` |
| `uf` | `text` | `not null` |
| `ativa` | `boolean` | `not null default true` |
| `veiculos` | `integer` | `not null default 0 check (veiculos >= 0)` |
| `atualizado_em` | `timestamptz` | `not null default now()` |

### `public.erros_assinaturas`

----------------------------------------------------------------------------- 2. RAG schema-only (substitui dados/historico-erros.json)  REGRA PÉTREA: não existe coluna de log bruto aqui, e isso é proposital. O que não é armazenado não pode ser injetado no contexto do modelo. -----------------------------------------------------------------------------

| Coluna | Tipo | Restrições |
|---|---|---|
| `hash` | `text` | `primary key` |
| `assinatura` | `text` | `not null` |
| `sistema` | `text` | `not null` |
| `primeira_ocorrencia` | `date` | — |
| `ultima_ocorrencia` | `date` | — |
| `ocorrencias` | `integer` | `not null default 1 check (ocorrencias > 0)` |
| `resolucao` | `text` | `not null` |

### `public.memoria_registros`

----------------------------------------------------------------------------- 3. Memória operacional — shards privados  O isolamento continua sendo garantido pelo motor, que deriva o id_usuario da sessão do socket. O banco é a terceira linha de defesa, não a primeira. -----------------------------------------------------------------------------

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `id_usuario` | `text` | `not null` |
| `instante` | `timestamptz` | `not null default now()` |
| `papel` | `text` | `not null check (papel in ('operador', 'iara'))` |
| `texto` | `text` | `not null` |
| `destino` | `text` | — |

### `public.insights_relacionais`

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `id_usuario` | `text` | `not null` |
| `gerado_em` | `timestamptz` | `not null default now()` |
| `titulo` | `text` | `not null` |
| `detalhe` | `text` | `not null` |
| `proativo` | `boolean` | `not null default true` |

### `public.operador_preferencias`

A ficha que o operador escreveu sobre si: como ser chamado, como ser tratado, o que ele quer que a IARA leve em conta. Uma linha por operador — `id_usuario` é a chave primária, e é o upsert que mantém isso verdadeiro.

| Coluna | Tipo | Restrições |
|---|---|---|
| `id_usuario` | `text` | `primary key` |
| `preferencias` | `jsonb` | `not null default '{}'::jsonb` |
| `atualizado_em` | `timestamptz` | `not null default now()` |

### `public.agenda_lembretes`

Lembretes que o operador deixou marcados. `entregue_em` nulo = ainda espera; é esse campo que faz um lembrete tocar UMA vez, e não a cada varredura do ciclo autônomo. O índice parcial é a consulta quente: "o que vence agora, deste operador".

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `id_usuario` | `text` | `not null` |
| `criado_em` | `timestamptz` | `not null default now()` |
| `vence_em` | `timestamptz` | `not null` |
| `assunto` | `text` | `not null` |
| `entregue_em` | `timestamptz` | — |

### Índices

| Índice | Tabela | Colunas |
|---|---|---|
| `centrais_uf_ativa_idx` | `public.centrais` | `uf, ativa` |
| `erros_sistema_idx` | `public.erros_assinaturas` | `sistema` |
| `memoria_usuario_instante_idx` | `public.memoria_registros` | `id_usuario, instante desc` |
| `insights_usuario_proativo_idx` | `public.insights_relacionais` | `id_usuario, proativo` |
| `agenda_pendentes_idx` | `public.agenda_lembretes` | `id_usuario, vence_em` |

### Row Level Security

RLS habilitado em **6 tabelas**: `public.centrais`, `public.erros_assinaturas`, `public.memoria_registros`, `public.insights_relacionais`, `public.operador_preferencias`, `public.agenda_lembretes`.

Nesta arquitetura a política nega tudo para `anon`. Quem lê e escreve é o
motor, com a `service_role` — que **ignora RLS por definição** e por isso só
existe no servidor. O navegador usa a `anon key` para uma coisa: obter o
token do operador logado.

## Integrações e variáveis de ambiente

Derivado de `.env.example`. **Este documento traz apenas o NOME de cada
variável e o comentário que a acompanha no repositório — nenhum valor.** Os
valores vivem em `.env.local` (nunca versionado) e no painel do host.

### Camada de raciocínio (opcional)

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `ANTHROPIC_API_KEY` | vazia — preencher | Sem chave, a IARA roda completa em modo local (clima, banco, RAG, busca) e avisa na interface. Ela não improvisa resposta. |
| `IARA_MODELO` | declarado | *(a preencher)* |
| `IARA_ESFORCO` | declarado | *(a preencher)* |

### Persistência (opcional)

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `SUPABASE_URL` | declarado | Sem estas variáveis, o motor lê dados/*.json e grava shards em arquivo. Com elas, passa a usar Supabase automaticamente. Não há troca de código. |
| `SUPABASE_SERVICE_ROLE_KEY` | vazia — preencher | ⚠️ service_role IGNORA todas as políticas de RLS. Ela é a chave de admin do banco. Só existe no servidor. NUNCA prefixe com NEXT_PUBLIC_, nunca coloque em componente de cliente, nunca commite. Vazou = banco inteiro exposto. |

### Supabase no navegador (o LOGIN)

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | vazia — preencher | O navegador usa estas para UMA coisa: obter o access token do operador logado (components/Portaria.tsx). Quem lê e escreve dados continua sendo só o motor, com a service_role. A anon key é pública por natureza e depende de RLS — que nesta arquitetura nega tudo para `anon`. SEM ESTAS DUAS o app cai no seletor de operador: identidade que o CLIENTE escolhe, com faixa de aviso na tela. Aceitável em re |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | vazia — preencher | *(a preencher)* |

### Voz

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `IARA_VOZ_NEURAL` | vazia — preencher | PADRÃO (V4, sem configurar nada): voz NEURAL FEMININA gratuita (pt-BR-FranciscaNeural, o serviço de vozes "Natural" do Edge), sintetizada no servidor e servida em /voz/<hash>.mp3. O texto da resposta é enviado ao serviço da Microsoft — o mesmo que o navegador Edge faz com vozes Natural. Para voz 100% local (síntese do navegador, qualidade inferior): |
| `IARA_VOZ_EDGE` | vazia — preencher | Outra voz neural, se quiser trocar (ex.: pt-BR-ThalitaNeural): |
| `CONVAI_API_KEY` | vazia — preencher | Síntese de fala via Convai (qualidade premium, paga). Quando configurada, tem precedência sobre a voz neural gratuita. ⚠️ A Convai NÃO pensa aqui. Só o endpoint de TTS é usado: ele recebe o texto que o Kernel já produziu e devolve áudio. O personagem do painel da Convai tem persona e cérebro próprios, e nada disso entra no sistema — usar o SDK de personagem colocaria uma LLM de terceiro no lugar d |
| `CONVAI_VOZ` | vazia — preencher | `voice_value` da voz escolhida. Liste as da sua conta com: npm run vozes Vozes marcadas como "realtime" NÃO funcionam no endpoint de TTS. |
| `CONVAI_ENCODING` | declarado | wav ou mp3. mp3 é o padrão: mesma fala, uma fração dos bytes na rede. |

### Canal WhatsApp (opcional)

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `WHATSAPP_TOKEN` | vazia — preencher | Cloud API OFICIAL da Meta. Não use Baileys/Venom/WPPConnect: violam os Termos do WhatsApp e o resultado típico é o número da empresa ser banido. Onde pegar cada um (developers.facebook.com → seu app → WhatsApp): WHATSAPP_TOKEN API Setup → token permanente do System User WHATSAPP_PHONE_ID API Setup → "Phone number ID" (NÃO é o telefone) WHATSAPP_APP_SECRET Configurações → Básico → Chave Secreta do  |
| `WHATSAPP_PHONE_ID` | vazia — preencher | *(a preencher)* |
| `WHATSAPP_APP_SECRET` | vazia — preencher | *(a preencher)* |
| `WHATSAPP_VERIFY_TOKEN` | vazia — preencher | *(a preencher)* |

### Barramento

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `NEXT_PUBLIC_IARA_WS` | vazia — preencher | Motor e web no mesmo processo, mesma porta, barramento em /barramento. Deixe vazio: o cliente deriva o endereço da página e usa wss:// sozinho quando servido por HTTPS. Só preencha se separar o motor em outro host. ATENÇÃO — NEXT_PUBLIC_* é embutida no bundle em TEMPO DE BUILD. Trocar o domínio do motor exige REDEPLOY do front, não basta editar a variável no painel. O sintoma de esquecer isso é a  |
| `NEXT_PUBLIC_IARA_MOTOR` | vazia — preencher | Origem HTTP do motor, para o áudio da voz (os bytes vivem na MEMÓRIA dele). Deixe vazio: é derivada de NEXT_PUBLIC_IARA_WS. Só preencha se o WebSocket e o HTTP do motor moram em endereços diferentes — duas variáveis independentes divergem no dia em que alguém troca o domínio e atualiza só uma, e aí a IARA conversa normalmente e fica MUDA. |
| `IARA_PORTA` | declarado | Porta local. Hosts de nuvem (Railway, Render, Fly) injetam PORT e vencem. |
| `IARA_MODO` | vazia — preencher | `headless` = motor SEM interface (o Next é servido noutro host: Vercel). Vazio ou qualquer outro valor = unificado, os dois no mesmo processo. Mantenha unificado por padrão: é o interruptor que devolve o sistema inteiro a um endereço só se o front na nuvem quebrar. |
| `IARA_ORIGENS` | vazia — preencher | Origens autorizadas a abrir o barramento, separadas por vírgula. Navegador NÃO aplica CORS a WebSocket — esta lista é a única trava, e em modo headless ela é a única MESMO: "mesma origem" não existe quando o front mora noutro domínio. Vazio + headless = ninguém consegue conectar. Ex.: https://iara.atoslog.com.br Curinga de subdomínio (https://*.vercel.app) é aceito, mas o motor RECUSA SUBIR com cu |
| `IARA_AMBIENTE` | vazia — preencher | Marque `homologacao` APENAS num motor de preview, com banco próprio. Nunca no de produção. |

### Perímetro operacional (Open-Meteo)

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `IARA_LATITUDE` | declarado | Estas coordenadas são a QUEDA, não a primeira escolha. Quando a pessoa concede a permissão de localização do navegador (pedida uma vez por sessão), a previsão sai de onde ELA está — uma coordenada fixa no servidor está errada para todo mundo que sai do escritório, e no celular esse é o caso comum. A posição do aparelho vive só em memória do processo e nunca é gravada: ver `servidor/nucleo/LocalOpe |
| `IARA_LONGITUDE` | declarado | *(a preencher)* |
| `IARA_CIDADE` | declarado | *(a preencher)* |

### -

| Variável | Padrão no exemplo | Para que serve |
|---|---|---|
| `IARA_CHAVE_PROVA` | comentada (opcional) | O jornal em dados/operacoes/*.jsonl É a trilha de auditoria do sistema: é dele que a IARA reconstrói, depois de um restart, o que pode ter acontecido no mundo. Sem esta chave, a reidratação valida só ESTRUTURA (formato, estado legal e dono do arquivo) — quem conseguir escrever no disco consegue inserir uma operação em estado "verificada" que nunca existiu, e a IARA passa a jurar ter conferido um e |
| `IARA_ADMINS` | comentada (opcional) | Listas separadas por vírgula, casando por id_usuario OU por e-mail. Quem não aparece em lista nenhuma é 'operador', que é o padrão de sempre. administrador acrescenta a permissão 'externo' (agir em nome do operador alcançando terceiros: WhatsApp, e-mail, publicação) somente_leitura remove escrita e limita o catálogo a consultas A restrição vence a concessão: quem estiver nas duas listas fica somen |
| `IARA_SOMENTE_LEITURA` | comentada (opcional) | *(a preencher)* |

> Onde obter cada valor está no próprio `.env.example`, junto da variável.
Chaves de terceiro (Anthropic, Supabase, Convai, Meta/WhatsApp) saem do painel
de cada fornecedor e vão para o cofre do host — nunca para um arquivo versionado.

## Rotinas em segundo plano

Não há cron externo: o motor é um processo longo e agenda em si mesmo.
Derivado de `servidor/nucleo/CicloAutonomo.ts` e `servidor/nucleo/Agenda.ts`.

| Rotina | Cadência | Onde está definida |
|---|---|---|
| Varredura do ciclo autônomo | a cada **15 s** | `CicloAutonomo.ts` → `INTERVALO_MS` |
| Consolidação de memória | diária, às **03:00** | `CicloAutonomo.ts` → `HORA_CONSOLIDACAO` |

## Fluxos operacionais

### Um turno de conversa

1. O operador fala (texto, voz no navegador, ou mensagem no WhatsApp).
2. A **percepção** extrai âncoras e calcula confiança.
3. Se a confiança passa do limiar, o **planejador determinístico** monta o plano
   sem custo de token. Senão, o plano vem do modelo.
4. O **porteiro de autorização** confere papel, permissões e risco de cada
   passo. Passo barrado não executa, e a recusa é dita — não silenciada.
5. A **função executiva** roda os passos; cada efeito vira linha no jornal de
   operações, nos estados `autorizada`, `executando`, `verificada`.
6. A **enunciação** compõe a resposta a partir do que realmente aconteceu.
7. O **snapshot** é publicado no barramento; a sala acende o que está em uso.

### Ação de risco alto

Nenhuma executa sem confirmação. O ciclo é: a IARA anuncia o que vai fazer e
arma uma pendência; o operador confirma; só então o efeito acontece. A pendência
é vinculada ao par (operador, sessão) e tem validade — pedido antigo não é
confirmado por engano.

> **Débito conhecido (D2):** a pendência vive em memória de processo. Um restart
> a perde. Degrada para o lado seguro — a ação nunca executa — mas o operador não
> é avisado de que o pedido evaporou.

### Isolamento entre operadores

Defesa em três camadas, e a primeira não é o prompt:

1. **Arquitetura** — o caminho do shard é derivado do `id_usuario` da sessão, com
   sanitização contra travessia de caminho.
2. **Roteador** — sondagem cruzada é detectada por teste em duas partes (o alvo é
   outra pessoa do time **e** há verbo de sondagem ou coisa privada) e recusada
   em poucos milissegundos, sem chegar ao modelo.
3. **Prompt** — a cláusula de sigilo é a terceira linha de defesa, nunca a
   primeira.

### Ciclo autônomo

No ócio, regenera energia e paciência. Na janela da madrugada, varre o shard de
cada operador em isolamento e grava um insight relacional no shard privado. Esse
insight abre o turno seguinte daquele operador.

### Canal WhatsApp

Cloud API oficial da Meta. **Não usar Baileys, Venom ou WPPConnect:** violam os
Termos do WhatsApp e o resultado típico é o número da empresa ser banido.

A Meta assina o corpo **bruto** da requisição. Nenhum intermediário pode
reserializar o JSON, ou a assinatura é invalidada e o canal passa a recusar tudo
com um sintoma que não aponta para a causa. Por isso o webhook aponta para o
motor, nunca para o front e nunca via proxy.

Sem `WHATSAPP_APP_SECRET` o canal recusa **tudo**, inclusive requisição legítima.
Canal sem verificação de assinatura é porta aberta, e falha fechada é a única
postura aceitável.

## Autenticação e identidade

### Dois modos, e a diferença importa

**Com Supabase configurado** (`NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` no cliente, `SUPABASE_SERVICE_ROLE_KEY` no
servidor), a IARA exige login. A identidade vem de um **token verificado pelo
servidor** (`nucleo/Autenticacao.ts`), e o `id_usuario` que o cliente envia é
**ignorado**.

**Sem essas variáveis**, o app cai em modo local: a identidade vem de um seletor
e uma faixa no topo da tela diz isso o tempo todo. É adequado para
desenvolvimento e **não** para a internet — um menu suspenso não é controle de
acesso. O motor recusa subir assim em produção.

### Criar um operador

Supabase → Authentication → Users → *Add user* (e-mail e senha). Opcionalmente
preencha `user_metadata.nome` para a IARA chamar a pessoa pelo nome.

O roster em `lib/operadores.ts` é a lista fechada de quem existe. Para o canal
WhatsApp, o campo `telefone` é a trava: número que não está lá não abre sessão.

### Papéis (RBAC)

| Papel | O que muda |
|---|---|
| `operador` | padrão de quem não aparece em lista nenhuma |
| `administrador` | acrescenta a permissão `externo` (agir alcançando terceiros) |
| `somente_leitura` | remove escrita e limita o catálogo a consultas |

A restrição vence a concessão: quem estiver nas duas listas fica somente leitura.
Configurado por `IARA_ADMINS` e `IARA_SOMENTE_LEITURA`, casando por `id_usuario`
ou por e-mail.

> **Débito conhecido (D-4):** o papel ainda não é passado por nenhum chamador de
> produção. Todos são `operador`. O padrão é o seguro — `externo` fica de fora —
> mas `administrador` e `somente_leitura` são caminhos não exercitados.

### Postura de segurança do banco

O navegador **nunca** fala com o Supabase para ler ou escrever dados — só o motor
fala, com a `service_role`. Por isso o RLS está ligado **sem política nenhuma**:
se a anon key vazar, ela não lê uma linha. A `service_role` ignora RLS por
definição, então só existe no servidor e **nunca** com prefixo `NEXT_PUBLIC_`.

O motor decodifica o papel do JWT na subida e reclama se alguém trocar as duas
por engano — o sintoma desse erro, sem o aviso, é silencioso.

## Deploy

### Modo unificado: um processo, uma porta

O Next e o motor rodam juntos em `servidor/principal.ts`, com o barramento em
`/barramento` na mesma origem. Qualquer host que execute Node serve o sistema
inteiro.

```bash
npm ci
npm run build
npm start
```

| Host | Custo aproximado | Observação |
|---|---|---|
| **Railway** | cerca de US$ 5/mês | detecta Node, injeta `PORT`, dá domínio HTTPS |
| **Render** | free ou cerca de US$ 7/mês | o free hiberna e derruba o WebSocket; use pago |
| **Fly.io** | cerca de US$ 3/mês | mais controle, exige `fly.toml` |
| **VPS** | cerca de US$ 5/mês | precisa de Nginx e Certbot na mão |

> Valores acima são ordem de grandeza pública dos provedores, não a fatura da
> Atos Log. A conta real está em *Custos e contas*.

**A Vercel não serve para o processo inteiro, em plano nenhum.** Serverless não
mantém WebSocket aberto, não preserva memória entre invocações e tem sistema de
arquivos somente leitura. O motor precisa de host de processo longo.

### Modo separado: Next na Vercel, motor no Railway

`IARA_MODO=headless` faz o motor subir **sem** instanciar o Next, entregando só
o que exige estado vivo: o WebSocket, o áudio da voz (que mora em memória) e o
webhook do WhatsApp.

**Railway** — Root Directory `iara-os/apps/web`, builder Dockerfile.
**Vercel** — Root Directory `iara-os/apps/web`, definido no painel (não cabe no
`vercel.json`). Só três variáveis, e nenhum segredo.

### Três coisas que quebram o deploy em silêncio

1. **`NEXT_PUBLIC_*` é embutida em tempo de build.** Num deploy por Docker ela
   precisa estar declarada como `ARG` no Dockerfile — variável de serviço do host
   chega em runtime, e o build nunca a enxerga. Esquecer não quebra o deploy: o
   motor sobe, o healthcheck passa, a página abre, e o navegador recebe um bundle
   que não sabe que existe Supabase.
2. **`IARA_ORIGENS` vazio em headless** significa que ninguém conecta. O
   navegador **não** aplica CORS a WebSocket — essa lista é a única trava, e em
   headless "mesma origem" não existe.
3. **Curinga em `IARA_ORIGENS` faz o motor recusar subir** em produção. Qualquer
   pessoa registra um subdomínio num host gratuito em minutos: o curinga não
   alarga a lista, substitui ela pela internet. Para preview, suba um segundo
   motor com `IARA_AMBIENTE=homologacao` e banco próprio.

**Voltar atrás custa uma variável.** `IARA_MODO` vazio devolve o sistema inteiro
a um endereço só — é por isso que o Dockerfile continua rodando `npm run build`
mesmo quando o processo sobe headless.

### Preparar o banco

Cole `supabase/schema.sql` inteiro no SQL Editor do Supabase e rode. É
idempotente.

### PWA

O app é instalável: manifesto em `app/manifest.ts`, service worker em
`public/sw.js`, ícones por `npm run icones`. O service worker cacheia só a
casca — sprites, ícones e o documento. Nada de conversa, telemetria ou estado:
servir resposta velha do cache seria mentir para o operador sobre o que está
acontecendo agora. HTTPS é obrigatório.

## Desenvolvimento local

```bash
cd iara-os/apps/web
npm install
npm run dev
```

`http://localhost:3000`. Um comando sobe **dois processos**: o motor cognitivo
(WebSocket, 8787) e o Next (3000).

A chave da Anthropic é opcional. Sem ela o sistema roda inteiro em modo local e
diz na interface que a camada de raciocínio está desligada.

### Antes de abrir PR

```bash
npm run verificar
```

Roda, nesta ordem: verificação de caminhos relativos, guarda de GLSL,
`tsc --noEmit` e a suíte de testes.

### Armadilhas conhecidas do ambiente

**Não rode `npm run build` com o `npm run dev` ativo.** Os dois compartilham
`.next` e o dev quebra. Se acontecer: `npm run limpar`.

**Crase dentro de bloco GLSL.** Os shaders moram em template literals. Escrever
uma crase num comentário GLSL — hábito natural, porque é assim que se cita um
símbolo em TypeScript — fecha o template ali, e o resto do shader vira
JavaScript. O erro reportado não menciona crase nenhuma: aponta para uma palavra
qualquer, dezenas de linhas antes do problema real. `npm run verificar` tem uma
guarda contra isso.

**Verificar cena 3D em painel de navegador não funciona.** O painel não compõe
frames, a cena React Three Fiber não inicializa, e o sintoma engana. Verifique em
Node.

**A pasta do projeto está dentro do OneDrive.** A árvore de arquivos pode mudar
sozinha durante o trabalho. Confie no estado do Git e commite cedo.

### Aplicativo desktop

`iara-os/apps/desktop` é uma casca Tauri que embute a interface e provê o agente
local (criar pasta, abrir aplicativo, energia). O contrato com a bolha está em
`ui/bolha.html`. Ver o README da própria pasta.

## Comandos e scripts

Todos rodam a partir de `iara-os/apps/web`.

| Comando | O que executa |
|---|---|
| `npm run dev` | `tsx watch --clear-screen=false servidor/principal.ts --dev` |
| `npm run build` | `next build` |
| `npm run start` | `tsx servidor/principal.ts` |
| `npm run marca` | `tsx scripts/geracao/gerar-marca.ts` |
| `npm run icones` | `tsx scripts/geracao/gerar-icones.ts` |
| `npm run vozes` | `node scripts/diagnostico/vozes.mjs` |
| `npm run medir:voz` | `tsx scripts/diagnostico/medir-voz.ts` |
| `npm run limpar` | `node -e "const f=require('node:fs');for(const d of f.readdirSync('.').filter(n=>n==='.n…` |
| `npm run docs` | `tsx scripts/docs/gerar-documentacao.mjs` |
| `npm run test` | `node --import tsx --test "testes/**/*.test.ts"` |
| `npm run verificar` | `node scripts/diagnostico/verificar-caminhos.mjs && node scripts/diagnostico/verificar-g…` |

### Organização de `scripts/`

A separação é por *o que o script faz com o disco*, não por assunto: quem chega
novo precisa saber, pelo nome da pasta, se pode rodar sem medo.

#### `scripts/diagnostico/`

Só LEEM. Podem rodar a qualquer momento, inclusive contra dado real.

- `medir-voz.ts` — Cronômetro do caminho de voz.
- `sonda-auditoria.ts` — SONDA ADVERSARIAL — auditoria final do cérebro.
- `verificar-caminhos.mjs` — Guarda contra a armadilha que quebra toda reorganização de pastas: o import relativo que ficou apontando para o lugar antigo.
- `verificar-glsl.mjs` — Guarda contra a armadilha que já custou três compilações quebradas: uma CRASE dentro de um bloco GLSL.
- `vozes.mjs` — Lista as vozes disponíveis na conta Convai.

#### `scripts/provas/`

Provas ponta a ponta contra o Kernel real. Escrevem apenas em diretório temporário.

- `prova-cerebro-encerramento.ts` — PROVA DE ENCERRAMENTO — o cérebro inteiro, cenário a cenário.
- `prova-cognitiva-final.ts` — PROVA COGNITIVA FINAL — auditoria de 11/08/2026.
- `prova-cognitiva.ts` — *(sem descrição no cabeçalho)*
- `prova-encerramento-escrita.ts` — PROVA DE ENCERRAMENTO — a fronteira de execução, do pedido à verdade.
- `prova-escrita-final.ts` — PROVA DE ESCRITA — o caminho inteiro, com o Kernel real, imprimindo evidência.

#### `scripts/geracao/`

ESCREVEM artefatos no repositório (`public/`, ícones do desktop).

- `gerar-icones.ts` — Corta os ícones a partir do símbolo.
- `gerar-marca.ts` — Recorta a marca a partir das FOTOGRAFIAS de referência.

#### `scripts/docs/`

Geram esta documentação.

- `derivar.mjs` — As seções da documentação que são DERIVADAS do repositório.
- `docx.mjs` — Árvore de blocos → arquivo .docx (OOXML).
- `gerar-documentacao.mjs` — Gera a documentação técnica do IARA OS.
- `html.mjs` — Árvore de blocos → HTML autocontido.
- `markdown.mjs` — Analisador do subconjunto de Markdown que esta documentação usa.
- `pdf.mjs` — Árvore de blocos → arquivo PDF.
- `zip.mjs` — Escritor de ZIP mínimo.

## Monitoramento

### O que já existe

| Sinal | Onde | Para que serve |
|---|---|---|
| `/saude` | `servidor/principal.ts` | healthcheck. É o caminho que o Railway consulta (`railway.toml`) |
| Log de subida | stdout do motor | anuncia qual persistência está em uso: `[iara] persistência: Supabase` |
| Canal `auditoria` | stdout, JSON por linha | recusa de jornal, prova emitida, sondagem barrada |
| Console técnico | interface | o detalhe do turno que não sobe para a sala |
| `npm run medir:voz` | `scripts/diagnostico/` | cronômetro do caminho de voz, quando a fala demora |

### O que observar em produção

- **Healthcheck falhando** com o processo vivo geralmente é `IARA_ORIGENS` ou
  variável obrigatória ausente: o motor recusa subir de propósito.
- **`jornal_linha_recusada` no log** significa que uma linha do jornal não passou
  na validação. Com `IARA_CHAVE_PROVA` configurada, isso é adulteração ou troca
  de chave. Sem ela, é validação estrutural.
- **Reconexões em série** apontam para host que hiberna (plano free) ou proxy que
  fecha WebSocket ocioso.

### O que ainda não existe

*(a preencher)*

| Item | Status | Responsável |
|---|---|---|
| Agregador de logs (Sentry, Better Stack, outro) | *(a preencher)* | *(a preencher)* |
| Alerta de indisponibilidade | *(a preencher)* | *(a preencher)* |
| Painel de custo de tokens | *(a preencher)* | *(a preencher)* |
| Retenção de log definida | *(a preencher)* | *(a preencher)* |

## Troubleshooting

Sintomas reais, com a causa que já os produziu.

### A IARA fica presa em "reconectando…", sem erro nenhum

Indistinguível de motor fora do ar. Causas, em ordem de frequência:

1. `NEXT_PUBLIC_IARA_WS` mudou mas o front **não foi reconstruído**.
   `NEXT_PUBLIC_*` é embutida no bundle em tempo de build; editar no painel não
   basta.
2. `IARA_ORIGENS` não contém a origem exata do front, e o motor está em headless.
3. O host hiberna (plano free) e derruba o WebSocket.

### A tela mostra "modo local sem autenticação" e "a sessão expirou" ao mesmo tempo

O bundle não recebeu as `NEXT_PUBLIC_SUPABASE_*`. Num deploy por Docker, elas
precisam estar como `ARG` no Dockerfile. O motor sobe, o healthcheck passa, e
ninguém entra.

### A IARA conversa normalmente mas fica MUDA

`NEXT_PUBLIC_IARA_MOTOR` e `NEXT_PUBLIC_IARA_WS` divergiram. O áudio da voz é
servido pelo HTTP do motor; o padrão é derivar um do outro justamente para as
duas não desandarem quando alguém troca o domínio e atualiza só uma.

### O canal WhatsApp recusa tudo, inclusive mensagem legítima

- `WHATSAPP_APP_SECRET` ausente: falha fechada, de propósito.
- Algum intermediário reserializou o JSON. A Meta assina o corpo bruto; proxy que
  reescreve o corpo invalida a assinatura.

### `next build` falha com erro que culpa o código

Se for em Docker: `node_modules` do Windows foi copiado por cima do `npm ci` do
container. É o que o `.dockerignore` impede — confira se ele foi para a imagem.

### O dev server quebra do nada

`npm run build` rodou com o `dev` ativo. Os dois compartilham `.next`.
Solução: `npm run limpar`.

### Erro de compilação apontando para uma palavra aleatória num shader

Crase dentro de bloco GLSL. Rode `npm run verificar` — a guarda aponta a linha.

### A IARA recusa uma pergunta do operador sobre o registro dele mesmo

Era um defeito de comparação de identidade com autenticação ligada (uuid não casa
com id do roster) e está corrigido comparando por nome normalizado. Se reaparecer,
o ponto é `lib/operadores.ts`, `outrosOperadores`.

### A IARA diz que não pode criar pasta / abrir aplicativo

Esperado quando o motor roda na nuvem: o agente local age na máquina do operador,
via IARA Desktop. Enquanto o canal reverso não existir, essas habilidades
operariam só dentro do container — e recusar é preferível a fingir que criou.

## Backup e recuperação

### O que precisa de backup

| Dado | Onde vive | Criticidade |
|---|---|---|
| Banco (centrais, memória, insights, agenda, preferências) | Supabase | alta |
| Shards privados de operador | `dados/memoria/` em disco, ou Supabase | alta |
| Jornal de operações (trilha de auditoria) | `dados/operacoes/*.jsonl` | alta |
| Base determinística (`dados/*.json`) | repositório | baixa — está no Git |
| Código, configuração, documentação | repositório | baixa — está no Git |

### O que NÃO precisa de backup

Áudio de voz (vive em memória do processo, regenerável), `.next` e qualquer
build, `node_modules`.

### Reidratação do jornal

Depois de um restart, a IARA reconstrói do jornal o que pode ter acontecido no
mundo. Sem `IARA_CHAVE_PROVA` a reidratação valida só **estrutura** — formato,
estado legal e dono do arquivo. Quem conseguir escrever no disco consegue
inserir uma operação em estado `verificada` que nunca existiu, e a IARA passa a
jurar ter conferido um efeito que ninguém produziu.

Com a chave, cada linha carrega um HMAC-SHA256 e a reidratação recusa o que não
confere. **Trocar a chave invalida os jornais anteriores** — guarde no cofre do
host.

### Procedimentos

*(a preencher — depende de decisão de infraestrutura)*

| Procedimento | Frequência | Responsável | Onde o backup fica | Última restauração testada |
|---|---|---|---|---|
| Backup do banco Supabase | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Backup dos shards e do jornal | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Guarda da `IARA_CHAVE_PROVA` | — | *(a preencher)* | *(a preencher)* | — |

> Backup nunca testado não é backup. A coluna da última restauração existe para
> tornar visível quando essa afirmação passa a ser um problema.

## Segurança e LGPD

### Dados pessoais tratados

| Dado | Origem | Onde fica | Base legal |
|---|---|---|---|
| Nome do operador | roster e `user_metadata` do Supabase | banco e sessão | *(a preencher)* |
| E-mail do operador | Supabase Auth | banco | *(a preencher)* |
| Telefone do operador | `lib/operadores.ts`, quando o canal WhatsApp é usado | repositório | *(a preencher)* |
| Conteúdo das conversas | o próprio operador | shard privado | *(a preencher)* |
| Localização aproximada | permissão do navegador, por sessão | **só memória do processo** | *(a preencher)* |

A posição do aparelho **nunca é gravada** (`servidor/nucleo/LocalOperador.ts`).

### Postura já implementada

- **Isolamento por operador** em três camadas, sendo o prompt a última.
- **RLS ligado sem política**: a anon key não lê uma linha.
- **`service_role` só no servidor**, nunca com prefixo `NEXT_PUBLIC_`.
- **Falha fechada** no canal WhatsApp sem verificação de assinatura, e no motor
  sem as variáveis obrigatórias em produção.
- **Trilha de auditoria** append-only com selo HMAC opcional.
- **Validação de parâmetro na fronteira**: campo não declarado no esquema não
  alcança o provedor.
- **Estrangulamento pré-autenticação** no barramento.

### Terceiros que recebem dados

| Terceiro | O que recebe | Quando |
|---|---|---|
| Anthropic (Claude) | o texto do turno que subiu para raciocínio | só quando as camadas baratas não resolvem |
| Microsoft (Edge TTS) | o texto da resposta, para virar áudio | voz neural gratuita, que é o padrão |
| Convai | o texto da resposta | apenas se `CONVAI_API_KEY` for configurada |
| Meta (WhatsApp) | mensagens do canal | apenas se o canal for ligado |
| Open-Meteo | coordenadas | consulta de clima |
| Supabase | tudo que é persistido | quando configurado |

### Pendências de conformidade

*(a preencher)*

| Item | Status | Responsável |
|---|---|---|
| Encarregado de dados (DPO) designado | *(a preencher)* | *(a preencher)* |
| Política de retenção de conversas | *(a preencher)* | *(a preencher)* |
| Registro de operações de tratamento | *(a preencher)* | *(a preencher)* |
| Aviso aos operadores sobre o que é registrado | *(a preencher)* | *(a preencher)* |
| Procedimento de exclusão a pedido do titular | *(a preencher)* | *(a preencher)* |
| Contrato ou DPA com cada terceiro da tabela acima | *(a preencher)* | *(a preencher)* |

## Custos e contas

Esta seção só pode ser preenchida por quem tem acesso às faturas e aos painéis.
Nada aqui foi estimado: **a lacuna visível é informação**, e um número inventado
seria pior que nenhum.

### Contas de terceiro

| Serviço | Titular da conta | Login administrativo | Plano | Custo mensal | Renovação |
|---|---|---|---|---|---|
| Anthropic (Claude) | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Supabase | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Railway | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Vercel | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Convai (opcional) | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Meta / WhatsApp Business | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Domínio | *(a preencher)* | *(a preencher)* | — | *(a preencher)* | *(a preencher)* |

### Custo variável

O custo de tokens depende de quanto tráfego escapa das camadas baratas. As
variáveis que o governam estão no código e no ambiente:

| Variável | Efeito no custo |
|---|---|
| `IARA_MODELO` | modelo usado no raciocínio |
| `IARA_ESFORCO` | esforço de raciocínio por turno |
| `CONFIANCA_SUFICIENTE` (`FuncaoExecutiva.ts`) | acima do limiar, o plano sai sem gastar token |

| Métrica | Valor | Período |
|---|---|---|
| Turnos por mês | *(a preencher)* | *(a preencher)* |
| Proporção que sobe para o modelo | *(a preencher)* | *(a preencher)* |
| Custo de tokens no mês | *(a preencher)* | *(a preencher)* |

> Nenhuma dessas linhas deve ser preenchida por estimativa. Elas saem do painel
> da Anthropic e do log do motor.

## Responsabilidades

*(a preencher — só a empresa sabe)*

### Quem responde por quê

| Área | Responsável | Substituto | Contato |
|---|---|---|---|
| Produto e prioridades | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Desenvolvimento | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Infraestrutura e deploy | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Banco de dados | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Segurança e LGPD | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Contas e faturas | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Suporte aos operadores | *(a preencher)* | *(a preencher)* | *(a preencher)* |

### Acessos administrativos

| Sistema | Quem tem acesso hoje | Quem deveria ter | Revisado em |
|---|---|---|---|
| Repositório Git | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Painel Supabase | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Painel Railway | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Painel Vercel | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Console da Anthropic | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Meta Business | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Cofre de segredos | *(a preencher)* | *(a preencher)* | *(a preencher)* |

### Escalonamento

| Severidade | Exemplo | Quem acionar | Prazo alvo |
|---|---|---|---|
| Sistema fora do ar | healthcheck falhando | *(a preencher)* | *(a preencher)* |
| Suspeita de vazamento | chave exposta, jornal recusado | *(a preencher)* | *(a preencher)* |
| Defeito funcional | habilidade errando | *(a preencher)* | *(a preencher)* |

## Roadmap

O que o repositório mostra como caminho já aberto — não é compromisso de prazo, e
a priorização é decisão de negócio.

### Já preparado no código, aguardando decisão

| Item | Estado | O que falta |
|---|---|---|
| Avatar 3D na projeção "presença" | modelo e rig verificados por teste; componente pronto e não montado | mover a pasta do modelo para `public/` e montar o componente |
| Papéis (`administrador`, `somente_leitura`) | implementados e testados | ligar o papel à identidade da sessão |
| `enviar_whatsapp` | habilidade declarada, risco alto | receita determinística com ciclo de confirmação, **antes** de ligar o token |
| Camada de procedência na resposta | vocabulário pronto em `Verdade.ts` | consumir `VERBO_DO_ESTADO` na composição, em vez de string literal |
| Canal reverso para o agente local | agente funciona na máquina do operador | ponte entre motor na nuvem e IARA Desktop |

### Prioridade de negócio

*(a preencher)*

| Prioridade | Item | Justificativa | Prazo desejado |
|---|---|---|---|
| 1 | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| 2 | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| 3 | *(a preencher)* | *(a preencher)* | *(a preencher)* |

## Débitos técnicos

Registrados nas auditorias do projeto (ver `docs/relatorios/`). Documentação que
só elogia o sistema não serve para transferir responsabilidade.

| ID | Sev. | Débito | Impacto hoje | Próximo passo |
|---|---|---|---|---|
| D-1 | P1 | `Verdade.ts` é vocabulário sem consumidor em produção. Só o tipo `EstadoExecucao` chega ao código vivo. | A política de conflito de memória está correta e **não é aplicada**. A IARA não consegue representar "fonte A diz 16h, fonte B diz 17h", e o Kernel escreve as ressalvas à mão. | Tipar `Afirmacao` na `MemoriaOperacional` e frasear por `VERBO_DO_ESTADO`. |
| D-2 | P2 | `enviar_whatsapp` (risco alto) é inalcançável: não há receita determinística e plano emergente é barrado. | Inofensivo hoje (sem token, e `externo` não é concedido a `operador`). Quando o token entrar, a habilidade não funcionará. | Receita determinística com âncora de envio e ciclo de confirmação. **Não ligar o token antes disso.** |
| D-3 | P2 | A percepção não distingue o que o operador **pede** do que ele **cola**. Texto citado com "desligar o computador" arma pendência. | Não executa nada — o porteiro e a confirmação humana seguram — mas a IARA responde "você quer desligar o computador?" a quem pediu um resumo. | Marcar trechos citados na percepção. Aceitar só imperativos foi recusado: quebraria "pode desligar o computador?". |
| D-4 | P2 | O papel nunca é passado por chamador de produção. Todos são `operador`. | O padrão é o seguro, mas `administrador` e `somente_leitura` não são exercitados. | Ligar o papel à identidade da sessão. |
| D-5 | P2 | Sem chave de idempotência no contrato de Habilidade. | Risco futuro, não atual: não há retry automático, e a única ação não idempotente é protegida pela pendência. | Adicionar idempotência ao manifesto **antes** de qualquer integração real de envio. |
| D-6 | P2 | Pendência de autorização vive só em memória de processo. | Restart perde a pendência. Degrada para o lado seguro, mas o operador não é avisado. | Persistir com validade e reidratar como aguardando confirmação — nunca como autorizada. |
| D-7 | P2 | Extração de fatos cobre só horário e assunto de lista fechada. | Conflito de data, nome ou número não é detectado; o desempate volta a ser da LLM. | Ampliar conforme a operação mostrar onde o conflito acontece. |
| D-8 | P2 | Turno preemptado vira evento de auditoria, não fala ao operador. | O operador vê a resposta do turno novo e não sabe que o anterior mudou algo. | Fundir o fato do turno preemptado na resposta seguinte. |
| D-9 | P3 | O nonce de confirmação não discrimina em produção: "confirmo" é texto livre e resolve para a pendência mais recente. | O vínculo real é (operação, usuário, sessão, janela, estado) — que já bloqueia replay. | Carregar o nonce pelo canal quando houver confirmação estruturada. |
| D-10 | P3 | Assinatura de erro usa janela curta: "manda pro João" e "manda pro João Silva" produzem assinaturas diferentes. | Subcontagem de ocorrências. O módulo declara o trade-off. | Nenhum. É o comportamento pretendido. |

### Débitos de repositório

| Item | Situação |
|---|---|
| Streaming do Claude não exercitado | O código está tipado e integrado, mas nunca rodou com chave real. É o próximo a validar quando a `ANTHROPIC_API_KEY` entrar. |
| Duas cópias do mesmo modelo 3D | Resolvido em 14/08/2026: `avatares/lisa_final.glb` era byte a byte idêntico a `ativos/identidade_iara/source.glb`. A cópia da raiz foi removida e a licença CC-BY seguiu junto do arquivo que ficou. |

## Riscos conhecidos

| Risco | Probabilidade | Impacto | Mitigação atual | O que falta |
|---|---|---|---|---|
| Chave `service_role` vazar | baixa | **crítico** — banco inteiro exposto | Só no servidor; nunca com prefixo público; `.gitignore` cobre `.env*`; varredura na geração da documentação | Rotação periódica documentada |
| `IARA_CHAVE_PROVA` ausente em produção | média | alto — o jornal deixa de ser prova | Validação estrutural continua; o veredito é `sem_chave`, nunca `valido` | Tornar obrigatória em produção |
| Perda de pendência em restart | média | médio — pedido evapora em silêncio | Falha para o lado seguro | Persistir a pendência (D-6) |
| Token do WhatsApp ligado antes da receita determinística | média | alto — habilidade de risco alto sem ciclo de confirmação | D-2 está registrado e a habilidade é inalcançável hoje | Não ligar o token antes de fechar D-2 |
| Host que hiberna derrubando o WebSocket | média | médio — reconexões em série | Documentado; plano pago recomendado | Alerta de indisponibilidade |
| Curinga em `IARA_ORIGENS` | baixa | **crítico** — troca a lista de origens pela internet | O motor **recusa subir** com curinga fora de homologação | — |
| Dependência de terceiro para voz | média | baixo — a IARA fica muda, mas responde | Voz neural gratuita como padrão; Convai é opcional | — |
| Único mantenedor com conhecimento do sistema | *(a preencher)* | *(a preencher)* | esta documentação | *(a preencher)* |
| Pasta do projeto dentro do OneDrive | alta | baixo — árvore muda sozinha durante o trabalho | Confiar no estado do Git | Mover para fora do OneDrive |

### Riscos de negócio

*(a preencher)*

| Risco | Probabilidade | Impacto | Responsável pela mitigação |
|---|---|---|---|
| *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |

## Checklist de transferência

Para quem vai assumir o sistema. Cada item é uma verificação, não uma leitura.

### Acesso

- [ ] Acesso de escrita ao repositório Git
- [ ] Acesso ao painel do Supabase, com permissão de administrador
- [ ] Acesso ao painel do host do motor (Railway)
- [ ] Acesso ao painel do host do front (Vercel), se o deploy for separado
- [ ] Acesso ao console da Anthropic
- [ ] Acesso ao Meta Business, se o canal WhatsApp estiver ligado
- [ ] Acesso ao cofre onde os segredos ficam guardados
- [ ] Acesso ao registrador do domínio

### Entendimento

- [ ] Leu *Visão geral*, *Arquitetura* e *Invariantes não negociáveis*
- [ ] Entende por que a interface é um escritório e não um dashboard
- [ ] Entende as três camadas e por que 80% das perguntas não chegam ao modelo
- [ ] Entende o isolamento entre operadores e por que o prompt é a última defesa
- [ ] Leu a lista de *Débitos técnicos* e sabe qual não pode ser ignorado (D-2,
      antes de ligar o token do WhatsApp)

### Prova prática

- [ ] Clonou, rodou `npm install` e `npm run dev` com sucesso
- [ ] `npm run verificar` passa na máquina nova
- [ ] `npm run docs` regenera esta documentação
- [ ] Conversou com a IARA em modo local (sem chave) e viu o aviso na interface
- [ ] Conversou com a IARA com chave e viu o rack pulsar
- [ ] Fez um deploy de teste e viu o healthcheck passar
- [ ] Restaurou um backup do banco num ambiente de teste

### Governança

- [ ] Tabelas de *Custos e contas* preenchidas
- [ ] Tabela de *Responsabilidades* preenchida
- [ ] Pendências de *Segurança e LGPD* endereçadas ou aceitas formalmente
- [ ] Procedimentos de *Backup e recuperação* definidos e testados uma vez
- [ ] Segredos rotacionados após a transferência
