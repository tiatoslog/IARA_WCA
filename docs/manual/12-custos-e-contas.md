## Custos e contas

Esta seção só pode ser preenchida por quem tem acesso às faturas e aos painéis.
Nada aqui foi estimado: **a lacuna visível é informação**, e um número inventado
seria pior que nenhum.

### Contas de terceiro

| Serviço | Titular da conta | Login administrativo | Plano | Custo mensal | Renovação |
|---|---|---|---|---|---|
| Anthropic (Claude) | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Supabase | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Railway | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Vercel | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Convai (opcional) | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Meta / WhatsApp Business | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Domínio | *(a preencher)* | *(a preencher)* | — | *(a preencher)* | *(a preencher)* |

### Custo variável

O custo de tokens depende de quanto tráfego escapa das camadas baratas. As
variáveis que o governam estão no código e no ambiente:

| Variável | Efeito no custo |
|---|---|
| `IARA_MODELO` | modelo usado no raciocínio |
| `IARA_ESFORCO` | esforço de raciocínio por turno |
| `CONFIANCA_SUFICIENTE` (`FuncaoExecutiva.ts`) | acima do limiar, o plano sai sem gastar token |

| Métrica | Valor | Período |
|---|---|---|
| Turnos por mês | *(a preencher)* | *(a preencher)* |
| Proporção que sobe para o modelo | *(a preencher)* | *(a preencher)* |
| Custo de tokens no mês | *(a preencher)* | *(a preencher)* |

> Nenhuma dessas linhas deve ser preenchida por estimativa. Elas saem do painel
> da Anthropic e do log do motor.
