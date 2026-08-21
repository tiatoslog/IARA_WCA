# scripts/diagnostico/

**Estes scripts SÓ LEEM.** Nenhum escreve em disco, em banco ou em serviço
externo. Podem rodar a qualquer momento, inclusive contra dado real, sem risco
de alterar nada.

| Script | O que responde |
|---|---|
| `verificar-caminhos.mjs` | toda referência relativa do repositório resolve para um arquivo existente? |
| `verificar-glsl.mjs` | há alguma crase dentro de um bloco GLSL? |
| `sonda-auditoria.ts` | as garantias de segurança do kernel ainda seguram, sob ataque? |
| `medir-voz.ts` | onde é gasto o tempo entre a resposta pronta e o áudio tocando? |
| `vozes.mjs` | quais vozes existem na conta Convai? (lê a rede, não escreve) |

`vozes.mjs` lê `CONVAI_API_KEY` de `.env.local` e **nunca imprime a chave**.

## O que não vai aqui

Qualquer script que crie, altere ou apague arquivo, registro ou recurso remoto —
mesmo que a alteração pareça inofensiva. A promessa desta pasta é justamente que
ela não tem exceção.
