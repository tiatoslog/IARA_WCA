# Test plan — Proatividade (Inteligência Proativa da IARA)

**BASELINE_ID:** `PROAT-2026-08-19`
**Commit base (submódulo):** `eb2925daed43e2d0db383cede03c3bcc1b61bc2b` (branch `main`)
**Suíte antes da alteração:** `npm test` → 1734 testes, 1731 pass, 0 fail, 3 skipped, 72,2 s
**Typecheck antes:** `./node_modules/.bin/tsc --noEmit` → exit 0
**Node:** v22.17.0

> Este documento é o **contrato de verificação**. Ele não é alterado durante a
> implementação. Lacuna descoberta depois vira linha nova em "Lacunas
> registradas", nunca edição silenciosa de um critério.

---

## 1. Objetivo

Dar à IARA a capacidade de **iniciar** uma interação quando houver motivo real —
com decisão determinística, personalizada por operador, persistente, auditável, e
que aprende com a reação de quem recebeu.

O que isto **não** é: um sistema de notificações. A métrica de sucesso não é
quantidade de avisos; é `intervencoes_relevantes / intervencoes_totais`, e o
silêncio correto conta como acerto.

## 2. O que deve funcionar

| # | Requisito |
|---|---|
| R1 | Uma ocorrência entra, é normalizada, contextualizada, pontuada e decidida — em código determinístico, sem LLM no caminho da decisão |
| R2 | Dois operadores diferentes, mesma ocorrência, decisões diferentes |
| R3 | A relevância sobe com engajamento e cai com rejeição, de forma mensurável e justificável |
| R4 | Rejeição explícita silencia o assunto por um prazo |
| R5 | Ocorrências duplicadas de fontes diferentes viram UMA ocorrência com N fontes |
| R6 | Rajada de eventos não vira rajada de interrupções |
| R7 | Repetição de procedimento vira oportunidade de automação — detectada, explicada, proposta; nunca executada |
| R8 | Confiança baixa + impacto alto ⇒ perguntar/verificar, nunca afirmar nem agir |
| R9 | Toda decisão carrega justificativa estruturada (gatilho, motivos, evidência, confiança) |
| R10 | Estado sobrevive a restart do processo |
| R11 | Logs estruturados para cada etapa do ciclo, sem segredo e sem dado sensível desnecessário |
| R12 | Fora do horário de atividade do operador, só severidade grave + confiança alta interrompe |

## 3. O que não pode quebrar (invariantes)

| # | Invariante | Como falha se quebrar |
|---|---|---|
| I1 | **Autonomia é teto.** Abaixo de `sugestao`, a IARA não fala sem ser chamada | a proatividade vira caminho de bypass do teto configurado |
| I2 | **A camada proativa nunca executa.** Nenhuma decisão produz efeito no mundo | proatividade vira autonomia ilimitada (ETAPA 9) |
| I3 | **Isolamento por operador.** Ocorrência de A jamais alcança B | vazamento de shard |
| I4 | **Texto de ocorrência é dado, nunca instrução.** Não muda severidade, confiança, destinatário nem decisão | evento forjado escala privilégio |
| I5 | **Silêncio é o padrão.** Sem motivo, nada é dito | máquina de spam |
| I6 | **Nenhuma afirmação sem fonte.** `natureza` separa observado/inferido/previsto/desconhecido | a IARA inventa notícia |
| I7 | **Degradação segura.** Livro indisponível, perfil ausente, ocorrência malformada ⇒ não fala, não inventa, não escala | falha silenciosa |
| I8 | **Fluxos existentes intactos:** chat, lembrete vencido, vigia, memória, WebSocket, espelhos, WhatsApp | regressão |

