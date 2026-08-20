# Diagnóstico arquitetural — antes de escrever uma linha da camada analítica

Baseline medido em 19/08/2026, commit `31598c8`, árvore SUJA (91 linhas de
`git status`, trabalho de sessão concorrente).

    tsc --noEmit    limpo
    npm test        1897 testes — 1894 pass, 0 fail, 3 skipped

## 1. O que já existe, e por isso não será recriado

| Conceito da missão | Já existe como | Onde |
|---|---|---|
| Intent engine | `MotorPercepcao` (âncoras + tipo + confiança) | `kernel/Percepcao.ts` |
| Orquestrador | `FuncaoExecutiva.decidir` → 5 rotas | `kernel/FuncaoExecutiva.ts` |
| Laço de agente | `Kernel.executarLaco` (decidir→executar→observar) | `kernel/Kernel.ts:1214` |
| Tool registry | `GerenciadorHabilidades` + manifesto rico | `kernel/GerenciadorHabilidades.ts` |
| Evidence/Hypothesis | `Evidencia`, `Anomalia`, `Hipotese`, `Diagnostico` | `kernel/Investigacao.ts` |
| Confiança calculada | `criarHipotese` — deriva de procedência, nunca aceita o campo | `kernel/Investigacao.ts:141` |
| Escala de verdade | `Procedencia` ordenada + `podeAfirmarSemRessalva` | `kernel/Verdade.ts` |
| Oráculo independente | `VerificacaoRuntime` + `lib/verificacao/oraculos` | reimplementa, não importa |
| Trava de fala | `AfirmacaoDeFeito` + retenção do stream | `kernel/Kernel.ts:2440+` |
| Determinismo de caminho | `ContratoFactual` (contagem sem LLM escolhendo) | `kernel/ContratoFactual.ts` |
| Autorização / risco | `PorteiroAutorizacao`, `PoliticaRisco`, `Autonomia`, `Sigilo` | `kernel/` |
| Orçamento | `OrcamentoDoTurno` (6 tetos) + `GuardaDeLaco` | `kernel/` |
| Trilha auditável | `RegistroOperacoes` (HMAC), `Prova.ts`, auditoria estruturada | `kernel/` |
| Cobertura de join | `CoberturaDoJoin` — `percentual: number \| null`, "0/0 não é 0%" | `nucleo/MargemOperacional.ts` |

Este não é um sistema ingênuo. As propriedades que a missão pede em geral
**existem em algum lugar**. O problema é outro.

## 2. A lacuna real — evidência trafega como PROSA

Três medições, não impressões:

1. **`ResultadoHabilidade` não tem campo de evidência.** É
   `{ texto, detalhe, resolveu }` (`kernel/Habilidade.ts:205`). Todo número que
   uma habilidade calcula vira `string` antes de sair dela.
2. **`Observacao.texto` é `string`.** O laço decide a próxima ação lendo prosa
   (`kernel/Observacao.ts:100`). Não existe caminho tipado do dado até a decisão.
3. **`Investigacao.ts` tem 4 consumidores e nenhum deles é dado de negócio.**
   `MotorAnalise.ts` — o único motor que constrói `Diagnostico` — está travado
   em lentidão de máquina (`FAIXAS` de cpu/memória/disco). Pergunta de operação
   ou de margem nunca produz um `Diagnostico`.

A consequência é precisa: **as propriedades analíticas boas deste repositório
são convenções de redação, escritas à mão, habilidade por habilidade.**
`dizerCobertura()` é um construtor de string dentro de `cargasLuft.ts`. Nada
obriga a próxima habilidade a chamá-lo. E o kernel não tem como *saber* que a
cobertura foi 71% — logo não tem como recusar uma afirmação sobre a população,
não tem como calcular confiança e não tem como se abster.

Para "por que a margem caiu?" o caminho de hoje é:

    âncora `analise` (acionavel:false) → sem receita → plano_cognitivo
      → LLM escolhe ferramenta → ferramenta devolve texto
      → LLM redige prosa → travas post-hoc (fala, oráculo, afirmação)

As travas post-hoc pegam **efeito falso** e **número sem procedência**. Nenhuma
delas pega hipótese vendida como fato, correlação vendida como causa, ausência
convertida em zero ou amostra parcial apresentada como população — porque para
pegar isso seria preciso ter o dado, e o dado já virou frase.

## 3. Crítica da própria missão

Registrada antes de implementar, conforme a Regra 2.

**3.1 — 11 especializações seriam 11 prompts com fantasia de capacidade.**
A missão proíbe isso na Regra Zero e pede as 11 quatro seções depois. Os dados
que esta IARA alcança hoje: planilha LUFT (carga, motorista, rota, valor,
status, data, tabelário de preço), incidentes no Supabase, sondas da máquina
local, calendário/e-mail via Graph. Não há dado de pessoa, de cliente, de
qualidade ou de processo. Uma "especialização de Pessoas" sobre esse conjunto
só poderia ser um prompt. **Decisão:** implementar o MECANISMO
(`CompetenciaAnalitica` — requisitos de dado, métricas, e o que ela RECUSA
concluir) e instanciar apenas as competências que o dado sustenta. As demais
ficam declaradas como ausentes, com o motivo. Competência que não tem dado é
lacuna a declarar, não persona a fingir.

**3.2 — 6 níveis são uma taxonomia, não um mecanismo.** Nível só é verificável
se MUDAR O QUE O SISTEMA FAZ. Aqui ele passa a determinar: evidência mínima
exigida, cobertura mínima, e se afirmação causal é permitida. Nível que só
mudasse o tamanho do texto seria teatro.

**3.3 — Motor de crítica NÃO pode ser outra chamada de LLM.** Duas razões: o
laço já custa até 8 voltas e a síntese é a chamada mais cara do turno
(`Kernel.ts:2287`); e um crítico estocástico não é verificável — ele teria a
mesma autoridade do texto que critica. A crítica aqui é **código puro** sobre
o conjunto de evidências. É o que a torna testável sem rede.

**3.4 — Risco de benchmark auto-aprovador.** Já custou caro nesta casa
(memória `iara-duble-nao-pode-ser-o-porteiro`, `iara-falso-verde-por-ancora-de-texto`).
Os casos que definem a implementação não podem ser os que a aprovam: holdout
separado, e portão por CONTAGEM/ESTADO, nunca por âncora de texto na resposta.

**3.5 — O que a missão pede e este trabalho NÃO entrega** está declarado como
UNKNOWN no relatório final, nunca convertido em PASS.

## 4. Desenho adotado

    habilidade calcula  →  Evidencia tipada + Cobertura   (novo campo OPCIONAL)
                              ↓
                        MotorCritica  (código puro, 8 contestações)
                              ↓
                        Suficiencia   (concluir | ressalvar | ABSTER)
                              ↓
              abster → resposta determinística, a LLM não vê o turno
              resto  → ressalvas entram na composição + Dossiê auditável

Nenhuma trava existente sai do lugar. A camada mora entre a execução e a
composição — o mesmo lugar onde o laço entrou em 19/08.
