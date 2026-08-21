# docs/relatorios/

Registros históricos de auditoria e encerramento de fase. **São documentos
congelados**: cada um descreve o que era verdade na data em que foi escrito, e
por isso não são atualizados nem corrigidos.

Documentação viva do sistema fica em `docs/gerado/` (derivada do código) e em
`docs/manual/` (escrita à mão). Estes relatórios servem a outra coisa: mostrar
como o sistema chegou onde chegou, e o que já foi investigado.

## ⚠️ Os caminhos citados aqui dentro são anteriores a 14/08/2026

Os relatórios citam scripts na raiz de `scripts/`. Em 14/08/2026 a pasta foi
reorganizada por finalidade, e os caminhos mudaram. Os relatórios **não foram
reescritos** — corrigir um registro histórico o descaracteriza.

| Caminho citado nos relatórios | Onde o arquivo está hoje |
|---|---|
| `scripts/prova-cognitiva.ts` | `scripts/provas/prova-cognitiva.ts` |
| `scripts/prova-cognitiva-final.ts` | `scripts/provas/prova-cognitiva-final.ts` |
| `scripts/prova-cerebro-encerramento.ts` | `scripts/provas/prova-cerebro-encerramento.ts` |
| `scripts/prova-encerramento-escrita.ts` | `scripts/provas/prova-encerramento-escrita.ts` |
| `scripts/prova-escrita-final.ts` | `scripts/provas/prova-escrita-final.ts` |
| `scripts/sonda-auditoria.ts` | `scripts/diagnostico/sonda-auditoria.ts` |
| `scripts/verificar-glsl.mjs` | `scripts/diagnostico/verificar-glsl.mjs` |
| `scripts/medir-voz.ts` | `scripts/diagnostico/medir-voz.ts` |
| `scripts/vozes.mjs` | `scripts/diagnostico/vozes.mjs` |
| `scripts/gerar-marca.ts` | `scripts/geracao/gerar-marca.ts` |
| `scripts/gerar-icones.ts` | `scripts/geracao/gerar-icones.ts` |

Todos os caminhos são relativos a `iara-os/apps/web/`.

Os débitos técnicos levantados nestes relatórios estão consolidados, em forma
viva, em `docs/manual/15-debitos-tecnicos.md`.
