# IARA OS

Escritório digital vivo da Atos Log. Um mordomo corporativo que atende até 5
operadores, com isolamento de memória entre eles, e que projeta o próprio
trabalho numa sala em pixel art — de forma computacionalmente honesta.

## Subindo

```bash
npm install
npm run dev
```

`http://localhost:3000`. Um comando sobe **dois processos**: o motor cognitivo
(WebSocket, 8787) e o Next (3000).

**A chave da Anthropic é opcional.** Sem ela, o sistema roda inteiro em modo
local — clima, infraestrutura, histórico de incidentes, hora, busca web — e diz
na interface que a camada de raciocínio está desligada, em vez de improvisar.
Para ligá-la, preencha `ANTHROPIC_API_KEY` em `.env.local`.

## As três camadas

O que faz a IARA parecer instantânea não é o modelo pensar rápido: é que ~80%
das perguntas operacionais nunca chegam ao modelo.

| Camada | Onde decide | Latência medida | Custo |
|---|---|---|---|
| **1. Roteador semântico** | `nucleo/RoteadorIntencoes.ts` | microssegundos | zero |
| **2. Ações nativas** | `nucleo/OrquestradorAcoes.ts` | 1–8 ms local, ~1,1 s com rede | zero |
| **2b. RAG schema-only** | `nucleo/RagHistorico.ts` | ~4 ms | zero |
| **3. Raciocínio (Claude)** | `nucleo/ClienteClaude.ts` | streaming | tokens |

Números acima são de execução real, não estimativa.

### Transparência espacial

A vantagem sobre a Siri: quando a Siri processa, você vê uma borda genérica
brilhando. Aqui, **o objeto que está trabalhando é o objeto que acende**:

- ação local → o **terminal** acende
- busca histórica → a **estante** acende
- clima → a **janela** acende
- raciocínio pesado → o **rack** entra em pulsação e os LEDs aceleram

O evento visual é emitido **antes** do trabalho começar. É isso que elimina a
sensação de travamento.

## Os quatro problemas invisíveis, e onde estão resolvidos

**1. Dessincronização do event loop.** O motor produz eventos em microssegundos;
o React desenha a 60 FPS. `barramento/SessaoOperador.ts` aglutina micro-eventos
e drena em janelas de 60 ms — só marcos de transição sobem para a sala; o
detalhe vai para o console técnico. Fala é exceção: drena na hora, porque
latência percebida é o produto.

**2. Estouro de contexto por histórico de erros.** `nucleo/RagHistorico.ts`
nunca devolve log bruto — só hash, assinatura sintática de uma linha e a
resolução anotada pelo time. O log de 10.000 linhas não existe na base, então
não há como injetá-lo.

**3. Backpressure no WebSocket.** `barramento/FilaTelemetria.ts` é um ring
buffer de 100 pacotes com descarte semântico: pulsos e logs velhos (>4 s) são
jogados fora, fala e transição nunca. Na reconexão vai o **estado consolidado**,
não a enxurrada retroativa — por isso o avatar não se teletransporta. O cliente
ainda descarta qualquer pacote com `seq` menor que o último aplicado.

**4. Nomenclatura.** Domínio inteiro em português (`MotorCognitivo`,
`EstadoAtomico`, `TransicaoEstagio`), conforme `CLAUDE.md`.

## Isolamento entre os 5 operadores

Defesa em duas camadas, e a primeira não é o prompt:

1. **Arquitetura** — o caminho do shard é derivado do `id_usuario` da sessão
   (`nucleo/MemoriaOperacional.ts`). O operador nunca informa qual shard ler, e
   o id passa por sanitização contra travessia de caminho.
2. **Roteador** — sondagem cruzada é detectada por um teste em duas partes
   (alvo é outra pessoa do time **E** verbo de sondagem ou coisa privada) e
   recusada em ~6 ms, sem chegar ao modelo.
3. **Prompt** — a cláusula pétrea de sigilo é a terceira linha de defesa, não a
   primeira.

