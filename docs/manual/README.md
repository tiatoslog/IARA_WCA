# docs/manual/

As seções da documentação **escritas por quem conhece a operação**. É a metade
que o repositório não sabe deduzir: por que o sistema existe, quem responde por
ele, o que dá errado às três da manhã.

Os arquivos são numerados porque a ordem é a ordem do documento final. O roteiro
está em `scripts/docs/gerar-documentacao.mjs`, na constante `ROTEIRO` — para
acrescentar uma seção, crie o arquivo e registre-o lá.

## O que não vai aqui

Qualquer coisa que dê para derivar do repositório: lista de dependências, nome
de variável de ambiente, tabela do banco, catálogo de habilidades, comandos.
Isso é responsabilidade de `scripts/docs/derivar.mjs`, e escrever à mão
significa que a informação vai envelhecer em silêncio.

## A regra das lacunas

O que só a empresa sabe — custo, titularidade de conta, nome de responsável —
fica como tabela marcada *(a preencher)*. **Não inventar, não estimar, não
omitir a lacuna.** A lacuna visível é informação: ela diz exatamente o que falta
para a transferência estar completa.

Uma seção listada no roteiro e ausente do disco vira aviso na geração, não erro.
