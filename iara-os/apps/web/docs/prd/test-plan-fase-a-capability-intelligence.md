# Test plan — FASE A: Capability Intelligence

**Baseline:** submódulo `IARA_WCA` em `eb804c8`, branch `main`, árvore limpa,
suíte 886/886 verde (rodada em 14/08/2026, duração 52 s), `npx tsc --noEmit`
assumido verde no baseline (commit anterior passou CI local).

**Escopo:** três entregáveis aprovados pela operadora em 14/08/2026 à noite:

1. **Manifesto rico** — `ManifestoHabilidade.exemplos` e `.capacidades`
   (opcionais no tipo, obrigatórios por teste de contrato no catálogo);
   `DescobertaCapacidades` indexa os dois (token de exemplo = sinal forte);
   `MotorRaciocinio.planejar()` inclui exemplos no prompt; 30 habilidades
   preenchidas; tentativa de aposentar `PERGUNTA_DE_FATO`.
2. **Lacuna de capacidade** — módulo `LacunasCapacidade` no kernel: registra
   `{hash, assinatura sintática, contagem, primeira/última ocorrência}` quando
   a rota `plano_cognitivo` devolve plano só-raciocínio para frase que
   `pareceOperacional()` marcou true. `auditar_sistema` ganha a seção
   "o que me pediram e eu não sei fazer".
3. **Painel cognitivo** — cadeia INTENÇÃO→CAPACIDADE→PLANO→EXECUÇÃO→
   VERIFICAÇÃO→RESPOSTA do último turno projetada dos eventos JÁ existentes
   (`CompiladorSnapshot` + `lib/snapshot.ts` + componente novo; zero mudança
   em `Kernel.ts`/`Evento.ts`).

**Nota sobre a condição (b) do entregável 2** ("não tenho esse dado"): apurada
antes da implementação — não existe marcador determinístico dessa frase no
código; ela é prosa emitida pela LLM em `raciocinio_direto`/síntese. Detectar
por regex sobre a resposta violaria o princípio "determinístico antes de
prompt" e produziria falso positivo em citação. A lacuna nasce apenas do sinal
(a), que é o caso real observado ("Motoristas disponíveis agora?" 3× em
14/08). Registrado aqui como decisão, não omissão.

