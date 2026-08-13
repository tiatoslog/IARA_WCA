# SECURITY_REMEDIATIONS

## Aplicadas nesta auditoria

### R1 — idempotência de transporte cobre a repetição CONCORRENTE
`servidor/nucleo/Braco.ts`

Mapa `emVoo: Map<chave, Promise<RelatoExecucao>>` gravado antes do primeiro
`await`. Um pedido idêntico ainda em voo se pendura no desfecho do original e
devolve `duplicada`. Se o original terminar sem relato legível, a repetição
recebe `expirou` — **nunca** um retry cego de operação não idempotente.

### R2 — o portão de coerência recusa todo `sucesso` sem prova
`servidor/nucleo/Braco.ts` (`receber`)

```
!prova.confirmado && motivo !== 'sem_meio_de_verificar'  →  falhou
```

A única prova negada compatível com `sucesso` passa a ser
`sem_meio_de_verificar`, que é o caso legítimo e documentado.

### R3 — chave de idempotência injetiva nos dois lados da ponte
`servidor/nucleo/Braco.ts`, `servidor/braco/principal.ts`

`[id_usuario, acao, JSON.stringify(pares ordenados)].join('\0')`. Alinha as duas
camadas com `Operacao.derivarChaveIdempotencia`, que já fazia assim.

### R4 — fronteira do relato validada campo a campo
`lib/execucao.ts` (`lerRelato`, `ESTADOS_CONHECIDOS`, `CODIGOS_ERRO`)

Vocabulários fechados para `estado`, `codigo_erro`, `motivo` e `onde`; teto de
8000 caracteres no texto e 2000 na evidência; **objeto novo** construído — nada
do socket atravessa por referência.

### R5 — nomes de dispositivo do Windows recusados
`servidor/nucleo/AgenteLocal.ts` (`RESERVADOS_WINDOWS`)

### R6 — teto no corpo da busca web
`servidor/nucleo/BuscaWeb.ts` — leitura por stream com corte em 2 MB.

### R7 — teto no mapa de últimos desfechos
`servidor/nucleo/Braco.ts` — 500 entradas, descarte da mais antiga, chave `\0`.

---

## Recomendadas, NÃO aplicadas

Ordenadas por relação valor/custo. Nenhuma foi implementada nesta auditoria;
implementá-las sem o contexto de quem mantém o sistema criaria mais risco que
resolveria.

### P1 — verificador para `enviar_whatsapp` antes de o token entrar no ambiente
Risco alto, não idempotente, `externo`, **sem `verificar`**. Hoje contida por
três portas e pela ausência de `WHATSAPP_TOKEN`. No dia em que o token entrar,
o melhor estado alcançável é `aceita_pelo_provedor` — que prova enfileiramento,
não entrega. Ver `TOOL_SECURITY_CONTRACT.md`.

### P1 — rodar Stryker sobre `servidor/nucleo/kernel/`
Esta auditoria demonstrou que 641 testes verdes conviviam com cinco defeitos. A
mesma pergunta aplicada ao porteiro, ao `transicionar`, ao `validar`, ao
`PortaoSigilo` e a `papelDe` é barata e responde se aquelas travas têm cobertura
de verdade ou só aparência de cobertura.

### P2 — Fase 20 com braço real
Sete ações de ponte, cada uma com `execucao_id` gravado, prova e estado final.
É o único caminho para tirar `CORE CAPABILITIES: 0/7 exercitadas` do veredito.

### P2 — separar `sucesso` em `sucesso_provado` e `executado_sem_prova`
Torna impossível ler o estado sem ler a prova. Ver OBS-2.

### P2 — `versao` no manifesto de habilidade, carimbada no jornal
Permite responder "qual versão da ferramenta produziu este efeito?".

### P3 — decidir formalmente sobre a Fase 15 (sandbox de SO)
Ou implementar contenção real (Job Object, restricted token, ACL própria no
processo do braço), ou registrar aceitação formal do risco pelo responsável
técnico. Hoje a contenção é allowlist em código — forte, mas não é sandbox, e o
protocolo proíbe chamá-la assim.

### P3 — trocar os bytes NUL literais por `'\0'` no código-fonte
Três arquivos são tratados como binários pelo git e não aparecem em `git diff`.
Uma alteração neles passa despercebida em revisão de PR.

### P3 — alinhar o comentário de `AgenteLocal.Pendencia.id` à realidade
O nonce descrito não está no caminho de autorização. Ver OBS-1.