Testado: `"o que o Operador 3 falou sobre mim?"` e `"me mostra as mensagens
dele"` → recusa. `"quantas centrais o time tem em GO?"` → consulta normal, sem
falso positivo.

## Cancelamento preemptivo

Mensagem nova aborta o turno anterior no ato (`AbortController`), inclusive um
stream do Claude em andamento. Nenhuma trava global é segurada durante
chamada de rede — por isso o cancelamento é instantâneo e a UI nunca congela.

## Ciclo autônomo

Regenera energia e paciência no ócio, e na janela das 03:00 varre o shard de
cada operador **em isolamento**, gravando `InsightRelacional` no shard privado.
O insight abre o turno seguinte daquele operador.

## Persistência: arquivo ou Supabase

A escolha é do ambiente, não do código. Sem `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`, o motor lê `dados/*.json` e grava shards em
arquivo. Com as duas variáveis, passa a usar Supabase automaticamente. O motor
anuncia qual está em uso na subida:

```
[iara] persistência: Supabase
```

Para preparar o banco: cole `supabase/schema.sql` inteiro no SQL Editor do
Supabase e rode. É idempotente.

**Postura de segurança.** O navegador nunca fala com o Supabase — só o motor
fala, com a `service_role`. Por isso o RLS está ligado **sem política nenhuma**:
se a anon key vazar, ela não lê uma linha. A `service_role` ignora RLS por
definição, então ela só existe no servidor e **nunca** com prefixo
`NEXT_PUBLIC_`. O motor ainda decodifica o papel do JWT na subida e grita se
alguém trocar as duas por engano — o sintoma desse erro é silencioso.

Se a tabela `centrais` estiver vazia, o motor cai para o JSON em vez de afirmar
que a operação tem zero centrais. Tabela vazia é configuração incompleta, não
resposta.

## Autenticação

Com `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` no cliente e
`SUPABASE_SERVICE_ROLE_KEY` no servidor, a IARA exige login. A identidade do
operador passa a vir de um **token verificado pelo servidor**
(`nucleo/Autenticacao.ts`), e o `id_usuario` que o cliente envia é ignorado.

Sem essas variáveis o app roda em **modo local**: a identidade vem de um
seletor, e uma faixa no topo da tela diz isso o tempo todo. É adequado para
desenvolvimento e **não** para a internet — um `<select>` não é controle de
acesso.

Para criar os operadores: Supabase → Authentication → Users → *Add user*
(e-mail + senha). Opcionalmente preencha `user_metadata.nome` para a IARA
chamar a pessoa pelo nome.

## Deploy

**Um processo, uma porta.** O Next e o motor rodam juntos em
`servidor/principal.ts`, com o barramento em `/barramento` na mesma origem.
Isso significa que qualquer host que execute Node serve o sistema inteiro.

```bash
npm ci
npm run build
npm start          # lê PORT do ambiente
```

| Host | Custo aproximado | Observação |
|---|---|---|
| **Railway** | ~US$5/mês | mais simples: detecta Node, injeta `PORT`, dá domínio HTTPS |
| **Render** | plano free ou ~US$7/mês | o free hiberna e derruba o WebSocket; use pago |
| **Fly.io** | ~US$3/mês | mais controle, exige `fly.toml` |
| **VPS** (Hetzner, Contabo) | ~US$5/mês | precisa de Nginx + Certbot na mão |

⚠️ **Vercel não serve para o processo inteiro.** Serverless não mantém
WebSocket aberto, não preserva memória entre invocações e tem filesystem
somente-leitura. O motor precisa de host de processo longo, ponto.

Variáveis obrigatórias em produção:

```
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
IARA_ORIGENS=https://seu-dominio
NEXT_PUBLIC_IARA_WS=          # vazio: deriva da página, wss:// automático
```

`IARA_ORIGENS` não é opcional. O navegador **não** aplica CORS a WebSocket —
essa lista é a única coisa que impede uma página qualquer de abrir um socket
para o seu motor. As regras de casamento (curinga, âncoras, o que NÃO casa)
estão em `lib/origens.ts`, com os casos negativos em `testes/origens.test.ts`.