## Matriz de casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|-------|----|-----------|--------------|------|--------------------|-----------|-------|
| [ ] | CT-001 | contrato | catálogo real carregado | teste varre `CATALOGO` | toda habilidade tem `exemplos` não-vazio e `capacidades` não-vazio | saída `npm test` | habilidade nova entra sem exemplos e a descoberta regride |
| [ ] | CT-002 | contrato | idem | teste varre exemplos | nenhum exemplo vazio/whitespace; exemplos ≤ 140 chars | `npm test` | exemplo-parágrafo poluir o prompt do planejador |
| [ ] | UN-010 | unit | índice construído do catálogo real | `pareceOperacional("Motoristas disponíveis agora?")` | `true` (já era; não pode regredir) | `npm test` | regressão do fix de 14/08 |
| [ ] | UN-011 | unit | idem | frase presente só nos `exemplos` novos (sem token de descricao) | `true` — token de exemplo é sinal forte | `npm test` | exemplos indexados mas sem peso |
| [ ] | UN-012 | unit | idem | conversa social ("hoje foi um dia cansativo", "conte uma curiosidade") | `false` | `npm test` | exemplos abrirem falso positivo social |
| [ ] | UN-013 | unit | idem | `decidir()` com frase de exemplo sem âncora | rota `plano_cognitivo` | `npm test` | portão não consome o índice novo |
| [ ] | UN-020 | unit | manifesto com exemplos | prompt de `planejar()` | lista inclui `exemplos:` da habilidade | `npm test` (inspeção do prompt via stub de ClienteClaude) | LLM segue sem ver exemplos |
| [ ] | UN-030 | unit | `LacunasCapacidade` novo | registrar mesma frase 3× (variações de conteúdo, mesma forma) | 1 lacuna, contagem 3, hash estável, SEM texto cru | `npm test` | log com outro nome (privacidade) |
| [ ] | UN-031 | unit | idem | frases de formas diferentes | lacunas separadas | `npm test` | agrupamento agressivo demais |
| [ ] | UN-032 | unit | Kernel real com raciocínio stub devolvendo plano só-raciocínio | "Motoristas disponíveis agora?" (caso semente) | lacuna registrada no ciclo real | `npm test` | gancho do Kernel não dispara |
| [ ] | UN-033 | unit | idem, plano com habilidade real | mesma frase resolvida por habilidade | NENHUMA lacuna registrada | `npm test` | falso positivo: registrar o que ela sabe fazer |
| [ ] | UN-034 | unit | lacunas registradas | `auditar_sistema` | seção "o que me pediram e eu não sei fazer" com contagem | `npm test` | fila de evolução invisível |
| [ ] | UN-035 | unit | zero lacunas | `auditar_sistema` | seção ausente ou "nenhuma" — nunca inventa | `npm test` | ruído na auditoria |
| [ ] | UN-040 | unit | eventos de um turno completo no barramento | `compilar()` | snapshot carrega `cadeia` com elos intenção/decisão/plano/execução/verificação/resposta | `npm test` (projecao.test.ts ou novo) | painel mostrar turno trocado |
| [ ] | UN-041 | unit | novo turno começa (`MENSAGEM_RECEBIDA`) | `compilar()` | cadeia do turno anterior é substituída, não misturada | `npm test` | mistura de turnos |
| [ ] | RG-001 | regressão | suíte inteira | `npm test` | 886 antigos + novos, 0 falhas | saída `npm test` | qualquer regressão |
| [ ] | RG-002 | regressão | tsc | `npx tsc --noEmit` | 0 erros | saída tsc | tipo quebrado servidor↔cliente |
| [ ] | RG-003 | regressão | tentativa de aposentar `PERGUNTA_DE_FATO` | rodar decisao.test.ts + descoberta-capacidades.test.ts sem o regex | verde = aposenta; vermelho = mantém e documenta | saída `npm test` | perder rota de pergunta-de-fato |
| [ ] | E2E-001 | Playwright | dev server porta própria (`IARA_PORTA=30XX`), login real | digitar frase dos `exemplos` novos de habilidade sem âncora | resposta vem da habilidade (não conversa); painel mostra CAPACIDADE | screenshot + console + rede em `test-evidence/FASE-A-2026-08-14/` | descoberta não funciona ao vivo |
| [ ] | E2E-002 | Playwright | idem | pergunta operacional sem capacidade correspondente | resposta honesta; lacuna aparece depois em "faça uma auditoria" | screenshot do turno + screenshot da auditoria | lacuna não registrada ao vivo |
| [ ] | E2E-003 | Playwright | idem | qualquer turno concluído | painel cognitivo mostra a cadeia do turno | screenshot | painel vazio/mentindo |
| [ ] | E2E-004 | Playwright | idem | turno novo após E2E-003 | painel atualiza para o turno novo | screenshot | painel congelado |

## Fluxos não óbvios cobertos

- **Estado vazio**: UN-035 (auditoria sem lacunas), UN-040 com turno sem plano
  (cadeia parcial: intenção+decisão+resposta apenas — elos ausentes não
  inventados).
- **Erro**: turno com `FALHA` — cadeia mostra o que houve até ali (coberto por
  UN-040 variação).
- **Refresh**: o painel lê o snapshot corrente; após reload o snapshot
  rehidrata — o painel pode vir vazio até o próximo turno, o que é honesto
  (verificado manualmente no E2E-003).
- **Privacidade**: UN-030 prova que a lacuna NUNCA armazena texto cru além da
  assinatura sintática (mesmo contrato do RagHistorico). A cadeia do painel
  carrega o enunciado DO PRÓPRIO operador (dado dele, na sessão dele) — não é
  vazamento; shards de terceiros nunca entram na cadeia.
- **Duplo turno rápido**: preempção já publica `TAREFA_CANCELADA`; UN-041
  garante que a cadeia não mistura turnos.

## Critério de aprovação

Suíte inteira verde + tsc verde + E2E-001..004 com evidência bruta gravada em
`test-evidence/FASE-A-2026-08-14/` + verificação independente (subagente QA)
confirmando as evidências. Sem isso: BLOCKED.
