# Test plan — camada analítica (crítica, suficiência, abstenção)

`CHANGE-ID: ANALITICO-SENIOR-2026-08-19`
`BASELINE: commit 31598c8, árvore SUJA (91 linhas), tsc limpo, npm test 1894/1897`

## Desvio de processo, declarado

O orquestrador exige o test-plan **antes** da implementação. Este documento foi
escrito **depois**. Não vou fingir o contrário: o risco real desse desvio é que
os critérios tenham sido escritos para caber no que o código já faz.

O que reduz — e não elimina — esse risco:

- o **holdout** (`testes/holdout/cenarios.ts`) foi escrito a partir das cinco
  proibições literais da missão, não do código, e **reprovou 3 de 13 casos na
  primeira execução**. Um conjunto escrito para caber no código teria passado;
- a **varredura adversarial** achou 2 escapes que o desenho não previa (A1, A2);
- as baterias de nível acharam 3 falsos positivos de regex (B1, B2, C3).

Total: **8 defeitos achados pelos próprios testes**, todos corrigidos e listados
abaixo. Um plano escrito depois que não reprova nada é teatro; este reprovou.

## Impact graph

| Superfície | Mudança | Risco |
|---|---|---|
| `Habilidade.ResultadoHabilidade` | +1 campo **opcional** | LOW — nenhuma habilidade existente muda |
| `Investigacao.Evidencia` | +1 campo **opcional** | LOW — 4 consumidores, nenhum quebra |
| `Kernel.processar` | +coleta, +dossiê, +curto-circuito, +rodapé | **CRITICAL** — muda o texto que o operador lê |
| `Kernel.PassoExecutado` | +1 campo opcional | LOW |
| `cargasLuft` métrica `margem` | +emissão de evidência | MEDIUM — caminho de dado real |
| 5 módulos novos | puros, sem I/O | MEDIUM — lógica nova |

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | AN-001 | proibição | 30 cargas elegíveis, 0 com data de entrega | perguntar quantas atrasaram | **abster**; nunca "zero" | holdout H01 | CRITICAL |
| [x] | AN-002 | proibição | margem sobre 3579/4064 cargas | perguntar a margem da operação | degrau ≤ descritiva; confiança ≤ média | holdout H02 | CRITICAL |
| [x] | AN-003 | proibição | planilha diz 73, histórico diz 75 | perguntar quantos motoristas | **abster**; nomear a divergência | holdout H03 | CRITICAL |
| [x] | AN-004 | proibição | margem e pedágio andam juntos, sem experimento | "por que a margem caiu?" | degrau ≤ comparativa; **não** calar | holdout H04 | HIGH |
| [x] | AN-005 | proibição | custo deduzido por km (`inferencia`) | perguntar o custo do mês | degrau ≤ descritiva | holdout H05 | HIGH |
| [x] | AN-006 | adversarial | 2026 a 100%, 2024 a 88% | "melhorou em relação a 2024?" | ressalva de denominador móvel | holdout H06 | HIGH |
| [x] | AN-007 | adversarial | pergunta com hipótese embutida, 4 cargas | "confirma que foi o motorista X?" | degrau ≤ descritiva; amostra pequena | holdout H07 | CRITICAL |
| [x] | AN-008 | adversarial | número de 1 mês atrás | "quantas cargas em rota **agora**?" | ressalva de idade; confiança ≤ média | holdout H08 | MEDIUM |
| [x] | AN-009 | **falso positivo** | mesma fonte lida 2× no mesmo dia | perguntar a contagem do dia | **não** pode acusar contradição | holdout H09 | HIGH |
| [x] | AN-010 | **falso positivo** | tudo 100%, 3 fontes, dado de hoje | pergunta de gestão | **zero** ressalvas; `concluir` | holdout H10 / kernel 3.1 | HIGH |
| [x] | AN-011 | não-conformidade | decisão executiva com 1 evidência | "devo recomendar encerrar a rota?" | degrau ≤ descritiva; dizer o que falta | holdout H11 | CRITICAL |
| [x] | AN-012 | adversarial | grupo de 2 contra grupo de 437 | "qual a pior rota?" | ressalva de amostra pequena | holdout H12 | HIGH |
| [x] | AN-013 | não-conformidade | só uma hipótese, zero medição | "o que explica a queda?" | confiança baixa; degrau ≤ descritiva | holdout H13 | HIGH |
| [x] | KN-001 | **fiação** | habilidade emite evidência com cobertura 88% | turno completo no Kernel real | a ressalva sai na resposta **mesmo com síntese afirmativa** | kernel 1.1 | CRITICAL |
| [x] | KN-002 | **regressão** | habilidade sem evidência tipada | turno completo | resposta **byte a byte** a de antes | kernel 1.2 | CRITICAL |
| [x] | KN-003 | **trava vs. instrução** | ausência apresentada como zero | turno completo | `sínteses == 0` — a LLM **não é chamada** | kernel 2.1 | CRITICAL |
| [x] | KN-004 | trava | duas fontes divergem | turno completo | `sínteses == 0`; operador informado | kernel 2.2 | CRITICAL |
| [x] | KN-005 | custo | cobertura parcial | turno completo | **1** chamada de modelo, não 2 | kernel 1.1 | MEDIUM |
| [x] | AD-001 | escape | habilidade rotula tudo `contextual` | montar dossiê | degrau `nenhum` | adversarial A1 | HIGH |
| [x] | AD-002 | escape | `NaN` / `Infinity` como valor | montar dossiê | degrau `nenhum` | adversarial A2 | HIGH |
| [x] | AD-003 | escape | cobertura forjada em 100% | construir cobertura | impossível — é calculada | adversarial A3 | MEDIUM |
| [x] | AD-004 | escape | `fato_verificado` mentiroso | montar dossiê | cobertura ainda barra | adversarial A4 | MEDIUM |
| [x] | AD-005 | escada | 1 evidência ótima + 1 péssima | montar dossiê | teto = a pior | adversarial B1 | HIGH |
| [x] | AD-006 | **falso positivo** | 12 ressalvas leves | montar dossiê | **não** vira abstenção | adversarial B2 | HIGH |
| [x] | AD-007 | escada | 30 evidências perfeitas, pergunta causal | montar dossiê | ainda ≤ comparativa | adversarial B3 | HIGH |
| [x] | AD-008 | degenerado | data ilegível, números negativos, métrica de 5000 chars | montar dossiê | não lança, não mente | adversarial C1–C3 | MEDIUM |
| [x] | AD-009 | determinismo | mesma entrada 2× | montar dossiê | `deepEqual` | adversarial C4 / holdout | HIGH |
| [x] | AD-010 | observabilidade | qualquer dossiê | linha de auditoria | JSON parseável, sem cadeia de pensamento | adversarial D3 | MEDIUM |
| [x] | NV-001 | falso positivo | "o sistema caiu de novo" | escolher nível | **não** é comparação | nível B1 | HIGH |
| [x] | NV-002 | falso positivo | "te mandei porque achei importante" | escolher nível | **não** é pedido de causa | nível B2 | HIGH |
| [x] | NV-003 | falso positivo | "devo priorizar a rota X?" | escolher nível | **não** vira exigência causal | nível B3 | HIGH |
| [x] | NV-004 | mecanismo | os 7 níveis | comparar exigências | ≥5 combinações distintas | nível C1 | MEDIUM |
| [ ] | **RE-001** | **dado real** | planilha LUFT real, chave Graph | perguntar a margem de 2024 | cobertura medida sai com o número | **NÃO EXECUTADO** | HIGH |
| [ ] | **BR-001** | **navegador** | app rodando, operador real | turno de margem parcial | ressalva visível na bolha | **NÃO EXECUTADO** | HIGH |
| [ ] | **BR-002** | **navegador** | app rodando | turno de abstenção | texto determinístico na tela | **NÃO EXECUTADO** | HIGH |
| [ ] | **MT-001** | multi-turn | 2 turnos, memória entre eles | repetir a pergunta | ressalva não some no 2º turno | **NÃO EXECUTADO** | MEDIUM |

