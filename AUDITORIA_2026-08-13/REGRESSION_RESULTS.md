# REGRESSION_RESULTS

## Ciclo aplicado a cada defeito

O protocolo (Fase 24) exige
`BUG → REPRODUCTION TEST → FIX → REGRESSION TEST → ADVERSARIAL TEST → FULL SUITE`.
Foi o que foi feito, nesta ordem, para os cinco defeitos com regressão:

| Defeito | Reprodução | Conserto | Regressão | Adversarial | Suíte |
|---|---|---|---|---|---|
| IARA-001 | sonda H2 (executor espião conta 2 chamadas) | `emVoo` antes do 1º await | B1 | B1b (10 em rajada), B1c (pedidos distintos) | 669 ✔ |
| IARA-002 | sonda H3a/H3b (braço dublê) | portão de coerência largo | B2 ×3 | **B2b** (contra-teste) | 669 ✔ |
| IARA-003 | revisão + B3 | `\0` + JSON canônico nos dois lados | B3 | B3b, B3c | 669 ✔ |
| IARA-004 | sonda H4a/b/c | `lerRelato()` campo a campo | B4 ×11 | B4b, B4c, B4d | 669 ✔ |
| IARA-005 | sonda H5 | `RESERVADOS_WINDOWS` | B5 | B5b (contra-teste), B5c | 669 ✔ |

IARA-006 (teto do corpo da busca web) e IARA-007 (teto do mapa `ultimos`) foram
corrigidos **sem regressão automatizada** — o primeiro exigiria um servidor HTTP
no teste, o segundo 500 execuções. Estão marcados como tal no `BUG_REGISTER`.
Isso é declarado, não escondido.

## Resultados

**Baseline (commit `8d057e2`, antes de qualquer alteração):**

```
# tests 641   # suites 0   # pass 641   # fail 0   # duration_ms 39626
tsc --noEmit → 0 erros
```

**Depois dos consertos e da nova suíte:**

```
# tests 669   # pass 669   # fail 0
tsc --noEmit → 0 erros
```

**Prova de que a nova suíte não é decorativa** (consertos removidos por
`git stash`, suíte nova mantida):

```
# tests 28   # pass 13   # fail 15
```

## Nenhum teste foi afrouxado

O protocolo (Fase 27) proíbe contornar, silenciar, remover ou afrouxar um teste
para fazê-lo passar. Verificação:

- **Nenhum** dos 641 testes existentes foi alterado, removido ou marcado como
  `skip`. `git status` mostra cinco arquivos de código modificados e **um**
  arquivo de teste **novo**.
- Nenhum requisito foi diminuído. Onde o conserto poderia ter virado excesso de
  zelo, existe **contra-teste**: B2b garante que `sem_meio_de_verificar` continua
  compatível com `sucesso`; B5b garante que `Contratos` e `Console` continuam
  nomes válidos; B1c garante que a deduplicação é por pedido e não uma trava
  geral.
- Os 641 testes anteriores continuam verdes **com** os consertos, o que
  demonstra que nenhuma correção quebrou um contrato existente.

## Arquivos alterados

```
 M iara-os/apps/web/lib/execucao.ts                 (fronteira do relato + vocabulários fechados)
 M iara-os/apps/web/servidor/nucleo/Braco.ts        (emVoo, coerência, chave \0, teto ultimos)
 M iara-os/apps/web/servidor/nucleo/AgenteLocal.ts  (nomes reservados do Windows)
 M iara-os/apps/web/servidor/braco/principal.ts     (assinatura \0)
 M iara-os/apps/web/servidor/nucleo/BuscaWeb.ts     (teto de corpo)
?? iara-os/apps/web/testes/ponte-execucao-adversarial.test.ts   (28 testes)
```
