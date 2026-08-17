# Test plan — bateria `isolamento_cruzado`

Bateria crítica e obrigatória em `testes/validacao/registro.ts`, hoje (antes
deste plano) com `harness: null`. Pergunta declarada: *"memória, RAG, arquivo,
token e log de um alcançam o outro?"*, eixos declarados como não testados:
*sessão, processo e máquina* (isolamento por shard já é testado na suíte —
`testes/memoria-concorrente.test.ts`, só que entre dois CANAIS do MESMO
operador, nunca entre dois operadores).

## Escopo real deste harness — e o que fica de fora, por quê

Investigação antes de escrever teste (regra da Fase 1): dos cinco recursos
citados na pergunta da bateria —

| recurso | é compartilhado entre operadores no processo? | entra neste harness |
|---|---|---|
| memória (`MemoriaOperacional`) | sim — singleton, cache por chave de shard, arquivo em disco | **sim** |
| jornal/log (`RegistroOperacoes`) | sim — arquivo `.jsonl` por operador, lido por reidratação | **sim** |
| RAG (`RagHistorico`) | não — é a base de assinaturas de ERRO TÉCNICO, deliberadamente global (ver comentário do próprio arquivo); não tem escopo por `id_usuario` porque não é dado de operador | fora — não há isolamento a violar |
| "arquivo" (memória de fatos/trabalho) | não — `MemoriaFatos`/`MemoriaTrabalho` não referenciam `id_usuario`; são objetos por instância de `Kernel`, não singleton de disco compartilhado | fora — sem vetor de vazamento demonstrado |
| token (sessão/pareamento) | possivelmente, mas é outro subsistema (`Autenticacao.ts`, `Pareamento.ts`) com contrato próprio | fora deste harness — gap residual declarado abaixo |

Dos três eixos de concorrência citados —

- **operador** (id_usuario diferente): coberto por este harness, nos dois
  recursos acima, sob concorrência intra-processo E interprocesso real.
- **processo**: coberto — os cenários P* abaixo usam `child_process.spawn`
  real (dois processos Node distintos), não `Promise.all` no mesmo processo.
  É o eixo que o registro aponta como o mais claramente ausente.
- **sessão**: NÃO duplicado aqui — já tem harness próprio em
  `testes/cross-talk-espelhos.test.ts` e `testes/espelhos.test.ts` (duas
  sessões do MESMO operador). Cruzar sessão × operador diferente ao mesmo
  tempo seria redundante com os dois harnesses combinados.
- **máquina**: **gap residual, não fechado por este harness.** Não é
  automatizável em CI de uma máquina só. Fica declarado aqui, não escondido —
  a mesma disciplina que `docs/prd/test-plan-cross-talk-espelhos.md` já usa
  para o que o ambiente de teste não alcança.

## Casos

| Check | ID | Categoria | Pré-condição | Ação | Resultado esperado | Evidência | Risco |
|---|---|---|---|---|---|---|---|
| [x] | OP-01 | memória · operador | dois shards vazios (`operador-a`, `operador-b`) | escritas intercaladas nos dois shards, mesmo processo, `Promise.all` | shard A só tem registros de A; shard B só tem registros de B; zero perda | asserção no conteúdo dos dois arquivos | vazamento de conversa entre operadores |
| [x] | OP-02 | memória · operador · processo | idem | 2 processos Node reais, cada um escrevendo só no shard do seu operador, ao mesmo tempo | mesma garantia de OP-01, agora sob concorrência real de SO | asserção pós-`spawn` + código de saída dos processos | corrida entre processos corrompe/mistura shard |
| [x] | OP-03 | memória · operador | idem | processo do operador A tenta ler o shard de B usando o próprio `idSeguro`/API pública | a API não expõe leitura cruzada — não existe método que aceite dois ids | teste estático + tentativa em runtime | leitura cruzada teoricamente possível por API |
| [x] | JR-01 | jornal · operador | jornal vazio para A e B | operações concorrentes (`Promise.all`) reservando/marcando no jornal de A e de B ao mesmo tempo, mesmo processo | `lerJornal(raiz, 'a')` só retorna linhas de A; idem para B | asserção no conteúdo lido de cada jornal | mistura de linha de operador diferente no mesmo arquivo |
| [x] | JR-02 | jornal · operador · processo | idem | 2 processos Node reais, cada um gravando no jornal do seu operador simultaneamente | mesma garantia de JR-01 sob processo real | asserção pós-`spawn` | condição de corrida entre processos grava no arquivo errado |
| [x] | JR-03 | jornal · operador | jornal de A com uma linha forjada citando `id_usuario: 'b'` | `lerJornal(raiz, 'b')` | a linha forjada dentro do arquivo de A nunca aparece como linha de B (isolamento é por ARQUIVO, não por confiar no campo interno) | asserção de que a leitura de B não inclui a linha plantada em A | um jornal comprometido consegue "aparecer" como de outro operador |

## Gap declarado, não fechado por este harness

- **Eixo máquina** (duas instâncias do motor em hosts diferentes contra o
  mesmo `dados/`): sem harness — não automatizável nesta suíte. Consistente
  com o achado já registrado da auditoria de 17/08: `MemoriaOperacional`
  admite no próprio comentário que dois PROCESSOS (quanto mais duas máquinas)
  podem perder atualização um do outro no modo arquivo; o modo Supabase é o
  único que resolve esse eixo, e não é exercitado aqui.
- **Eixo token/credencial de sessão**: fora de escopo deste harness — pertence
  a `Autenticacao.ts`/`Pareamento.ts`, subsistema com contrato próprio.
