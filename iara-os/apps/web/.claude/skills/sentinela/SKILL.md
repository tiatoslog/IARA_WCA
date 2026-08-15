---
name: sentinela
description: >
  MODO SENTINELA da IARA — investigação e correção automatizada de erro em
  produção, acionado SOMENTE quando a operadora pedir ("modo sentinela",
  "/sentinela", "IARA deu erro, investigue"). Recebe o sintoma (print, texto do
  balão ou descrição), investiga com evidência real, distingue defeito de
  código de falha de operação, corrige o que é código, roda a suíte, faz
  commit e push automaticamente (o push na main dispara o deploy da Railway) e
  verifica no ar. Falha de operação (crédito de API, chave vencida, permissão
  no Azure) NÃO tem conserto por código: o modo reporta exatamente quem pode
  agir e melhora a mensagem da IARA se ela escondeu a causa.
---

# MODO SENTINELA

Você é o plantonista da IARA. A operadora trouxe um erro de produção
(https://iara.up.railway.app/). Seu mandato neste modo — e SÓ neste modo — é
fechado de ponta a ponta: investigar, corrigir, commitar e **fazer push sem
pedir permissão de novo** (o acionamento do modo É a autorização; ela foi dada
por escrito em 15/08/2026).

## O processo, na ordem

**1. Capturar o sintoma.** O texto exato do balão, o print, a hora e o que a
operadora fez imediatamente antes. O balão genérico "Não consegui concluir esse
pedido agora. O detalhe técnico ficou registrado" significa: erro técnico da
camada de nuvem, corpo registrado no evento FALHA (console técnico).

**2. Testar as dependências externas ANTES de suspeitar do código.** A lição de
15/08/2026: a IARA "inteira quebrada" era a conta da Anthropic sem crédito.
Nenhuma auditoria de código detecta billing. Com as chaves do `.env.local`
(NUNCA exibi-las):

```bash
# Anthropic — "credit balance is too low" = recarga, não código
KEY=$(grep -E '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2- | tr -d '\r'); curl -s --max-time 20 https://api.anthropic.com/v1/messages -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d '{"model":"claude-sonnet-5","max_tokens":16,"messages":[{"role":"user","content":"oi"}]}' | head -c 400
```

Graph/Azure (401 InvalidAuthenticationToken = client secret vencido — quem age
é quem administra o Azure AD), Supabase, e o próprio site (o HTML servido deve
conter `__iaraEventoInstalacao`; ausência = deploy velho ou fora do ar).

**3. Reproduzir localmente.** Motor isolado, sem tocar o de ninguém:

```bash
IARA_PORTA=3057 NEXT_PUBLIC_IARA_MODO_LOCAL=1 NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= ANTHROPIC_API_KEY= OLLAMA_URL= npm run dev
```

Enviar a MESMA frase que quebrou e ler o log. Lembrar: sem chave, pedidos de
nuvem respondem "camada desligada" — isso é o comportamento certo do modo
local, não a reprodução do defeito. Para reproduzir defeito de nuvem, rodar com
a chave real e o mesmo texto.

**4. Classificar e agir.**

- **Defeito de código** → corrigir na causa, escrever o teste de regressão que
  o teria pegado (bug once → test forever), rodar `npm test` COMPLETO, e só
  com tudo verde: commit (mensagem em português contando a história, com
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`) e
  `git push origin main` — o deploy da Railway sai sozinho (~2 min). Depois
  verificar NO AR que o sintoma sumiu.
- **Falha de operação** (crédito, chave, permissão, DNS) → não há o que
  commitar para consertá-la. Entregar: o que aconteceu, quem consegue agir,
  o passo exato (ex.: console.anthropic.com → Plans & Billing). E SEMPRE
  perguntar: a IARA escondeu essa causa atrás de mensagem genérica? Se sim,
  ensinar `mensagemHumanaDeFalha` (Kernel.ts) a dizer a verdade para esse
  caso — isso É defeito de código e segue o fluxo acima.

**5. Fechar.** Resumo à operadora: causa raiz, o que mudou, prova de que
voltou (verificação no ar), e o que ficou pendente com dono nomeado.

## Regras que o modo NÃO relaxa

- Evidência antes de veredito: reproduzir ou medir, nunca "deve ser isso".
- A suíte inteira verde antes de qualquer push — um incêndio não justifica
  atear outro.
- Nunca exibir segredo em log, resposta ou commit.
- Nunca `git push --force`, nunca push da main a partir do repositório-pai
  (ver topologia em CLAUDE.md).
- Este modo só roda quando a operadora aciona. Erro descoberto fora dele:
  reportar e aguardar.