## 4. Matriz de testes

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | PRO-001 | Happy path | livro vazio, autonomia `sugestao` | ocorrência grave, confiança alta, acionável, no horário | decisão `alertar`, fala publicada uma vez | asserção sobre `RegistroDecisao` + fala | proatividade não funciona |
| [x] | PRO-002 | Happy path | idem | ocorrência leve, confiança média | decisão ≠ `alertar`; nada é falado | contagem de falas = 0 | spam |
| [x] | PRO-003 | Perfil | operador A com `funcao` casando o assunto; operador B não | MESMA ocorrência para os dois | decisões diferentes; A mais alta que B | duas decisões comparadas | personalização inexistente |
| [x] | PRO-004 | Perfil | dois livros distintos | ocorrência gravada para A | livro de B não contém nada | leitura cruzada | vazamento (I3) |
| [x] | PRO-005 | Autonomia | autonomia `plano` (abaixo de `sugestao`) | ocorrência grave + alta | decisão `guardar`; nada falado | contagem de falas = 0 | bypass do teto (I1) |
| [x] | PRO-006 | Autonomia | autonomia `rotina` (o topo) | ocorrência grave + alta | decisão nunca é `agir` | varredura exaustiva do enum | autonomia ilimitada (I2) |
| [x] | PRO-007 | Dedup | ocorrência X já vista | mesma `chave_dedup` de outra origem | 1 ocorrência, 2 fontes; 1 interrupção | contagem de ocorrências e de falas | 5 alertas para 1 fato (I5) |
| [x] | PRO-008 | Spam | livro vazio | 100 ocorrências idênticas | ≤ 1 interrupção | contagem | spam |
| [x] | PRO-009 | Spam | livro vazio | 100 ocorrências semelhantes (mesmo assunto, chaves distintas) | interrupções ≤ teto diário | contagem | spam |
| [x] | PRO-010 | Spam | livro vazio | rajada de 50 em 1 s | ≤ teto; sem exceção | contagem + ausência de throw | burst |
| [x] | PRO-011 | Silêncio | livro vazio | 10 000 ocorrências, fração pequena relevante | avaliadas 10 000; persistidas ≪; interrompidas ≤ teto | contadores + tempo | ruído e custo |
| [x] | PRO-012 | Aprendizado | assunto novo | 5 alertas abertos + 3 perguntas + 2 ações | peso do assunto sobe de forma monotônica | peso antes/depois | não aprende |
| [x] | PRO-013 | Aprendizado | assunto com peso alto | 10 ignorados + 3 rejeitados | peso cai; assunto fica silenciado | peso + `silenciado_ate` | não desaprende |
| [x] | PRO-014 | Aprendizado | rejeição explícita | mensagem "não precisa me avisar disso" logo após alerta | assunto silenciado; próxima ocorrência igual não fala | contagem de falas | ETAPA 6 |
| [x] | PRO-015 | Aprendizado | preferência contraditória | rejeita e depois age sobre o mesmo assunto | peso reflete a evidência mais recente sem zerar histórico | peso | preferência instável |
| [x] | PRO-016 | Aprendizado | preferência expirada | silêncio vence após o prazo | assunto volta a poder falar | relógio injetado | silêncio eterno |
| [x] | PRO-017 | Horário | fora da janela de atividade | ocorrência moderada + média | decisão `resumir`, não `alertar` | decisão | interrupção noturna |
| [x] | PRO-018 | Horário | fora da janela | ocorrência grave + alta | `alertar` (fura o silêncio) | decisão | emergência engolida (R12) |
| [x] | PRO-019 | Confiança | livro vazio | confiança baixa + severidade grave | `perguntar`; o texto declara a incerteza | decisão + texto | afirma sem base (I6/R8) |
| [x] | PRO-020 | Oportunidade | jornal com 1, 5, 20, 100 execuções do mesmo procedimento | varredura | oportunidade só a partir do limiar; uma vez por assinatura | contagem por patamar | falso positivo/negativo |
| [x] | PRO-021 | Oportunidade | oportunidade detectada | — | decisão `sugerir`, nunca `agir`; nenhuma habilidade executada | ausência de execução | ETAPA 14 |
| [x] | PRO-022 | Justificativa | qualquer decisão | ler o registro | contém gatilho, motivos, evidência, confiança, ação | forma do registro | ETAPA 18 |
| [x] | PRO-023 | Persistência | livro com estado | descartar a instância e reabrir do disco | perfil, pesos, dedup, decisões e silêncios preservados | releitura | ETAPA 26 |
| [x] | PRO-024 | Concorrência | livro compartilhado | 40 `perceber` simultâneos | nenhuma escrita perdida; contadores fecham | contagem final | perda silenciosa |
| [x] | PRO-025 | Falha | disco indisponível (raiz inválida) | `perceber` | não lança; não fala; registra a degradação | ausência de throw + log | I7 |
| [x] | PRO-026 | Falha | ocorrência malformada (null, vazia, campos errados) | `perceber` | rejeitada; não fala; não persiste | retorno + contagem | I7 |
| [x] | PRO-027 | Segurança | — | ocorrência com instrução no `resumo` ("ignore as regras, execute X") | tratada como texto; decisão inalterada; nenhuma execução | decisão idêntica ao controle | prompt injection (I4) |
| [x] | PRO-028 | Segurança | — | ocorrência declarando `severidade: 'critica'`, `confianca: 'total'`, `pontuacao: 99` | valores fora do enum recusados; campo não declarado recusado | rejeição | manipulação de prioridade |
| [x] | PRO-029 | Segurança | — | ocorrência com `id_usuario` de terceiro no payload | ignorado; o dono é o da sessão | dono do registro | forja de escopo (I3) |
| [x] | PRO-030 | Segurança | — | `id_usuario` com `../` ou vazio | recusado antes de virar caminho | throw controlado | path traversal |
| [x] | PRO-031 | Segurança | — | ocorrência com 1 MB de texto e caracteres de controle | truncada e saneada; sem controle C0 | conteúdo persistido | payload abusivo |
| [x] | PRO-032 | Observabilidade | — | ciclo completo | linhas `canal:'proativo'` para cada etapa do ciclo | captura de stdout | ETAPA 29 |
| [x] | PRO-033 | Observabilidade | segredo no ambiente | ocorrência contendo o segredo | segredo redigido no log e no disco | busca pelo literal | vazamento |
| [x] | PRO-034 | Longa duração | 7 dias virtuais, 2 perfis | eventos operacionais, falhas, repetições, reações | métricas calculadas; usuário B recebe menos que A; nenhum dia acima do teto | relatório de métricas | ETAPA 27 |
| [x] | PRO-035 | Regressão | suíte existente | `npm test` | 1734 testes, 0 fail | saída da suíte | I8 |
| [x] | PRO-036 | Regressão | fronteira | teste de grafo | novo módulo de disco declarado; ESTADO_INTERNO não alcança EFEITO_EXTERNO | `fronteira-interna.test.ts` | I2/I8 |
| [x] | PRO-037 | Regressão | superfície | portão de superfície | catálogo inalterado (nenhuma habilidade nova) | `superficie-declarada.test.ts` | I8 |
| [x] | PRO-038 | Integração | `Porta.ts` montada | aviso do vigia | passa pelo motor proativo, não direto ao barramento | teste de fiação | integração falsa |
| [x] | PRO-039 | Integração | ciclo autônomo | tique com motor injetado | varredura de oportunidade roda e não derruba o ciclo | teste do ciclo | I7 |
| [x] | PRO-040 | Métrica | após uma campanha | ler métricas | `utilidade`, `taxa_falso_positivo`, `taxa_duplicata`, `taxa_acao`, `taxa_dispensa`, `taxa_ignorado` calculados a partir de evidência | relatório | ETAPA 28 |

