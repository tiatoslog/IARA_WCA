# Test Plan — reconstrução UX de Dispositivos, Perfil e Automação — 2026-08-15

## BASELINE

- `BASELINE_ID`: `UX-DISPOSITIVOS-2026-08-15-F1`
- Submódulo `IARA_WCA`: branch `main`, commit `edad8fa`.
- Escopo: só apresentação e organização de navegação. **Sem mudança** em
  `lib/execucao.ts`, `Pareamento.ts`, tipos do barramento, ou nos callbacks que
  `useIaraSocket` expõe. Pareamento continua: braço gera código/QR, PWA
  autoriza — decisão confirmada com o operador nesta sessão.
- Risco: **MEDIUM**. Toca componente com fluxo já testado ponta a ponta
  (`test-plan-braco-qr.md`) — o risco não é lógica nova, é regressão de algo
  que já funcionava.

## O que muda

| Arquivo | Mudança |
|---|---|
| `components/Dispositivos.tsx` | Estado interno `vista: 'lista' \| 'conectar'`. Lista fica compacta (linhas de máquina + botão conectar); explicação longa vira `?` de ajuda; assistente de 3 passos assume a instalação+pareamento, hoje espalhados em blocos soltos. |
| `components/Automacao.tsx` (novo) | Status agregado + download do Braço + notas de versão — o que hoje é o bloco final de `Dispositivos.tsx`. |
| `components/MenuPerfil.tsx` (novo) | Dropdown pequeno: Meu perfil / Dispositivos / Automação / Sair. |
| `components/PainelConversa.tsx` | `Gaveta` ganha `'perfil'` e `'automacao'`; clique no nome abre o menu em vez da Ficha direto; nova prop `onSair`. |
| `app/page.tsx` | Passa `onSair={aoSair}` para `PainelConversa`. |
| `app/globals.css` | Classes novas: `.menu-perfil*`, `.dispositivos-passo*`, `.ajuda`. Nenhuma classe existente removida (só reorganizada). |

## O que NÃO existe e por isso não entra

Notificações e Segurança não têm nenhuma funcionalidade por trás hoje — criar
a tela seria implementação pela metade. Ficam de fora até existir conteúdo
real. `MaquinaDoOperador`, `Pareamento.ts`, o backend de pareamento: intocados.

## A. Fluxos principais

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [ ] | UX-001 | Navegação | Sessão logada, IARA ociosa | Clicar no nome no cabeçalho | Menu dropdown abre com 4 itens (Meu perfil, Dispositivos, Automação, Sair), NÃO a Ficha direto | screenshot + DOM | HIGH |
| [ ] | UX-002 | Navegação | Menu aberto | Clicar fora do menu | Menu fecha, nenhuma gaveta abre | screenshot | MEDIUM |
| [ ] | UX-003 | Navegação | Menu aberto | Clicar "Meu perfil" | Abre a Ficha (idêntica à de hoje, campos intactos) | screenshot | HIGH |
| [ ] | UX-004 | Navegação | Menu aberto | Clicar "Dispositivos" | Abre a gaveta Dispositivos, vista `lista` | screenshot | HIGH |
| [ ] | UX-005 | Navegação | Menu aberto | Clicar "Automação" | Abre a tela Automação | screenshot | HIGH |
| [ ] | UX-006 | Navegação | Menu aberto | Clicar "Sair" | Mesmo efeito do botão "Sair" existente (volta à Portaria) | screenshot | HIGH |
| [ ] | UX-007 | Estado vazio | Nenhuma máquina pareada | Abrir Dispositivos | Vista `lista`: frase curta + `[+ Conectar computador]`, sem parágrafo de explicação permanente | screenshot | HIGH |
| [ ] | UX-008 | Assistente | Vista `lista` | Clicar "Conectar computador" | Vista `conectar`: 3 passos visíveis (baixar, abrir, código/QR) | screenshot | HIGH |
| [ ] | UX-009 | Assistente | Vista `conectar` | Digitar código válido, clicar Autorizar | Sucesso: `ultimaAcao.ok`, volta pra `lista`, máquina nova aparece | screenshot + evento real do servidor | HIGH |
| [ ] | UX-010 | Assistente | Vista `conectar` | Clicar "Voltar" | Retorna à `lista` sem perder o que já estava lá | screenshot | MEDIUM |
| [ ] | UX-011 | QR | URL com `?parear=CODIGO`, sessão logada | Navegar | Gaveta Dispositivos abre DIRETO na vista `conectar`, passo 3, código pré-preenchido (comportamento de hoje preservado) | screenshot + `input.value` | HIGH |
| [ ] | UX-012 | Estado com máquinas | ≥1 máquina pareada | Abrir Dispositivos | Vista `lista` mostra as linhas (nome, sistema, online/offline) — MESMA lógica de hoje, só sem o bloco de instalação embaixo | screenshot | HIGH |
| [ ] | UX-013 | Automação | Automação aberta | Ler conteúdo | Status agregado (N conectados) bate com a lista real; SEM lista de máquina duplicada | screenshot | MEDIUM |
| [ ] | UX-014 | Regressão | — | Regressão completa | Renomear, desconectar, atualizar máquina continuam funcionando (lógica intocada, só reposicionada) | leitura de código + smoke visual | HIGH |
| [ ] | UX-015 | Regressão automatizada | — | `npm test` | Mesma contagem/mesma falha pré-existente de antes desta mudança | log | MEDIUM |
| [ ] | UX-016 | Regressão automatizada | — | `npm run build` | Compila sem erro | log | MEDIUM |
| [ ] | UX-017 | Responsivo | Viewport mobile (375px) | Abrir menu, Dispositivos, Automação | Nenhum overflow horizontal, alvo de toque ≥ 40px | screenshot mobile | MEDIUM |
| [ ] | UX-018 | QA independente | App rodando de verdade | Agente que NÃO implementou executa UX-001 a UX-013 no browser | Sem afirmação textual como prova — só o que o navegador realmente mostrou | relatório do QA + screenshots | HIGH |

## Regra de execução

UX-009 e UX-011 dependem do mesmo ambiente que já bloqueou verificação completa
em 14/08 (schema `dispositivos_pareados` do Supabase de dev). Se o mesmo
bloqueio existir aqui, registrar como `UNVERIFIED` nomeado — não como `PASS`.
