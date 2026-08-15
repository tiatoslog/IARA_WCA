# Evidência — FASE A: Capability Intelligence (14/08/2026)

Test plan: `docs/prd/test-plan-fase-a-capability-intelligence.md`.
Baseline: `eb804c8` (suíte 886/886). Depois da implementação: **905/905** +
`tsc --noEmit` limpo.

Ambiente do E2E: dev server próprio em `IARA_PORTA=3058` (build isolado
`.next-3058`), **modo local declarado** (`NEXT_PUBLIC_IARA_MODO_LOCAL=1`, sem
Supabase — autenticação não é alvo destas provas; o login real foi provado no
E2E de 14/08, `test-evidence/E2E-2026-08-14-playwright/`). LLM (Anthropic) e
planilha LUFT (Microsoft Graph) **reais**. Navegação por Playwright headless,
como usuária: digitar → enviar → esperar → ler → abrir painel.

## Provas

**(a) Exemplo novo sem âncora alcança a habilidade** — `E2E-001-exemplo-luft.png`
"Qual o total faturado essa semana?" (frase dos `exemplos` novos de
`consultar_estatisticas_cargas_luft`; sem âncora determinística) → rota
`plano_cognitivo` → habilidade executada contra a planilha real → resposta
"essa semana (10/08 a 14/08): R$ 119.015,00 (66 cargas)". A cadeia no painel
mostra EXECUÇÃO `consultar_estatisticas_cargas…` com proveniência
(`registros_lidos=2649`, `operacao=VALOR_TOTAL`) e VERIFICAÇÃO confirmada.

**(b) Pergunta sem capacidade vira lacuna e aparece na auditoria** —
`L1-horas-extras.png` + `L1-horas-extras-auditoria.png`
"Quantas horas extras os motoristas fizeram este mês?" → resposta honesta
("Não tenho esse dado…") → plano cognitivo só-raciocínio + frase operacional →
lacuna registrada. "Faça uma auditoria do sistema" → seção **"O que me pediram
e eu não sei fazer"** com a assinatura mascarada
(`quantas horas extras os motoristas fizeram este mes?` — 1 vez) e conduta.
Nota do caminho real: a primeira candidata ("custo de pedágio",
`E2E-002a-sem-capacidade.png`) NÃO virou lacuna porque a LLM escolheu uma
habilidade real e respondeu com o dado que tinha, admitindo o limite — o
comportamento certo, registrado aqui como negativo verdadeiro.

**(c) Painel cognitivo mostra a cadeia do turno** — `E2E-001-exemplo-luft.png`
Seção "Cadeia cognitiva" com INTENÇÃO → CAPACIDADE → PLANO → EXECUÇÃO →
VERIFICAÇÃO → RESPOSTA. `E2E-000-sala-aberta.png` prova o estado vazio honesto
("Nenhum turno nesta sessão ainda"); `resultados.json` (E2E-004) prova que a
cadeia é substituída no turno seguinte, nunca misturada.

## Rodadas pós-fix (auditoria adversarial de 14-15/08)

A auditoria adversarial (agente independente) achou uma cadeia P1 na primeira
versão do registro de lacunas: assinatura quase-verbatim + fila única de
processo exposta a qualquer operador + descoberta alargada pelos exemplos
(desabafo com vocabulário de trabalho parecia operacional). Correções:
partição por operador (`inventarioDe`), e-mail mascarado, log sem assinatura,
filtro de FORMA DE PEDIDO no gancho do Kernel, resposta da cadeia
primeiro-que-fecha (lembrete/vigia não sobrescrevem turno concluído), e
instrução de plano-vazio no prompt do planejador (a LLM acolchoava o plano com
consultas irrelevantes e escondia a lacuna do detector — diagnóstico feito
PELO próprio painel cognitivo, `PF4-cnh.png`).

- `resultados-posfix.json` (PF1-PF3): desabafo NÃO vira lacuna nem vaza na
  auditoria; "horas extras" caiu em plano acolchoado (negativo do detector,
  motivou o fix do prompt).
- `resultados-posfix2.json` (PF4-PF6): reprodução do acolchoamento com CNH.
- `resultados-posfix3.json` (PF7-PF9): **prova final** — CNH e vale-pedágio
  registrados como lacunas e expostos na auditoria com assinatura mascarada;
  desabafo continua fora. `PF9-auditoria.png`.

## Arquivos

- `resultados.json` — rodada 1 (E2E-000/001/002a/002b/003/004), com resposta,
  rota e cadeia de cada turno.
- `resultados-rodada2.json` — rodada 2 (caça da lacuna), L1 provou.
- `console.log` — console do navegador das duas rodadas.
- `matriz-e2e.json` + `M*.png` — matriz E2E da auditoria profunda (§19).
- `*.png` — screenshots brutos de cada turno.
