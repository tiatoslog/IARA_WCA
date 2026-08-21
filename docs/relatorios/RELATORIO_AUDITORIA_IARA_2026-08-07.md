# IARA — Relatório de Auditoria, Correções e Aprimoramentos
**Data:** 07/08/2026 • **Escopo:** `IARA_WCA/iara-os/apps/web` (11.300 linhas de TypeScript)

---

## Veredicto geral

O código está **muito acima da média** em postura de segurança e arquitetura. A auditoria dupla (segurança + lógica) não encontrou **nenhuma vulnerabilidade crítica ou alta** na configuração de produção pretendida — mas encontrou **17 bugs reais de lógica** (5 de severidade alta) que passavam pelos 77 testes existentes. **Todos foram corrigidos nesta sessão**, com 10 testes de regressão novos (87/87 passando).

---

## 1. Auditoria de segurança — resultado

### O que está bem feito (controles verificados funcionando)
- Identidade via token Supabase verificado no servidor; o `id_usuario` do cliente é ignorado.
- Isolamento de shard em profundidade: id sempre da sessão, sanitização de caminho, `.eq('id_usuario')` em toda query, RLS ligado sem policies (só o servidor lê), sondagem cruzada barrada no roteador determinístico — **confirmado ao vivo: bloqueio em 4 ms**.
- WhatsApp com Cloud API oficial: assinatura HMAC do corpo bruto em tempo constante, falha-fechada sem secret, lista fechada de números, deduplicação, sem cadastro automático.
- LLM não executa nada: só emite plano JSON validado contra catálogo; SQL apenas por consultas nomeadas pré-aprovadas; sem SSRF (hosts fixos); sem chave em frontend; sem segredo commitado.

### Achados e o que foi feito
| Sev. | Achado | Ação |
|---|---|---|
| Média | Produção sem Supabase aceitava identidade escolhida pelo cliente (só avisava no log) | **Corrigido**: o servidor agora **recusa subir** em produção sem autenticação (`principal.ts`), a menos que `IARA_PERMITIR_MODO_LOCAL=1` seja declarado conscientemente |
| Baixa-média | Next 15.1.6 com CVEs conhecidos | **Corrigido**: atualizado para 15.5.23; `postcss`/`sharp` restantes só fecham no Next 16 (major) — recomendação futura |
| Baixa | URL real do projeto Supabase no `.env.example` | **Corrigido**: trocado por placeholder |
| Baixa | Colisão teórica de telefone (9º dígito) no WhatsApp | Documentado — validar colisão ao cadastrar telefones |
| Baixa | Rota `/voz/<hash>` sem checagem de sessão | Aceito (hash de 128 bits inguessável) — amarrar à sessão se a fala carregar dado sensível |
| Baixa | Sem rate-limit de conexões/`ola` no barramento | Recomendação: limite por IP no upgrade |

## 2. Auditoria de lógica — 17 bugs corrigidos

**Alta severidade:**
1. "quanto tempo leva…" caía na rota de **clima** (respondia previsão do tempo a pergunta de duração) — regex corrigida em `RoteadorIntencoes.ts` e `Percepcao.ts`.
2. `pesquis\b`/`noticia\b` **nunca casavam** "pesquisa/pesquise/notícias" — busca web ia para a nuvem paga. Corrigido (`\w*`).
3. Mesmo bug silenciava **"obrigado"** na Teoria da Mente — o estado `produtivo` era quase inalcançável. Corrigido.
4. **Reconexão matava a sessão nova**: o `close` tardio do socket antigo desmontava a ponte/kernel do socket novo (UI congelada, turno cancelado). Corrigido com posse por sessão + derrubada explícita do transporte antigo (`Porta.ts`, `SessaoOperador.ts`).
5. **Recusa de autenticação invisível**: `seq: 0` era filtrado pela guarda de ordem do cliente — token expirado virava loop mudo de reconexão. Corrigido nos dois lados.

**Média:** 6. falso positivo de sigilo ("tem registro dele?" sobre um erro → sermão de privacidade; agora vai ao RAG — **validado ao vivo**) · 7. `finally` do turno preemptado apagava a memória de trabalho do turno novo · 8. aglutinação da fila reordenava `seq` e o cliente descartava logs · 9. reconexão zerava energia/paciência/afinidade · 10. histórico podia começar em `assistant` → **erro 400 em toda chamada de nuvem** até a janela deslizar (normalização completa no `ClienteClaude`) · 11. consolidação noturna marcada como feita antes de executar (falha às 03:00 = dia perdido).

**Baixa:** 12. allowlist do papel `somente_leitura` com ids inexistentes · 13. cache de centrais sem TTL (agora 60 s) · 14. escuta presa em "processando" · 15. busca web pareava título de um resultado com resumo de outro · 16. limite de vazão cancelava a resposta em curso e morria em silêncio (agora recusa vira fala) · 17. luzes da sala decaíam por tráfego de eventos, não por tempo.

