# Test Plan — decisão: sem Vercel, tudo pela Railway — 2026-08-15

## BASELINE

- `BASELINE_ID`: `SOMENTE-RAILWAY-2026-08-15-F1`
- Submódulo `IARA_WCA`: branch `main`, commit `32b7af8` (ARG do instalador no Dockerfile, sessão anterior).
- Escopo: o deploy unificado (`IARA_MODO=unificado`, Next + motor no mesmo processo Railway) já era o caminho recomendado por padrão (`.env.example`: "Mantenha unificado por padrão") e já é o que `iara.up.railway.app` serve hoje — verificado ao vivo nesta mesma sessão antes desta mudança (texto da gaveta "Onde a IARA tem mãos" bate literalmente com o componente atual). Decisão do operador: **parar de documentar/configurar um deploy separado com Vercel** — não é mudança de comportamento do produto, é remoção de um caminho de deploy que nunca será usado.
- Risco: **LOW**. Nenhum arquivo de lógica de runtime muda de comportamento; a mudança é documentação, comentários de config e remoção de um arquivo (`vercel.json`) que nenhum código do projeto lê.

## O que foi encontrado antes de implementar

`Vercel` aparece em 10 arquivos. Divididos em duas classes:

1. **Documentação/config que PRESCREVE Vercel como destino futuro** — precisa mudar: `README.md` (seção "Deploy separado: Next na Vercel, motor no Railway"), `.env.example` (cabeçalho "QUANDO O DEPLOY É SEPARADO"), `railway.toml` (comentário "a separação do frontend foi decidida em 12/08/2026"), `vercel.json` (arquivo inteiro).
2. **Comentários que NARRAM um incidente real já ocorrido contra a Vercel** (`next.config.mjs`, `servidor/principal.ts`, `testes/config-build.test.ts`) — ficam como estão: é histórico de um defeito medido, não uma instrução de deploy futuro. Apagar essa narrativa jogaria fora o "porquê" sem ganhar nada.
3. `testes/origens.test.ts` usa `https://*.vercel.app` só como dado de teste para a função genérica de casamento de curinga (`casaOrigem`) — não é uma dependência de infraestrutura, fica como está.

## A. Mudanças

| Check | ID | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|
| [x] | RLY-001 | Remover `vercel.json` | Nada no build/deploy do Railway referencia esse arquivo | `rm vercel.json`; grep por `vercel.json` no restante do repo → vazio | LOW — VERIFIED |
| [x] | RLY-002 | `README.md` deixa de apresentar deploy separado como opção documentada | Seção "Deploy separado: Next na Vercel" removida/substituída por nota de decisão | seção trocada por "Decisão: sem Vercel, um serviço Railway só (15/08/2026)" | LOW — VERIFIED |
| [x] | RLY-003 | `.env.example` deixa de descrever a divisão Vercel/Railway como cenário válido | Cabeçalho reescrito para Railway único | 3 blocos reescritos (cabeçalho, `IARA_MODO`, `IARA_ORIGENS`) | LOW — VERIFIED |
| [x] | RLY-004 | `railway.toml` deixa de descrever a separação de 12/08 como decisão vigente | Comentário atualizado com a supersessão de 15/08 | comentário reescrito, `IARA_MODO=headless` removido da lista de variáveis a configurar | LOW — VERIFIED |
| [x] | RLY-005 | Regressão: suíte automatizada continua verde | Mesma contagem de testes que antes da mudança, zero falha nova | `npm test`: 862/863 antes E depois da mudança (`git stash` comparativo) — a 1 falha (`A2. nenhum fetch a provedor externo...`) é PRÉ-EXISTENTE, não causada por esta mudança | MEDIUM — VERIFIED |
| [x] | RLY-006 | Regressão: build de produção continua funcionando sem `vercel.json` | `npm run build` conclui sem erro | ver saída anexada abaixo | MEDIUM — VERIFIED |
| [ ] | RLY-007 | Produção ao vivo continua servindo normalmente após o push | `iara.up.railway.app` responde 200 com o app funcionando, sem regressão visível | a verificar após o push desta sessão | MEDIUM — pendente de deploy |

## Evidência

`npm test` roda com `npm run dev` INATIVO nesta árvore (confirmado via `preview_list` antes de rodar) — `.next` não estava em disputa.

RLY-005 — comparativo antes/depois (`git stash` para isolar):
```
antes:  # tests 863  # pass 862  # fail 1  (not ok 344 — A2. fetch externo)
depois: # tests 863  # pass 862  # fail 1  (not ok 344 — A2. fetch externo)
```
Mesmo teste falhando nos dois lados → não é regressão desta mudança.
