# Veredito do validador de evidência independente — 15/08/2026

Processo separado do implementador (regra: implementador ≠ verificador).
Método declarado: recomputou o diff contra o baseline `8bd488b`, extraiu e
comparou a PERSONA byte a byte (14.757 chars idênticos), re-executou os 28
testes novos (28/28) e o `tsc` (exit 0) de forma independente, e cruzou as
transcrições E2E com as strings do código real.

## Resultado por grupo

- **UN (18 casos)** — VALID. Todos existem, asserções batem com o plano,
  todos `ok` no log da suíte; contraprova independente 28/28.
- **IT (3 casos)** — VALID. Stub é servidor `node:http` real, não mock.
  Fraqueza registrada (não invalida): em IT-002 a asserção "nenhum pedaço
  após aborto" é infalsificável pelo desenho do stub; o que o teste prova é
  ausência de hang e ausência de retentativa após texto parcial.
- **RG (5 casos)** — VALID. RG-003: patch byte-idêntico ao diff real
  recomputado; payload/cache/retentativa fora dos hunks. RG-002 re-executado
  pelo validador (log de 0 bytes não foi aceito como prova).
- **E2E (4 cenários + lacuna)** — VALID. Frases das transcrições existem no
  código real; stub logou sonda + 2 POST; E2E-004 corretamente PENDENTE.

## VEREDITO FINAL: EVIDÊNCIA APROVADA

Riscos residuais a carregar no relatório: (1) E2E-004 pendente — binário
Ollama real nunca tocado; (2) IT-002 com asserção parcial por desenho;
(3) evidência E2E textual, sem screenshot composto (limitação de sessão
autônoma, declarada); o stub do E2E-002 foi arquivado junto da evidência
após este veredito.
