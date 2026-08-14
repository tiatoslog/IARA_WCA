# Padrão de habilidade analítica — checklist obrigatório

Referência viva: `consultar_estatisticas_cargas_luft` (`servidor/nucleo/kernel/habilidades/cargasLuft.ts` +
`servidor/nucleo/ClientePlanilhaOcis.ts`), fechada em 14/08/2026 depois da revisão adversarial que
encontrou os 5 problemas abaixo. Este documento existe para que a PRÓXIMA habilidade que ler uma fonte
de dados externa (outra planilha, outro sistema, outro relatório) não precise levar o mesmo susto duas
vezes.

Toda habilidade analítica nova — antes de ser considerada pronta — precisa responder "sim" às 8
perguntas abaixo, com evidência, não com a leitura do próprio código.

## 1. O universo tem nome e definição escrita?

Se existe mais de uma função que lê a mesma fonte (`cargasNoPeriodo` vs `todasAsCargas`), a diferença
entre elas precisa estar documentada em UMA frase, no código, não na cabeça de quem escreveu. Aqui:
"cadastrada" (`todasAsCargas`) e "coletada" (`cargasNoPeriodo`) são estados diferentes, e confundir os
dois produz dois números de "total" que discordam sem nenhum dos dois estar errado.

**Teste de fumaça:** peça para alguém que não escreveu o código explicar a diferença entre as funções
lendo só os comentários. Se não conseguir, a doc está incompleta.

## 2. Todo campo com mais de uma grafia tem uma normalização, sem apagar o original?

Texto de célula é digitado por gente. `FINALIZADO`/`finalizado`/`FINALIZADA` são o mesmo fato com três
fantasias. A regra:

- `campo_normalizado` é um valor NOVO, calculado — nunca substitui `campo` bruto.
- Todo código não reconhecido cai num valor explícito tipo `DESCONHECIDO` — nunca no valor mais parecido
  por adivinhação. Achar `"7"` no meio de `FINALIZADO`/`PAGO` e supor que também significa "finalizado"
  seria inventar um fato que ninguém verificou.
- O mapa de normalização é uma lista FECHADA e comentada (`MAPA_STATUS` em `ClientePlanilhaOcis.ts`) —
  nunca um `.includes('final')` heurístico que aceita qualquer coisa parecida.

## 3. O universo muda com o tempo — e os testes sabem disso?

Se a fonte é uma planilha viva (alguém edita todo dia), **nenhum teste pode travar um total geral como
constante para sempre**. "Quantas cargas existem cadastradas HOJE" muda a cada linha nova; não é
regressão quando esse número muda — é o comportamento correto. O que se trava:

- Números de um **período fechado no passado** (um dia específico já encerrado) — esses não mudam
  retroativamente e podem virar constante de teste para sempre (`QA-001..012`).
- A **conta em cima de um fixture congelado** (arquivo de dado real capturado uma vez, versionado em
  `testes/fixtures/`) — o número trava porque o universo está fechado, não porque foi decorado
  (`STAT-001..006`).
- **Nunca** a leitura ao vivo contra a fonte real como assertion de CI. Isso é para verificação manual
  pontual (rodar contra o tenant, ver o número, jogar fora), não para o pipeline automatizado.

Se dois números "corretos" aparecerem em momentos diferentes (ex.: 2629 depois 2642), a primeira
pergunta é "o universo cresceu entre as duas leituras?" — nunca "o código quebrou?" por padrão. Prove
uma das duas, não assuma.

## 4. Falha nunca finge sucesso com dado velho — e diz a idade do que tem

Cache é ótimo para custo, péssimo se vira mentira. Duas regras, as duas obrigatórias:

- Sucesso a partir do cache é `ok: true`, mas quem recebe o resultado sabe que veio do cache (`fonte.cache`)
  e a idade dele (`fonte.idade_s`) — nunca um "dado atual" sem essa informação disponível.
- Falha na fonte com um cache velho disponível continua sendo `ok: false`. A mensagem PODE mencionar a
  idade do último dado válido ("de 4min atrás") para dar contexto — mas não entrega o número como
  resposta. Quem perguntou "quantas cargas temos" quer um número em que pode confiar AGORA, não um
  número de minutos atrás sem aviso.

## 5. Todo parâmetro fechado é validado pelo ESQUEMA, não pelo código do executor

Se um parâmetro só aceita um conjunto conhecido de valores (`agrupar_por`, `metrica`), declare `dentre`
no esquema da `Habilidade`. A validação (`validar()` em `Habilidade.ts`) recusa o valor ANTES de
`executar` rodar — o executor nunca precisa (nem deve) reimplementar essa checagem. Teste isso chamando
`validar()` diretamente com um valor fora da lista, não só testando o caminho feliz.

## 6. Toda pergunta temporal recebe a FRASE, não uma data já calculada

Mesma lei de `Quando.ts` e `PeriodoOperacional.ts`: o parâmetro de período é texto livre ("essa semana",
"17/08"), e um módulo PURO e determinístico — sem I/O — interpreta. A LLM nunca resolve fuso, nunca
resolve "semana começa quando", nunca resolve ano ausente. Ambíguo ou inválido devolve `null`, e a
habilidade transforma isso em pergunta ao operador — nunca num palpite silencioso.

## 7. `detalhe` carrega proveniência, mas continua sendo UMA LINHA

`ResultadoHabilidade.detalhe` é contratualmente "uma linha para o console técnico, nunca payload cru"
(`Habilidade.ts`). Proveniência (operação, universo, quantos registros, cache, confiança) cabe em pares
`chave=valor` numa linha densa (ver `proveniencia()` em `cargasLuft.ts`) — não em JSON aninhado. Quem
precisar de mais do que isso audita o jornal de operações, que é onde payload de verdade mora.

## 8. Todo achado de qualidade de dado vira teste, não vira só comentário

Uma inconsistência real encontrada no dado (grafia dupla de status, código sem significado conhecido)
prova que existe e nunca mais regride: `STAT-NEG-005` prova que `"7"` não vira `FINALIZADO`. Achar o
problema sem travar um teste nele é o mesmo problema voltando em silêncio dali a três meses — a mesma
lição do incidente que criou `Configuracao.ts`.

---

Nenhuma habilidade nova entra no catálogo lendo uma fonte externa sem passar pelas 8 perguntas acima.
Se a resposta para alguma for "ainda não pensei nisso", a habilidade não está pronta — está com a
primeira metade feita.
