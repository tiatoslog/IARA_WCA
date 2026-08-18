## Débitos técnicos

Registrados nas auditorias do projeto (ver `docs/relatorios/`). Documentação que
só elogia o sistema não serve para transferir responsabilidade.

| ID | Sev. | Débito | Impacto hoje | Próximo passo |
|---|---|---|---|---|
| D-1 | P1 | `Verdade.ts` é vocabulário sem consumidor em produção. Só o tipo `EstadoExecucao` chega ao código vivo. | A política de conflito de memória está correta e **não é aplicada**. A IARA não consegue representar "fonte A diz 16h, fonte B diz 17h", e o Kernel escreve as ressalvas à mão. | Tipar `Afirmacao` na `MemoriaOperacional` e frasear por `VERBO_DO_ESTADO`. |
| D-2 | P2 | `enviar_whatsapp` (risco alto) é inalcançável: não há receita determinística e plano emergente é barrado. | Inofensivo hoje (sem token, e `externo` não é concedido a `operador`). Quando o token entrar, a habilidade não funcionará. | Receita determinística com âncora de envio e ciclo de confirmação. **Não ligar o token antes disso.** |
| D-3 | P2 | A percepção não distingue o que o operador **pede** do que ele **cola**. Texto citado com "desligar o computador" arma pendência. | Não executa nada — o porteiro e a confirmação humana seguram — mas a IARA responde "você quer desligar o computador?" a quem pediu um resumo. | Marcar trechos citados na percepção. Aceitar só imperativos foi recusado: quebraria "pode desligar o computador?". |
| D-4 | P2 | O papel nunca é passado por chamador de produção. Todos são `operador`. | O padrão é o seguro, mas `administrador` e `somente_leitura` não são exercitados. | Ligar o papel à identidade da sessão. |
| D-5 | P2 | Sem chave de idempotência no contrato de Habilidade. | Risco futuro, não atual: não há retry automático, e a única ação não idempotente é protegida pela pendência. | Adicionar idempotência ao manifesto **antes** de qualquer integração real de envio. |
| D-6 | P2 | Pendência de autorização vive só em memória de processo. | Restart perde a pendência. Degrada para o lado seguro, mas o operador não é avisado. | Persistir com validade e reidratar como aguardando confirmação — nunca como autorizada. |
| D-7 | P2 | Extração de fatos cobre só horário e assunto de lista fechada. | Conflito de data, nome ou número não é detectado; o desempate volta a ser da LLM. | Ampliar conforme a operação mostrar onde o conflito acontece. |
| D-8 | P2 | Turno preemptado vira evento de auditoria, não fala ao operador. | O operador vê a resposta do turno novo e não sabe que o anterior mudou algo. | Fundir o fato do turno preemptado na resposta seguinte. |
| D-9 | P3 | O nonce de confirmação não discrimina em produção: "confirmo" é texto livre e resolve para a pendência mais recente. | O vínculo real é (operação, usuário, sessão, janela, estado) — que já bloqueia replay. | Carregar o nonce pelo canal quando houver confirmação estruturada. |
| D-10 | P3 | Assinatura de erro usa janela curta: "manda pro João" e "manda pro João Silva" produzem assinaturas diferentes. | Subcontagem de ocorrências. O módulo declara o trade-off. | Nenhum. É o comportamento pretendido. |

### Débitos de repositório

| Item | Situação |
|---|---|
| Streaming do Claude não exercitado | O código está tipado e integrado, mas nunca rodou com chave real. É o próximo a validar quando a `ANTHROPIC_API_KEY` entrar. |
| Duas cópias do mesmo modelo 3D | Resolvido em 14/08/2026: `avatares/lisa_final.glb` era byte a byte idêntico a `ativos/identidade_iara/source.glb`. A cópia da raiz foi removida e a licença CC-BY seguiu junto do arquivo que ficou. |
