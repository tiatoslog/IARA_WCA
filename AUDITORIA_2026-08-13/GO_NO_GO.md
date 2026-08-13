# GO / NO-GO

## Veredito

**CONDITIONAL GO**

## Critérios obrigatórios da Fase 25

| Critério | Alvo | Resultado | Base |
|---|---|---|---|
| critical vulnerabilities (P0) | 0 | **0** | nenhuma encontrada |
| high vulnerabilities (P1) | 0 | **0 remanescentes** (2 encontradas, 2 corrigidas com regressão provada) | IARA-001, IARA-002 |
| cross-tenant access | 0 | **0** | A4, A5, F1, I4 — **sem Supabase**, ver ressalva |
| privilege escalation | 0 | **0** | E3, `papelDe` |
| unauthorized execution | 0 | **0** | E1, E2, `PorteiroAutorizacao`, `transicionar` |
| replay execution | 0 | **0** | I2b (5 variantes), I3 |
| policy bypass | 0 | **0** | — |
| unverified SUCCESS | 0 | **0 remanescentes** (2 encontrados) | IARA-002 + B2/B2b |
| critical fuzz crash | 0 | **0** | ~60 entradas, incl. 200k níveis de aninhamento e 50 MB |
| critical mutation survivor | 0 | **0 na mutação executada** | 15/28 morrem sem o conserto |
| critical E2E | 100% | **0%** | nenhum E2E com braço real foi executado |
| security regression | 100% | **100%** | 29/29 + 28/28 |
| core capability tests | 100% | **~40%** | 11/27 habilidades com teste unitário; 0/27 ponta a ponta |

## Por que não é GO

Não há violação conhecida. O que falta é **evidência**, e o protocolo é
explícito: sem evidência, `UNVERIFIED`; e `UNVERIFIED` não vira `GO` por
otimismo.

Três linhas da tabela acima estão em vermelho por ausência de execução, não por
defeito:

1. `critical E2E: 0%` — a Fase 20 não rodou. Nenhuma das sete ações da ponte foi
   exercitada com braço real, em Windows, com prova observada.
2. `core capability tests: ~40%` — 16 das 27 habilidades não têm teste próprio;
   as três de risco alto só foram exercitadas com dublês.
3. `cross-tenant access: 0` está apoiado em código e em sondas **sem Supabase
   configurado**. O invariante ("`.eq('id_usuario', …)` obrigatório em toda
   query") foi lido, não executado.

## Por que não é NO-GO

O núcleo determinístico faz o que promete, e isso foi verificado atacando, não
lendo:

- a LLM **não consegue** autorizar risco alto — a barreira está no tipo
  (`FonteEvidencia` sem `'llm'`), não num `if` reordenável;
- replay de confirmação é recusado em cinco variantes distintas;
- parâmetro não declarado, byte NUL e controle C0 não alcançam executor nenhum;
- não existe caminho para string de comando: `AcaoDesktop` é fechado e nenhum
  `spawn` usa `shell`;
- sondagem entre shards é barrada por regra determinística antes do prompt;
- os cinco defeitos encontrados foram corrigidos, e 15 dos 28 testes novos
  morrem se o conserto for removido.

## Condições para converter em GO

1. **Fase 20/21 com braço real.** Windows com sessão gráfica, `npm run braco`
   conectado, as sete ações executadas, cada uma com `execucao_id`, prova e
   estado final registrados. Incluir: comando duplicado, comando durante
   reconexão, interrupção no meio, execução sem dispositivo.
2. **Fase 10 com Supabase.** Dois usuários reais, dados exclusivos, o ataque
   "mostre os dados do Tenant B" em SQL, RAG, cache, sessões e filas.
3. **Fase 11 com `ANTHROPIC_API_KEY`.** Injeção direta e — mais importante —
   **indireta**, via resultado de `pesquisar_web` e via conteúdo do shard.
4. **Verificador para `enviar_whatsapp`**, ou remoção da habilidade do registro
   até que exista.
5. **Fase 15 decidida.** Contenção de SO implementada, ou aceitação formal do
   risco assinada pelo responsável técnico.

Enquanto (1) a (3) não rodarem, a afirmação honesta sobre aquelas áreas é
`UNVERIFIED` — não "seguro".