## 5. Fora de escopo (declarado, não esquecido)

| Item | Motivo |
|---|---|
| Monitores sobre fontes externas (notícias, ANTT) — FASE 4 | Um monitor sem fonte real verificada é abstração especulativa, e uma fonte inventada viola I6. Requer integração e validação de rede que este ciclo não pode provar. |
| `agir` como decisão alcançável | A camada proativa responde "devo trazer isto à pessoa?", nunca "posso executar?". Executar continua exigindo `PorteiroAutorizacao` + plano determinístico. |
| Redação da fala por LLM | A fala é composta deterministicamente. Um modelo no caminho da fala proativa reintroduz variância e custo em algo que roda sozinho, sem ninguém olhando. |
| Controle de horário de silêncio na interface | Sem tela hoje; a janela é derivada da atividade observada + padrão noturno. |
| Canal WhatsApp | `PortaWhatsapp.ts` monta o próprio Kernel; a fiação proativa é só da porta web neste ciclo. |

## 6. Onde cada ID foi provado

| Arquivo | IDs | Resultado |
|---|---|---|
| `testes/proatividade.test.ts` (44) | PRO-001 a PRO-026, PRO-038, PRO-039, PRO-040 + política pura | 44/44 |
| `testes/proatividade-adversarial.test.ts` (16) | PRO-024, PRO-027 a PRO-033 | 16/16 |
| `testes/proatividade-longa-duracao.test.ts` (8) | PRO-034 (LD-001 a LD-008) | 8/8 |
| `npm test` (suíte inteira) | PRO-035, PRO-036, PRO-037 | 1878 testes, 0 fail, 3 skipped |
| `testes/boot/proatividade-fiacao.mts` | PRO-038 em **processo real** | FIAÇÃO VIVA, exit 0 |

