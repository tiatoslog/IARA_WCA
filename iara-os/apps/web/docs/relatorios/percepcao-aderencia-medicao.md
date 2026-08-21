# Aderência — texto observado × `ParadaEsperada`

Relatório congelado. Terceiro da série, depois de `percepcao-p0-medicao.md` e
`percepcao-produto-medicao.md`. 21/08/2026. Reproduzir com:

```bash
npx tsx scripts/diagnostico/calibrar-aderencia.ts
```

---

## 1. O que esta camada fecha

Até aqui a percepção dizia **"a tela mudou"**. Duas perguntas ficavam abertas:

- **contexto** — mudou para quê? A tela tem alguma coisa a ver com a etapa?
- **desvio** — a pessoa saiu do procedimento?

As duas metades já existiam e nunca tinham se encostado: `descreverParada`
produz o que se ESPERA ver (verbatim do POP) e o OCR produz o que se VÊ.
`lib/aderencia.ts` é a junção.

## 2. Como a comparação decide

Termos identificadores da parada: as **marcas** do POP (os rótulos das setas —
sinal mais forte, porque são o que o autor escolheu apontar), o título da etapa e
o texto do slide. Fora: ligações, números puros, palavras com menos de 4 letras
(as siglas do domínio entram pelas marcas, que não passam por esse filtro).

Medida: `termos vistos / termos esperados`. É uma **contagem**, não uma
confiança — conferível olhando as duas listas, e não desempata afirmação
nenhuma. Tudo que sai daqui é `inferencia` em `Verdade.ts`.

**Duas comparações, não uma:** contra a parada atual E contra a próxima. Com uma
só, "não é a tela da etapa 3" cobriria tanto quem avançou para a 4 quanto quem
abriu o e-mail — e essas duas situações pedem respostas opostas.

## 3. Calibração

9 POPs conduzíveis, 62 paradas com termos. A tela é simulada a partir do texto do
POP: 60% das palavras sobrevivem, mais cromo de janela (menu, usuário, rodapé).

| Distribuição | n | p05 | p50 | p95 | média |
|---|---|---|---|---|---|
| **SINAL** (a própria parada) | 62 | 0,20 | 0,57 | 0,73 | 0,54 |
| **VIZINHA** (a parada seguinte) | 54 | 0,00 | 0,17 | 0,53 | 0,19 |
| **ALHEIA** (parada de outro POP) | 62 | 0,00 | 0,04 | 0,20 | 0,06 |

**As caudas se tocam em 0,20.** Não existe limiar que separe as distribuições
inteiras — e o critério que a calibração dos POPs usa ("onde não há
sobreposição") pediria aqui um número que não existe.

### A varredura, que decidiu por custo de erro

| limiar | na_etapa | desvio falso | tela alheia reconhecida |
|---|---|---|---|
| 0,15 | 92% | 0% | 11% |
| 0,20 | 90% | 3% | 10% |
| **0,25** | **87%** | **6%** | **3%** |
| 0,30 | 84% | 10% | 3% |
| 0,40 | 81% | 13% | 2% |
| 0,50 | 66% | 27% | 0% |

`PROPORCAO_MINIMA = 0,25` — o joelho, e o mínimo da soma dos dois erros. É onde
o reconhecimento falso de uma tela de OUTRO procedimento cai de 10% para 3%.
Acima disso paga-se falso desvio sem comprar nada: 0,30 e 0,34 têm o mesmo 3% de
tela alheia e quase o dobro de "essa não é a sua tela" dito a quem estava na tela
certa.

**Os dois erros não custam igual**, e a escolha reflete isso. Dizer "essa tela
não é a desta etapa" a quem está na tela certa ensina o operador a ignorar a
IARA. Deixar de reconhecer custa uma frase a menos.

### Um erro meu, registrado

A primeira rodada tirava o ruído do texto da parada **alheia** — a mesma contra a
qual a comparação era medida depois. Isso inflava a aderência alheia por
construção (`p95=0,50`), e a medição saía com as distribuições sobrepostas por
culpa do medidor. Corrigido para cromo de janela genérico.

## 4. O que sai disso

Quatro leituras, e nenhuma é "etapa concluída":

| Leitura | Quando | O que a IARA diz |
|---|---|---|
| `na_etapa` | a tela bate com a parada atual | "você está na tela desta etapa" |
| `resultado_observado` | a tela bate com a PRÓXIMA | "sugere que a ação surtiu efeito — **e não conclui a etapa**" |
| `fora_do_percurso` | nenhuma das duas | "não corresponde — **não vou supor o que aconteceu**" |
| `indefinida` | texto curto, empate, nada reconhecido | **silêncio** |

## 5. As duas travas

1. **`resultado_observado` ≠ `etapa_concluida`.** A tela já é a da próxima
   parada e a etapa continua sem ser dada por feita — a pessoa pode ter chegado
   por outro caminho, ou um colega pode ter aberto a tela. Provado em `A9`: o
   ponteiro não anda, a evidência continua `nenhuma`, não há conferência.
2. **Aderência não é conferência.** Se virasse `ConferenciaDaParada`, o guardião
   a aceitaria como evidência `anexada` e a observação passaria a andar com o
   procedimento sozinha. Provado em `A10` (varredura de código, ignorando
   comentários) e `A11` (o veredito do guardião não muda em nenhuma direção —
   nem autoriza, nem bloqueia).

## 6. O que continua não medido

- **O GW real.** O texto do POP é proxy da tela, e proxy **otimista**: ele foi
  escrito olhando para ela. Numa tela real a proporção tende a cair, e o
  `PROPORCAO_MINIMA` precisa ser remedido contra o GW antes de qualquer
  afirmação sobre acerto em produção.
- **A qualidade do OCR sobre a tela do GW.** Medimos o OCR sobre Chrome e
  WhatsApp; um ERP com fonte pequena e muita tabela é outro regime.
- **Telas do mesmo POP muito parecidas.** A distribuição VIZINHA tem `p95=0,53`,
  perto do SINAL — a margem de 0,10 manda o empate para `indefinida`, mas o
  quanto isso acontece no GW é desconhecido.
