# scripts/provas/

Provas comportamentais ponta a ponta contra o **Kernel real** — não contra
mocks. Cada uma monta o sistema, executa cenários e imprime o que aconteceu.

Escrevem apenas em diretório temporário (`mkdtemp` no `tmpdir` do sistema).
Nenhuma toca `dados/`, banco ou serviço externo.

| Script | O que prova |
|---|---|
| `prova-cognitiva.ts` | o que a IARA faz |
| `prova-cognitiva-final.ts` | o que ela se **recusa** a fazer |
| `prova-cerebro-encerramento.ts` | plano, execução e confirmação sobrevivem a restart |
| `prova-escrita-final.ts` | o caminho de escrita e sua trilha em disco |
| `prova-encerramento-escrita.ts` | a trilha `autorizada → executando → verificada` |

## Provas e testes não são a mesma coisa

`testes/` roda no CI e falha o build. Estas provas **imprimem** um relatório para
uma pessoa ler — servem para auditoria e para responder "prove que funciona", não
para portão automático. Rodar uma delas é o que se faz antes de afirmar num
relatório que uma garantia segura.

```bash
npx tsx scripts/provas/prova-cognitiva-final.ts
```
