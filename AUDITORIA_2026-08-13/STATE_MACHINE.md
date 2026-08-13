# STATE_MACHINE

A IARA tem **duas** máquinas de estados, e a distinção é deliberada.

## 1. Operação (efeito) — `servidor/nucleo/kernel/Operacao.ts`

Persistida no jornal append-only. Responde "este efeito existe no mundo?".

```
planejada ──▶ aguardando_autorizacao ──▶ autorizada ──▶ executando ──┬─▶ executada_nao_verificada ─┬─▶ verificada
    │                   │                     │                       ├─▶ aceita_pelo_provedor ─────┤
    ├──▶ autorizada     ├──▶ cancelada        ├──▶ cancelada          ├─▶ verificada                ├─▶ falhou
    ├──▶ cancelada      └──▶ expirada         └──▶ expirada           ├─▶ falhou                    └─▶ desconhecida
    ├──▶ expirada                                                     └─▶ desconhecida ──▶ verificada | falhou
    └──▶ falhou
```

**As ausências são o conteúdo.** `falhou`, `cancelada` e `expirada` não vão a
lugar nenhum. Nada chega a `verificada` a partir de `planejada`.

Duas regras que a tabela sozinha não impõe, e que `transicionar` impõe:

1. `→ verificada` exige `prova.fonte === 'verificador'`.
2. `→ autorizada` com `risco === 'alto'` exige `prova.fonte === 'operador'`.
   Para risco baixo/médio, `'operador'` ou `'porteiro'`. **Nunca `'llm'` — o tipo
   `FonteEvidencia` não tem esse valor.**

**Conformidade com a Fase 6:**

| Exigência | Cumprida? |
|---|---|
| `UNKNOWN != FAILED` | sim — `desconhecida` é estado próprio e o único que sai por verificação |
| `TIMEOUT != FAILED` | sim — vira `desconhecida`, não `falhou` |
| `DELIVERED != EXECUTED` | sim — na ponte, `enviada_ao_dispositivo` ≠ `recebida_pelo_dispositivo` ≠ `executando` |
| `ACK != SUCCESS` | sim — `aceita_pelo_provedor` é estado próprio, entre `executando` e `verificada` |
| `EXECUTING != SUCCESS` | sim |
| só POST-CONDITION VERIFIED produz SUCCESS | sim, para a *operação* |

## 2. Execução (transporte) — `lib/execucao.ts`

Volátil, por processo. Responde "onde este pedido parou?".

```
recebida ─▶ validando ─┬─▶ dispositivo_ausente                  (não há mãos)
                       ├─▶ duplicada                            (repetição de pacote)
                       ├─▶ [motor] executando ─▶ sucesso|falhou
                       └─▶ enviada_ao_dispositivo
                              └─▶ recebida_pelo_dispositivo
                                     └─▶ executando ─┬─▶ sucesso | falhou
                                                     └─▶ expirou (prazo venceu: NÃO SEI)
```

Terminais: `sucesso`, `falhou`, `expirou`, `cancelada`, `dispositivo_ausente`,
`duplicada`. Incertos: `expirou`. `RETENTAVEL['EXPIROU'] === false` — o sistema
**não** repete sozinho uma execução de desfecho desconhecido.

### O portão de coerência (corrigido nesta auditoria)

Um relato vindo do braço é **conferido**, não aceito:

```
estado === 'sucesso' && !prova.confirmado && motivo !== 'sem_meio_de_verificar'
    → falhou
!ehTerminal(estado)
    → falhou
```

Antes: a primeira regra exigia `motivo === 'divergente'`, deixando passar
`nao_encontrado` e prova negada sem motivo. Ver IARA-002.

### O estado que sobrevive: `sucesso` sem prova

`sucesso` + `confirmado: false` + `sem_meio_de_verificar` **continua legítimo** —
é o aplicativo que traz a janela existente para a frente, e a plataforma sem
`tasklist`. Não é buraco: é a honestidade da camada. Quem lê `estado` sem ler
`prova` reintroduz a mentira; a quinta porta lê. Ver OBS-2.

## Como as duas se encontram

`Habilidade.executar` traduz `relato.estado === 'sucesso'` em `resolveu`.
`GerenciadorHabilidades.executarVerificando` chama `Habilidade.verificar`, que
para as habilidades de ponte devolve a **prova que nasceu no dispositivo**
(`Braco.ultimoDe`) — nunca reconfere o disco do motor, que é o disco errado
quando o motor está na nuvem. O veredito final:

```
verificacao.confirmado                    → 'verificado'
motivo === 'sem_meio_de_verificar'        → 'desconhecido'
qualquer outra coisa                      → 'falhou'
```

É esse veredito, e não `relato.estado`, que decide se a IARA pode dizer "pronto".
