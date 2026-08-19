# Instrumentos de boot — eles DESPEJAM, não julgam

Dois arquivos, e a distinção com `testes/campanha/` é a razão de eles existirem
separados: **a campanha julga; isto aqui mostra**. Nenhum dos dois tem veredito,
portão ou código de saída significativo. Quem decide se a IARA mentiu é a
campanha, e ela é uma só.

Houve aqui um terceiro arquivo, `conversa.mts`, que julgava — e foi removido no
mesmo dia em que nasceu. Ele duplicava o que a campanha já faz e teria virado uma
segunda autoridade sobre a mesma pergunta, que é exatamente o problema que a
campanha existe para resolver no kernel. O que ele tinha de único — rodar o motor
sob o fuso de produção — virou `npm run campanha -- --tz UTC`.

## `sonda-provedores.mts`

Instancia cada cérebro declarado e faz **uma chamada de verdade**, classificando
o resultado nos degraus que separam "configurado" de "funcional":

```
NAO_DECLARADO → DECLARADO → INSTANCIADO → RESPONDEU → SAIDA_VALIDA
```

Existe porque chave presente já mentiu duas vezes nesta base (15/08 e 18/08/2026).
`HTTP 200` não é saúde, e "o provedor está no `/saude`" não é "o provedor gera
texto".

```bash
node --import tsx testes/boot/sonda-provedores.mts "$PWD"
```

## `diagnostico-rota-cognitiva.mts`

Sobe **um** motor, manda **uma** frase e despeja tudo: a resposta, o stdout do
motor e todo pacote do barramento que mencione falha.

Existe porque `Kernel.mensagemHumanaDeFalha` engole o texto original quando ele
parece técnico — o operador recebe *"não consegui concluir esse pedido agora"* e
a causa fica só na telemetria. Foi assim que se descobriu, em 18/08/2026, que
todo turno cognitivo morria com `groq respondeu 429: ... tokens per minute (TPM):
Limit 8000, Used 7066, Requested 6448`.

```bash
node --import tsx testes/boot/diagnostico-rota-cognitiva.mts \
  --cerebro groq,gemini,openrouter --frase "Quantas cargas existem na base 2026?"
```

**Gastam cota real.** Ambos chamam provedor de verdade — é o ponto deles.
