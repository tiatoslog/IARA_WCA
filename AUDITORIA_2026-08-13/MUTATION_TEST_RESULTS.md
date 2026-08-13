# MUTATION_TEST_RESULTS

## O que foi feito, com precisão

**Mutation testing sistemático (Stryker ou equivalente) NÃO foi executado.**

O que foi executado é a forma mais honesta e mais barata da mesma pergunta: os
cinco consertos desta auditoria foram **removidos da árvore** (`git stash`) e a
nova suíte rodou contra o código original. Cada conserto é, por construção, a
"mutação" que a suíte precisa matar.

```
git stash push -- lib/execucao.ts servidor/nucleo/Braco.ts \
                  servidor/nucleo/AgenteLocal.ts servidor/braco/principal.ts \
                  servidor/nucleo/BuscaWeb.ts
node --test testes/ponte-execucao-adversarial.test.ts
```

## Resultado

```
# tests 28   # pass 13   # fail 15
```

**15 dos 28 testes morrem sem o conserto.** Os 13 que sobrevivem são os
contra-testes e as guardas de comportamento já correto — eles existem para
impedir que o conserto vire excesso de zelo, e é certo que passem nas duas
versões.

| Teste | Sem conserto | Papel |
|---|---|---|
| B1, B1b | **falha** | mata IARA-001 |
| B1c | passa | contra-teste: dedup é por pedido, não trava geral |
| B2 (nao_encontrado), B2 (sem motivo) | **falha** | mata IARA-002 |
| B2 (divergente) | passa | já era coberto pela condição antiga |
| B2b | passa | **contra-teste**: `sem_meio_de_verificar` continua sucesso |
| B3 | **falha** | mata IARA-003 |
| B3b, B3c | passa | guardas de identidade da chave |
| B4 × 9 desvios | **falha** | mata IARA-004 |
| B4 (relato bem formado), B4 (estado não-texto), B4 (prova ausente), B4 (id vazio) | passa | o leitor antigo já cobria |
| B4b | **falha** | mata IARA-004 (campo a mais atravessava) |
| B4c, B4d | passa | corpus de lixo e protótipo já eram cobertos |
| B5 | **falha** | mata IARA-005 |
| B5b, B5c | passa | contra-teste e guarda de travessia |

## O veredito da Fase 19

> *Se uma mutação crítica sobreviver: SECURITY TEST COVERAGE INSUFFICIENT.*

**Aplicado ao estado ANTERIOR à auditoria, o veredito é exatamente esse.** As
cinco mutações que eu injetei — que são o código como ele estava — sobreviveram
inteiras aos 641 testes existentes. A cobertura de segurança da ponte de
execução era insuficiente, e é essa a conclusão mais importante deste documento.

Aplicado ao estado atual: as cinco mutações morrem.

## O que continua sem cobertura de mutação

Nenhuma mutação foi injetada deliberadamente em:

- `PorteiroAutorizacao.avaliar` (inverter a comparação de origem)
- `Operacao.transicionar` (remover a exigência de fonte `operador`)
- `validar` (trocar `Object.hasOwn` por `in`)
- `PortaoSigilo.ehSondagem` (inverter o `&&`)
- `papelDe` (inverter a ordem restrição/concessão)
- `RegistroOperacoes.autorizar` (remover uma das sete portas)
- as transições da tabela de estados

A suíte existente **parece** cobrir todas essas (A–G do
`zero-trust-adversarial.test.ts`), mas *parecer* não é evidência — e esta
auditoria acabou de demonstrar que uma suíte verde pode conviver com cinco
defeitos. **Rodar Stryker sobre `servidor/nucleo/kernel/` é a próxima coisa a
fazer, e é barata.**