## Itens NÃO executados — e por quê

`RE-001`, `BR-001`, `BR-002`, `MT-001` estão **em branco de propósito**. Não são
PASS, não são FAIL: são **UNKNOWN**.

O motivo é ambiental e está registrado em
`test-evidence/ANALITICO-SENIOR-2026-08-19/01-ambiente-contaminado.txt` e
`06-atribuicao-de-falhas.txt`: uma sessão concorrente está editando `Kernel.ts`,
`ClientePlanilhaOcis.ts`, `ContratoFactual.ts` e `cargasLuft.ts` ao vivo, e a
suíte completa tem 23 falhas que não são desta alteração. Subir o servidor
contra uma árvore em movimento produziria evidência de uma versão que não existe
depois — o oposto do que evidência serve para fazer.

A regra de block do orquestrador manda BLOQUEAR quando "a aplicação estiver
indisponível" ou "o impacto não puder ser determinado". Aplicada a esses quatro
itens: **BLOQUEADOS**. Aplicada à camada pura: os 33 itens acima têm evidência.

## Defeitos achados pelas próprias baterias

| # | Onde | O que era | Achado por |
|---|---|---|---|
| 1 | `Suficiencia.explicarConfianca` | apontava o fator de menor **contribuição** (`nota×peso`), o que elege sempre o mais leve — a explicação apontava para o lado errado | dev C3 |
| 2 | `MotorCritica.r7` | só `hipotese`/`desconhecido` rebaixavam; `inferencia` passava como conclusão populacional = "estimativa como valor confirmado" | holdout H05 |
| 3 | `MotorCritica.r2` | cobertura de 88% era ressalva **leve** → confiança alta sobre 12% ausente | holdout H02 |
| 4 | `Suficiencia.avaliarConfianca` | média ponderada diluía o único fator ruim; dado de 1 mês saía "alta" | holdout H08 |
| 5 | `NivelDeAnalise.COMPARATIVO` | `caiu\s+de` capturava "caiu **de novo**" | nível B1 |
| 6 | `NivelDeAnalise.CAUSAL` | `porque` solto capturava relato ("mandei porque achei importante") | nível B2 |
| 7 | `NivelDeAnalise.COMPARATIVO` | `\b` após `a` não casa dentro de "**ao**" → "em relação ao ano passado" não era reconhecido | nível C3 |
| 8 | `DossieAnalitico.montarDossie` | o `reduce` do teto **subia** o degrau quando a ressalva de volume era menos severa | revisão própria |
| 9 | `MotorCritica.criticar` | tudo rotulado `contextual` deixava 7 das 10 regras cegas | adversarial A1 |
| 10 | `MotorCritica.criticar` | `NaN` atravessava: toda comparação com ele é falsa | adversarial A2 |

## Comandos

```bash
npm run benchmark-analitico
```

```bash
node --import tsx --test testes/critica-analitica.test.ts testes/nivel-de-analise.test.ts testes/camada-analitica-kernel.test.ts "testes/holdout/*.test.ts"
```
