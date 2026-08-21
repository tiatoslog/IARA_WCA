## Backup e recuperação

### O que precisa de backup

| Dado | Onde vive | Criticidade |
|---|---|---|
| Banco (centrais, memória, insights, agenda, preferências) | Supabase | alta |
| Shards privados de operador | `dados/memoria/` em disco, ou Supabase | alta |
| Jornal de operações (trilha de auditoria) | `dados/operacoes/*.jsonl` | alta |
| Base determinística (`dados/*.json`) | repositório | baixa — está no Git |
| Código, configuração, documentação | repositório | baixa — está no Git |

### O que NÃO precisa de backup

Áudio de voz (vive em memória do processo, regenerável), `.next` e qualquer
build, `node_modules`.

### Reidratação do jornal

Depois de um restart, a IARA reconstrói do jornal o que pode ter acontecido no
mundo. Sem `IARA_CHAVE_PROVA` a reidratação valida só **estrutura** — formato,
estado legal e dono do arquivo. Quem conseguir escrever no disco consegue
inserir uma operação em estado `verificada` que nunca existiu, e a IARA passa a
jurar ter conferido um efeito que ninguém produziu.

Com a chave, cada linha carrega um HMAC-SHA256 e a reidratação recusa o que não
confere. **Trocar a chave invalida os jornais anteriores** — guarde no cofre do
host.

### Procedimentos

*(a preencher — depende de decisão de infraestrutura)*

| Procedimento | Frequência | Responsável | Onde o backup fica | Última restauração testada |
|---|---|---|---|---|
| Backup do banco Supabase | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Backup dos shards e do jornal | *(a preencher)* | *(a preencher)* | *(a preencher)* | *(a preencher)* |
| Guarda da `IARA_CHAVE_PROVA` | — | *(a preencher)* | *(a preencher)* | — |

> Backup nunca testado não é backup. A coluna da última restauração existe para
> tornar visível quando essa afirmação passa a ser um problema.
