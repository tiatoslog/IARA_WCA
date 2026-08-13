# FUZZING_RESULTS

## Escopo real

**Fuzzing por corpus fixo, não property-based.** Nenhuma biblioteca de
propriedades (`fast-check` ou equivalente) foi instalada ou executada. O que
segue é o que de fato rodou.

## Alvo 1 — `lerPacoteBraco`, caso `concluida` (fronteira que executa coisas)

23 entradas. Todas as 11 do primeiro bloco **passavam** antes do conserto
IARA-004 e são recusadas agora.

| Entrada | Antes | Depois |
|---|---|---|
| `texto` com 2 000 000 caracteres | aceito | recusado |
| `estado: 'sucesso!!'` | aceito | recusado |
| `estado: 42` | recusado | recusado |
| `prova.evidencia: {a:1}` | aceito | recusado |
| `prova.evidencia` com 50 000 caracteres | aceito | recusado |
| `prova.motivo: 'porque_sim'` | aceito | recusado |
| `codigo_erro: 'GRANT_ADMIN'` | aceito | recusado |
| `onde: 'nuvem'` | aceito | recusado |
| `dados: 'tudo'` | aceito | recusado |
| `prova` ausente | recusado | recusado |
| `execucao_id: ''` | recusado | recusado |
| campos a mais (`papel`, `id_usuario`) | **atravessavam** | descartados (o relato é cópia) |

## Alvo 2 — pacotes malformados no socket

12 entradas: `''`, `'null'`, `'[]'`, `'"texto"'`, `'{'`,
`{"tipo":"concluida"}`, `relato: null`, `relato: []`, `{"tipo":"__proto__"}`,
apresentação sem campos, `id_usuario` com 500 caracteres, `execucao_id` com 500.

**Resultado**: 12/12 recusadas. Nenhuma exceção, nenhum laço infinito, nenhuma
alocação anômala.

## Alvo 3 — poluição de protótipo

`{"tipo":"concluida","relato":{…,"__proto__":{"invadido":true}}}`
→ `({}).invadido === undefined`. **Repelido.**

## Alvo 4 — `validarNomePasta`

18 entradas: nomes de dispositivo do Windows (`CON`, `PRN`, `AUX`, `NUL`,
`COM1`, `LPT9`, com e sem extensão, em duas caixas), travessia (`..`, `../x`),
separadores (`/`, `\`, `:`), UNC (`\\servidor\share`), ponto isolado,
ponto/espaço final, marca de direção RLO (`a‮b`), solidus fullwidth (`a／b`),
espaço interno.

**Resultado**: todas as perigosas recusadas. Contra-teste com 6 nomes legítimos
que **começam** parecido (`Contratos`, `Console`, `Auxiliar`, `Nulo`, `Com1a`,
`Prensa`) — todos aceitos, para que a correção não vire excesso de zelo.

## Alvo 5 — parâmetros de habilidade (suíte pré-existente, verificada nesta rodada)

`zero-trust-adversarial.test.ts` D3/D4/D5 já cobrem: payload gigante, byte NUL,
controles C0 (`\x00`, `\x07`, `\x1b`, `\x7f`), `NaN`, `Infinity`, e uma tropa de
14 valores inesperados (`null`, `undefined`, `0`, `-1`, `''`, string de 9000,
`'../../etc'`, booleanos, array, objeto). Propriedade verificada: `validar`
**só** falha com `ParametroInvalido`, nunca com outra exceção.

## Critérios da Fase 17

| Critério | Resultado |
|---|---|
| sem crash | **atingido** — nenhuma exceção não capturada |
| sem corrupção de memória | N/A (runtime gerenciado) |
| sem laço infinito | **atingido** |
| sem retry infinito | **atingido** — `RETENTAVEL['EXPIROU'] === false` |
| sem escalação de privilégio | **atingido** nas entradas testadas |
| sem vazamento de dado | **atingido** nas entradas testadas |

## Lacunas declaradas

- **Property-based testing NÃO executado.** Sem geradores, sem shrinking, sem
  invariantes expressos como propriedades.
- **Não fuzzado**: `lerPacoteMotor` (lado do braço), webhook do WhatsApp, corpo
  HTTP das integrações, `PortaWhatsapp`, o parser de `Medicao`
  (`interpretarMedicao`), a reidratação do jornal a partir de linhas corrompidas
  geradas aleatoriamente.
## Alvo 6 — payloads extremos (executado)

| Entrada | `lerPacoteBraco` | `lerPacoteCliente` |
|---|---|---|
| 200 000 níveis de aninhamento (`[[[…]]]`) | `null`, sem exceção | `null`, sem exceção |
| relato com `texto` de 50 MB (JSON de ~50 MB) | `null`, sem exceção | — |

O `RangeError` que o V8 lança em aninhamento profundo é capturado pelo
`try/catch` do `JSON.parse` nos dois leitores. **Verificado por execução**, não
por inspeção.
