# IARA — matriz de capacidades de análise de planilha

> **GERADO POR EXECUÇÃO.** Não editar à mão: rode
> `node --import tsx scripts/matriz-planilha.ts`. Uma matriz mantida a dedo vira
> ficção no primeiro conserto que ninguém anotar.

Cada linha foi **medida** contra o oráculo de `testes/planilha/oraculo.ts` — vinte
cargas cujas respostas foram contadas à mão, nunca derivadas do código sob teste.

## O que esta matriz mede — e o que não mede

Mede o **motor determinístico**: `agregarCargas`, `interpretarPeriodo` e o
contrato de `CargaCompleta`.

**Não mede** se a LLM escolhe a habilidade certa e passa os parâmetros certos.
Motor correto com roteamento errado continua entregando resposta errada ao
operador — foi exatamente o que aconteceu com `agrupar_por` em 18/08/2026. Esse
caminho é medido pelo gate de produto (`testes/gate/produto.mjs`), contra a
interface real. As duas medições são necessárias e nenhuma substitui a outra.

## Resumo

| Estado | Quantidade |
| --- | ---: |
| SUPPORTED_CORRECT | 19 |
| SUPPORTED_PARTIAL | 2 |
| UNSUPPORTED | 14 |
| **Total** | **35** |

## A matriz

| ID | Categoria | Pergunta | Operação | Esperado | Obtido | Estado | Causa |
| --- | --- | --- | --- | --- | --- | --- | --- |
| COUNT-001 | contagem | Quantas cargas temos? | `COUNT` | 12 | 12 | **SUPPORTED_CORRECT** | — |
| COUNT-002 | contagem | Quantas cargas o LINO fez? | `COUNT + FILTER(motorista)` | 5 | 5 | **SUPPORTED_CORRECT** | — |
| COUNT-003 | contagem | Quantas cargas foram finalizadas? | `COUNT + FILTER(status)` | 6 | 6 | **SUPPORTED_CORRECT** | — |
| COUNT-004 | contagem | Quantas cargas foram canceladas? | `COUNT + FILTER(status=CANCELADA)` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| COUNT-005 | contagem | Quantas cargas foram feitas em janeiro? | `COUNT + GROUP_BY(mês)` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| COUNT-006 | contagem | Quantas cargas o cliente X fez? | `COUNT + FILTER(cliente)` | — | — | **UNSUPPORTED** | dados — a informação não está na fonte |
| SUM-001 | agregação | Qual o faturamento total? | `SUM(valor)` | 15000 | 15000 | **SUPPORTED_CORRECT** | — |
| SUM-002 | agregação | Quanto o LAUDIR faturou? | `SUM + FILTER(motorista)` | 7000 | 7000 | **SUPPORTED_CORRECT** | — |
| AVG-001 | agregação | Qual o valor médio por carga? (100, 200 e um sem valor) | `AVG(valor)` | 150 | 150 | **SUPPORTED_CORRECT** | — |
| AVG-002 | agregação | Qual o valor médio quando nenhuma carga tem valor? | `AVG(valor) sobre conjunto sem valores` | ausência declarada | ausência declarada | **SUPPORTED_CORRECT** | — |
| MAX-001 | agregação | Qual foi a maior carga? | `MAX(valor)` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| MIN-001 | agregação | Qual foi a menor carga? | `MIN(valor)` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| GROUP-001 | agrupamento | Quantas cargas por motorista? | `GROUP_BY(motorista)` | 4 | 4 | **SUPPORTED_CORRECT** | — |
| GROUP-002 | agrupamento | Quantas cargas por rota? | `GROUP_BY(rota)` | 4 | 4 | **SUPPORTED_CORRECT** | — |
| GROUP-003 | agrupamento | Quantas cargas por mês? | `GROUP_BY(mês)` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| GROUP-004 | agrupamento | Quantas cargas por estado de destino? | `GROUP_BY(uf_destino)` | — | — | **UNSUPPORTED** | api — o contrato entre camadas não expressa |
| DIST-001 | distinct | Quantas cargas únicas existem? | `COUNT(DISTINCT oci)` | 12 | 12 | **SUPPORTED_CORRECT** | — |
| DIST-001b | distinct | Quantas cargas únicas existem? (conjunto adversarial A,A,B,C,C) | `COUNT(DISTINCT oci)` | 3 | 3 | **SUPPORTED_CORRECT** | — |
| DIST-001c | distinct | Quantas linhas repetidas existem? | `DUPLICATE_DETECTION` | 2 | 2 | **SUPPORTED_CORRECT** | — |
| DIST-002 | distinct | Quantos motoristas diferentes temos? | `COUNT(DISTINCT motorista)` | 3 | 3 | **SUPPORTED_CORRECT** | — |
| DIST-002b | distinct | Quantas cargas estão sem motorista? | `COUNT(ausência)` | 1 | 1 | **SUPPORTED_CORRECT** | — |
| DIST-002c | distinct | Ausência é só célula vazia — "N/A" e "-" são nomes, não ausência | `COUNT(DISTINCT) + definição de ausência` | 3 | 3 | **SUPPORTED_CORRECT** | — |
| DATE-001 | datas | …hoje | `DATE_RANGE` | entende | entende | **SUPPORTED_CORRECT** | — |
| DATE-002 | datas | …essa semana | `DATE_RANGE` | entende | entende | **SUPPORTED_CORRECT** | — |
| DATE-003 | datas | …em janeiro | `DATE_RANGE(mês nomeado)` | — | — | **UNSUPPORTED** | interpretador — a expressão não é entendida |
| DATE-004 | datas | …no primeiro trimestre | `DATE_RANGE(trimestre)` | — | — | **UNSUPPORTED** | interpretador — a expressão não é entendida |
| DATE-005 | datas | …nos últimos 30 dias | `DATE_RANGE(janela móvel)` | — | — | **UNSUPPORTED** | interpretador — a expressão não é entendida |
| DATE-006 | datas | …entre 01/01 e 31/03 | `DATE_RANGE(intervalo explícito)` | — | entende | **SUPPORTED_PARTIAL** | interpretador — a expressão não é entendida |
| DATE-007 | datas | …ano passado | `DATE_RANGE(ano relativo)` | — | — | **UNSUPPORTED** | interpretador — a expressão não é entendida |
| CMP-001 | comparação | Tivemos mais cargas em 2025 ou 2026? | `COMPARE(ano)` | — | — | **UNSUPPORTED** | dados — a informação não está na fonte |
| CMP-002 | comparação | Qual o crescimento percentual? | `PERCENTAGE / GROWTH` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| PCT-001 | participação | Quanto o LINO representa do total? | `SHARE` | 41.67 | 41.67 | **SUPPORTED_PARTIAL** | executor — o motor não sabe calcular |
| QUAL-001 | qualidade | Existem cargas sem motorista? | `COUNT(campo vazio)` | 1 | 1 | **SUPPORTED_CORRECT** | — |
| QUAL-002 | qualidade | Existem cargas sem valor? | `COUNT(valor nulo)` | — | — | **UNSUPPORTED** | executor — o motor não sabe calcular |
| QUAL-003 | qualidade | Existem cargas duplicadas? | `DUPLICATE_DETECTION` | não | não | **SUPPORTED_CORRECT** | — |