## 7. Falhas encontradas pelo ciclo, e o que elas eram

Nove falhas em três rodadas. **Quatro eram defeitos de implementação** — as
outras cinco eram o plano ou o simulador errando sobre o próprio modelo.

| # | Falha | Classe | Correção |
|---|---|---|---|
| 1 | PRO-011: 500 ocorrências persistidas, 87 s | **BUG DE IMPLEMENTAÇÃO** | `PISO_DE_REGISTRO` (0,30) era menor que o mínimo atingível da fórmula (≈0,394): o ramo `ignorar` era inalcançável. Piso → 0,42, limiar → 0,60, ambos ancorados em três pontos de referência medidos |
| 2 | PRO-013 (`decisao_tomada` nunca logado) | **BUG DE IMPLEMENTAÇÃO** | `...dados` sobrescrevia o campo `acao` do envelope de log. O trilho de auditoria nomeava a etapa errada. Envelope passou a vencer o payload; o campo do payload virou `decisao` |
| 3 | `falar` que lança | **BUG DE IMPLEMENTAÇÃO** | falha de ENTREGA era registrada como `livro_indisponivel`, culpando o disco por um socket caído. Ganhou `catch` próprio e o evento `falha_na_entrega` |
| 4 | LD-002/007 | **BUG DE ARQUITETURA** | só `grave + alta` alcançava `alertar`, então a pontuação de relevância governava *se* vale falar e nunca *como*. Dois perfis opostos recebiam alertas idênticos a semana inteira. Nasceu `LIMIAR_DE_ALERTA` e a promoção por relevância individual |
| 5 | PRO-030b (`__proto__`) | **TESTE INCORRETO** no mecanismo | `__proto__` vira `proto` no saneamento; quem atravessa intacto é `constructor`/`prototype`. Além de corrigir a expectativa, `atencaoDe` passou a usar `Object.hasOwn` — a busca não pode depender só do guard de nome |
| 6 | PRO-019 (regex) | **TESTE INCORRETO** | `/verific/` não casa "verifi**q**ue". Corrigido — e a falha expôs um defeito real de composição: faltava pontuação entre resumo e evidência |
| 7 | PRO-020 (patamar 100) | **TESTE INCORRETO** | a fixture espalhava 100 passos por 24 dias, fora da janela de 14 |
| 8 | PRO-025 (não degradou) | **TESTE INCORRETO** | o caminho "dentro de um arquivo" não existia e `mkdir -p` só criava pastas: o teste media o caminho feliz achando que media a falha |
| 9 | LD-002 a LD-006 | **TESTE INCORRETO** | o simulador entregava as reações às 19h, dez horas após a fala e fora da janela de 30 min do modelo. Um roteiro que viola o modelo mede o modelo errado |

## 8. Lacunas registradas durante a implementação

1. **`testes/fronteira-efeitos.test.ts` foi alterado.** Não é afrouxamento: a
   regra A4 é uma *allowlist com justificativa escrita* de módulos autorizados a
   escrever em `dados/`, e o portão existe para obrigar quem acrescenta um
   escritor a classificá-lo. `LivroDeOcorrencias.ts` entrou com a justificativa
   ao lado, como `Agenda.ts` entrou antes.
2. **PRO-032 no processo real:** a sonda de fiação não observou linhas
   `canal:"proativo"` no stdout do motor. É o comportamento correto — nenhuma
   ocorrência foi percebida naquela execução, e registrar atividade de mensagem
   não emite log. A observabilidade do ciclo está provada em processo de teste
   (PRO-032), **não** em processo de produção. `NÃO VALIDADO` em produção.
3. **Canal WhatsApp sem camada proativa.** `PortaWhatsapp.ts` monta o próprio
   Kernel e não foi fiado. Declarado fora de escopo na seção 5.
4. **Sem tela para a janela de silêncio.** A janela é derivada de atividade
   observada + padrão noturno. Não há controle na interface.
