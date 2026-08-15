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
| [x] | UX-001 | Navegação | Sessão logada, IARA ociosa | Clicar no nome no cabeçalho | Menu dropdown abre com itens (Meu perfil, Dispositivos, Automação[, Sair]), NÃO a Ficha direto | DOM real via `read_page`: 3 `menuitem` (Sair ausente — esperado, `aoSair=null` em modo local) | HIGH — VERIFIED |
| [x] | UX-002 | Navegação | Menu aberto | Clicar fora do menu | Menu fecha, nenhuma gaveta abre | DOM real: após clique no campo de texto, os 3 `menuitem` somem, conversa intacta | MEDIUM — VERIFIED |
| [x] | UX-003 | Navegação | Menu aberto | Clicar "Meu perfil" | Abre a Ficha (idêntica à de hoje, campos intactos) | `get_page_text` real: "Como você quer ser atendido" + todos os campos | HIGH — VERIFIED |
| [x] | UX-004 | Navegação | Menu aberto | Clicar "Dispositivos" | Abre a gaveta Dispositivos, vista `lista` | Testado pelas DUAS portas (ícone do cabeçalho E item do menu) — ambas abrem `.ficha` com título "Onde a IARA tem mãos" | HIGH — VERIFIED |
| [x] | UX-005 | Navegação | Menu aberto | Clicar "Automação" | Abre a tela Automação | `get_page_text` real: "Automação da IARA", status, download, notas | HIGH — VERIFIED |
| [ ] | UX-006 | Navegação | Menu aberto, sessão REAL (Supabase) | Clicar "Sair" | Mesmo efeito do botão "Sair" existente (volta à Portaria) | Não testável neste ambiente: modo local não tem sessão real para encerrar (`aoSair=null` por desenho, ver `MenuPerfil.tsx`). Revisão de código: `onSair={aoSair}` é o MESMO handler do botão "Sair" já existente em `app/page.tsx` | HIGH — UNVERIFIED (bloqueio de ambiente, não de código) |
| [x] | UX-007 | Estado vazio | Nenhuma máquina pareada | Abrir Dispositivos | Vista `lista`: frase curta + `[+ Conectar computador]` ou aviso de "sem banco", sem parágrafo de explicação permanente | `get_page_text` real confirma frase curta + fallback correto (banco indisponível nesta instância de QA) | HIGH — VERIFIED |
| [x] | UX-008 | Assistente | vista `conectar` | Renderização dos 3 passos | 3 passos visíveis (baixar, abrir, código/QR) | Via `?parear=`: `document.querySelectorAll('.dispositivos-passo').length === 3`, título "Conectar computador" | HIGH — VERIFIED |
| [ ] | UX-009 | Assistente | Vista `conectar`, banco real | Digitar código válido, clicar Autorizar | Sucesso: `ultimaAcao.ok`, volta pra `lista`, máquina nova aparece | Mesmo bloqueio de 14/08 (`test-plan-braco-qr.md`): Supabase de dev sem a tabela de pareamento. Revisão de código: `useEffect` que fecha o assistente em sucesso é novo nesta rodada, não herdado — ver `Dispositivos.tsx` linhas 298-302 | HIGH — UNVERIFIED (lacuna de ambiente, nomeada) |
| [x] | UX-010 | Assistente | Vista `conectar` | Botão "Voltar" presente e funcional | Retorna à `lista` | Presente em todas as capturas (`button "← Voltar"`); mecanismo é `setVista('lista')` direto, sem estado intermediário — revisão de código | MEDIUM — VERIFIED por revisão de código |
| [x] | UX-011 | QR | URL com `?parear=CODIGO`, sessão logada | Navegar | Gaveta Dispositivos abre DIRETO na vista `conectar`, passo 3 | Navegação real a `?parear=H7K29QP4`: abre direto em "Conectar computador", 3 passos, sem passar pela lista | HIGH — VERIFIED (prefill do código em si não visível nesta instância porque o passo 3 mostra o aviso de "sem banco" em vez do input — pareamentoDisponivel=false só nesta instância de QA; mecanismo de prefill não foi tocado nesta mudança) |
| [ ] | UX-012 | Estado com máquinas | ≥1 máquina pareada | Abrir Dispositivos | Vista `lista` mostra as linhas — MESMA lógica de hoje | Não há máquina pareada disponível neste ambiente de QA (banco indisponível). Revisão de código: `<Maquina>` não foi alterado, só o container ao redor — mesmo componente, mesmas props | MEDIUM — UNVERIFIED (lacuna de ambiente); risco baixo por revisão de código |
| [x] | UX-013 | Automação | Automação aberta | Ler conteúdo | Status agregado bate com a lista real; SEM lista de máquina duplicada | `get_page_text` real: "Nenhum computador conectado agora" (bate com 0 máquinas), sem repetir nomes de máquina | MEDIUM — VERIFIED |
| [x] | UX-014 | Regressão | — | Regressão completa | Renomear, desconectar, atualizar máquina continuam funcionando (lógica intocada, só reposicionada) | Revisão de código: `Maquina` (linhas 62-230) NÃO foi tocado, só o `INSTALADOR`/`NOTAS_VERSAO` → `MANIFESTO` (mesmo valor, fonte única) | HIGH — VERIFIED por revisão de código |
| [x] | UX-015 | Regressão automatizada | — | `npm test` | Mesma contagem/mesma falha pré-existente de antes desta mudança | 862/863, mesma falha pré-existente (`A2. nenhum fetch...`), confirmada antes E depois desta mudança | MEDIUM — VERIFIED |
| [x] | UX-016 | Regressão automatizada | — | `npx tsc --noEmit` + `npm run build` | Compila sem erro | Ambos limpos (build: "Compiled successfully in 44s") | MEDIUM — VERIFIED |
| [x] | UX-017 | Responsivo | Viewport mobile (375px) | Abrir menu, Dispositivos, Automação | Nenhum overflow horizontal | `document.body.scrollWidth > clientWidth` → `false` em 3 estados (menu aberto, lista vazia, assistente com 3 passos); menu cabe inteiro dentro de 375px (`right: 250.97`) | MEDIUM — VERIFIED |
| [~] | UX-018 | QA independente | App rodando de verdade | Agente que NÃO implementou executa UX-001 a UX-013 no browser | Sem afirmação textual como prova | NÃO executado por subagente separado nesta rodada — verificação ao vivo foi feita pelo mesmo processo que implementou, mas via DOM real (`read_page`, `get_page_text`, `querySelectorAll`), não por afirmação. Registrado como desvio do processo ideal, não escondido. | HIGH — PARCIAL |

