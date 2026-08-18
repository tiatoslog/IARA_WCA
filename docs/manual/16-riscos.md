## Riscos conhecidos

| Risco | Probabilidade | Impacto | Mitigação atual | O que falta |
|---|---|---|---|---|
| Chave `service_role` vazar | baixa | **crítico** — banco inteiro exposto | Só no servidor; nunca com prefixo público; `.gitignore` cobre `.env*`; varredura na geração da documentação | Rotação periódica documentada |
| `IARA_CHAVE_PROVA` ausente em produção | média | alto — o jornal deixa de ser prova | Validação estrutural continua; o veredito é `sem_chave`, nunca `valido` | Tornar obrigatória em produção |
| Perda de pendência em restart | média | médio — pedido evapora em silêncio | Falha para o lado seguro | Persistir a pendência (D-6) |
| Token do WhatsApp ligado antes da receita determinística | média | alto — habilidade de risco alto sem ciclo de confirmação | D-2 está registrado e a habilidade é inalcançável hoje | Não ligar o token antes de fechar D-2 |
| Host que hiberna derrubando o WebSocket | média | médio — reconexões em série | Documentado; plano pago recomendado | Alerta de indisponibilidade |
| Curinga em `IARA_ORIGENS` | baixa | **crítico** — troca a lista de origens pela internet | O motor **recusa subir** com curinga fora de homologação | — |
| Dependência de terceiro para voz | média | baixo — a IARA fica muda, mas responde | Voz neural gratuita como padrão; Convai é opcional | — |
| Único mantenedor com conhecimento do sistema | *(a preencher)* | *(a preencher)* | esta documentação | *(a preencher)* |
| Pasta do projeto dentro do OneDrive | alta | baixo — árvore muda sozinha durante o trabalho | Confiar no estado do Git | Mover para fora do OneDrive |

### Riscos de negócio

*(a preencher)*

| Risco | Probabilidade | Impacto | Responsável pela mitigação |
|---|---|---|---|
| *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