## Lacunas por causa técnica

### executor — o motor não sabe calcular

- COUNT-004 — Quantas cargas foram canceladas? *(CANCELADA cai em DESCONHECIDO; não há estado de cancelamento no normalizador)*
- COUNT-005 — Quantas cargas foram feitas em janeiro? *(data_coleta existe em toda carga; o agrupamento por mês nunca foi escrito)*
- MAX-001 — Qual foi a maior carga? *(GrupoAgregado carrega apenas contagem e valor_total)*
- MIN-001 — Qual foi a menor carga?
- GROUP-003 — Quantas cargas por mês?
- CMP-002 — Qual o crescimento percentual?
- PCT-001 — Quanto o LINO representa do total? *(derivável de dois números que já existem; não há métrica de participação)*
- QUAL-002 — Existem cargas sem valor? *(valor nulo soma como zero e não é contado em lugar nenhum)*

### dados — a informação não está na fonte

- COUNT-006 — Quantas cargas o cliente X fez? *(não há coluna de cliente na planilha nem campo em CargaCompleta)*
- CMP-001 — Tivemos mais cargas em 2025 ou 2026? *(a leitura alcança só a aba 2026; comparar anos exige o mapa de colunas das antigas)*

### api — o contrato entre camadas não expressa

- GROUP-004 — Quantas cargas por estado de destino? *(uf_destino existe em CargaCompleta e não está entre os agrupamentos aceitos)*

### interpretador — a expressão não é entendida

- DATE-003 — …em janeiro
- DATE-004 — …no primeiro trimestre
- DATE-005 — …nos últimos 30 dias
- DATE-006 — …entre 01/01 e 31/03
- DATE-007 — …ano passado *(e mesmo que entendesse, 2025 está fora do alcance da leitura — ver ANO_VIVO)*

## Vocabulário real

**Entidades que existem** em `CargaCompleta`: `oci`, `origem`, `uf_origem`,
`destino`, `uf_destino`, `motorista`, `data_rec_oci`, `data_coleta`,
`data_descarga`, `status`, `status_normalizado`, `valor`.

**Entidade que NÃO existe:** `cliente`. Não há coluna de cliente na planilha —
toda a família "por cliente" é lacuna de **dados**, não de código, e implementar
agrupamento não a resolveria.

**Operações que existem:** `COUNT`, `SUM`, `GROUP_BY` (seis dimensões),
`FILTER` por período, `SORT` (na habilidade, não no motor).

**Operações NÃO IMPLEMENTADAS:** `AVG` nativa (hoje derivada de total/contagem),
`MIN`, `MAX`, `DISTINCT`, `COMPARE` entre anos, `PERCENTAGE`, detecção de
duplicidade, agrupamento por mês/ano/UF.