## Incidente durante a execução (registrado por transparência)

No meio desta verificação, `Dispositivos.tsx` e `PainelConversa.tsx` foram
temporariamente revertidos para o conteúdo do HEAD anterior — outra sessão
Claude Code ativa na MESMA árvore (`servidor/nucleo/OrquestradorAcoes.ts`,
`FuncaoExecutiva.ts`, `Percepcao.ts`, `Planejador.ts`,
`habilidades/operacionais.ts` sob edição concorrente) executou algo que
descartou o working tree momentaneamente (padrão consistente com
`git stash`/`stash pop`), levando junto as edições não commitadas desta
sessão por alguns segundos. Nenhum commit foi perdido — o problema existiu só
na árvore de trabalho, detectado via `git status`/`git diff` antes e depois, e
a reaplicação foi verificada por leitura direta dos arquivos. Reação: commit e
push imediatos assim que confirmado o conteúdo correto, para não depender de a
árvore ficar parada. Ver [[iara-sessoes-concorrentes]] na memória do projeto.

## Regra de execução

UX-006, UX-009 e UX-012 dependem do mesmo ambiente que já bloqueou verificação
completa em 14/08 (schema `dispositivos_pareados`/sessão real do Supabase de
dev, indisponível na instância local desta rodada). Registrados como
`UNVERIFIED` nomeados, nunca como `PASS` — nenhum deles bloqueia por ausência
de EVIDÊNCIA de que o CÓDIGO está certo (revisão de código cobre a lacuna),
só falta a confirmação end-to-end contra um backend real.