## 3. "Ela está inventando dados" — esclarecido e mitigado

Ela **não inventa**: lê `dados/infraestrutura.json` e `dados/historico-erros.json`, que são **dataset semente de demonstração** que veio com o repositório (a camada de IA estava até desligada). O problema real era responder demo com a confiança de dado real. **Corrigido**: toda resposta vinda do dataset semente agora termina com *"(Atenção: dados de demonstração — o banco real ainda não foi conectado.)"* — validado ao vivo. Para ligar dados reais: preencher as tabelas `centrais` e `erros_assinaturas` no Supabase (o código troca sozinho, sem alteração).

## 4. Voz — implementada e funcionando

- **Entrada** já existia (reconhecimento nativo do Chrome/Edge, meio-duplex com interrupção por voz).
- **Saída implementada nesta sessão**: síntese de fala do próprio navegador (grátis, sem chave, texto não sai da máquina) como caminho padrão quando não há Convai. Prioriza vozes neurais pt-BR do Edge ("Natural"); botão 🔊/🔇 persistente; falar por cima interrompe (barge-in); "Interromper" cala servidor E alto-falante; histórico recarregado não é lido em voz alta. **Validado ao vivo: `speechSynthesis.speaking = true` durante as respostas.**
- Caminho Convai (qualidade superior + lipsync do avatar 3D) continua disponível via `CONVAI_API_KEY`.

## 5. Escritório — móveis e caminhada

- **"Computador no chão"**: a estação da esquerda era composta por 3 sprites (mesa + monitor avulso + cadeira) e o monitor flutuava. Substituída por uma segunda `desk-with-pc` (computador desenhado na própria arte) — ilha central simétrica, validada pelo teste que re-mede os PNGs (sem sobreposição, âncoras exatas, corredor livre).
- **"Não anda com sutileza"**: o avatar teleportava (só a sombra tinha transição). Agora a IARA **anda de verdade**: folhas de caminhada do pack (`Julia_walk_*`, 4 direções, estavam sem uso), deslocamento a 30 ms/px (~1,5 s por trajeto, dentro do invariante de movimento calmo), direção escolhida pelo vetor do trajeto, sombra e avatar na mesma duração. **Validado ao vivo**: `walk_Up` indo à mesa → `walk_Foward` voltando → `Idle` parada.

## 6. Prontidão para as 5 pessoas do escritório

**A arquitetura multiusuário está pronta e testada** (5 operadores previstos, shard por operador, isolamento em 3 camadas). O que falta é **configuração, não código**:

1. **Supabase**: criar/usar o projeto, rodar `supabase/schema.sql`, preencher `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`, criar os 5 usuários no Supabase Auth. Sem isso o modo local não autentica ninguém — e agora o servidor **se recusa a subir em produção** nesse estado.
2. **Nomes reais**: trocar "Operador 2..5" em `lib/operadores.ts` pelos nomes do time (e telefones, se forem usar WhatsApp).
3. **IA**: `ANTHROPIC_API_KEY` para a camada de raciocínio (hoje ela recusa honestamente o que exige raciocínio).
4. **Deploy**: host com WebSocket (Railway/Render/Fly/VPS — Vercel não serve para o motor) + HTTPS + `IARA_ORIGENS` com o domínio.
5. **Dados reais**: preencher `centrais` e `erros_assinaturas` (senão as respostas continuam marcadas como demonstração).
6. **WhatsApp** (opcional): app na Meta, token/secret/verify no `.env`, webhook `https://SEU-DOMINIO/canais/whatsapp`.

## 7. Recomendações para as próximas etapas (turbinar)

1. **Agente local + app desktop (Tauri)** — o grande salto da especificação v2: bolha flutuante, atalho global e execução no computador (arquivos, scripts, energia) com modelo de risco R0–R3. O `SnapshotCognitivo` já foi desenhado para ser a fronteira; o desktop é uma terceira projeção.
2. **Next 16** quando conveniente (fecha postcss/sharp).
3. **Rate-limit por IP** no upgrade do WebSocket.
4. **Terceiro posto na sala** (cafeteira, com a animação `Julia_Drinking_Coffee` que está sem uso) amarrado a um fato do kernel (ex.: pausa de consolidação) — presença sem violar o invariante "nada acende para dar vida".
5. **Convai** se quiser a voz premium com lipsync 3D perfeito (a voz do navegador já cobre o dia a dia).

---

*Relatório gerado após: 2 auditorias independentes (segurança e lógica), bateria de testes ao vivo no navegador, 17 correções aplicadas, 10 testes de regressão novos, atualização de dependência e validação final — 87/87 testes passando, TypeScript sem erros.*