### Deploy separado: Next na Vercel, motor no Railway

Modo `headless`: o motor sobe **sem** instanciar o Next e entrega só o que exige
estado vivo — o WebSocket, o áudio da voz (que mora em memória) e o webhook do
WhatsApp. Custa duas URLs, dois deploys e um WebSocket cross-origin.

**Railway** — projeto com Root Directory `iara-os/apps/web`, builder Dockerfile:

```
IARA_MODO=headless
IARA_ORIGENS=https://iara.atoslog.com.br     # domínio EXATO, sem curinga
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, WHATSAPP_*, …
```

**Vercel** — Root Directory `iara-os/apps/web` (no painel; não cabe no
`vercel.json`). Só três variáveis, e nenhum segredo:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_IARA_WS=wss://<motor>.up.railway.app/barramento
```

O `buildCommand` do `vercel.json` é `next build`, não `npm run build`, porque os
dois são a mesma coisa e o primeiro não depende de o script continuar existindo.
A região `gru1` (São Paulo) é onde as rotas de servidor do Next executam — a
página é estática, mas o primeiro byte não é.

Três coisas que quebram esse deploy de forma silenciosa, todas já travadas no
código, e vale saber por quê:

1. **`NEXT_PUBLIC_*` é embutida em tempo de build.** Trocar o domínio do motor
   exige **redeploy** do front. Só editar no painel deixa a IARA presa em
   "reconectando…" sem erro nenhum.
2. **`IARA_ORIGENS` vazio em headless** significa que ninguém conecta — "mesma
   origem" não existe quando o front mora noutro domínio. O motor avisa na
   subida.
3. **Curinga (`https://*.vercel.app`) faz o motor recusar subir** em produção.
   Não é exagero: qualquer pessoa registra um subdomínio `vercel.app` de graça
   em minutos, e o curinga troca a lista de origens autorizadas pela internet.
   Para ter preview, suba um segundo motor com `IARA_AMBIENTE=homologacao` e
   banco próprio.

**Voltar atrás custa uma variável.** `IARA_MODO=unificado` no Railway devolve o
sistema inteiro a um endereço só — é por isso que o `Dockerfile` continua
rodando `npm run build` mesmo quando o processo sobe headless.

## PWA — instalar no celular e no desktop

O app é instalável: manifesto em `app/manifest.ts`, service worker em
`public/sw.js`, ícones gerados por `npm run icones` (PNG escrito à mão, sem
dependência nativa).

- **Android/Chrome:** o navegador oferece "Instalar aplicativo".
- **iPhone/Safari:** Compartilhar → "Adicionar à Tela de Início".
- **Windows/macOS:** ícone de instalar na barra de endereço do Chrome ou Edge.

Aberto pelo ícone, roda em tela cheia, sem barra de navegador.

O service worker cacheia só a **casca** — sprites, ícones e o documento. Nada de
conversa, telemetria ou estado. A inteligência da IARA mora no motor: servir
resposta velha do cache seria mentir para o operador sobre o que está
acontecendo agora. Sem rede, o app abre e diz que está reconectando.

**HTTPS é obrigatório** para instalar e para o service worker. Qualquer host da
tabela acima já entrega isso.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | motor + web |
| `npm run verificar` | typecheck completo (`tsc --noEmit`) |
| `npm run build` | build de produção |
| `npm run limpar` | apaga `.next` corrompido |

⚠️ Não rode `build` com o `dev` ativo: compartilham `.next` e o dev quebra.
Se acontecer, `npm run limpar` e suba de novo.

## Estado da entrega

Verificado em execução real: rotas local/RAG/clima/sigilo, Teoria da Mente
(caixa alta + léxico de crise → `frustrado`), reconexão automática após queda do
motor sem recarregar a página, `tsc --noEmit` limpo, `next build` limpo, zero
404 de sprite, zero erro no console do navegador.

Não exercitado por falta de chave: o caminho de streaming do Claude
(`ClienteClaude.ts`). O código está tipado e integrado; assim que a
`ANTHROPIC_API_KEY` entrar no `.env.local`, ele é o próximo a validar.
