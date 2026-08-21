## Monitoramento

### O que já existe

| Sinal | Onde | Para que serve |
|---|---|---|
| `/saude` | `servidor/principal.ts` | healthcheck. É o caminho que o Railway consulta (`railway.toml`) |
| Log de subida | stdout do motor | anuncia qual persistência está em uso: `[iara] persistência: Supabase` |
| Canal `auditoria` | stdout, JSON por linha | recusa de jornal, prova emitida, sondagem barrada |
| Console técnico | interface | o detalhe do turno que não sobe para a sala |
| `npm run medir:voz` | `scripts/diagnostico/` | cronômetro do caminho de voz, quando a fala demora |

### O que observar em produção

- **Healthcheck falhando** com o processo vivo geralmente é `IARA_ORIGENS` ou
  variável obrigatória ausente: o motor recusa subir de propósito.
- **`jornal_linha_recusada` no log** significa que uma linha do jornal não passou
  na validação. Com `IARA_CHAVE_PROVA` configurada, isso é adulteração ou troca
  de chave. Sem ela, é validação estrutural.
- **Reconexões em série** apontam para host que hiberna (plano free) ou proxy que
  fecha WebSocket ocioso.

### O que ainda não existe

*(a preencher)*

| Item | Status | Responsável |
|---|---|---|
| Agregador de logs (Sentry, Better Stack, outro) | *(a preencher)* | *(a preencher)* |
| Alerta de indisponibilidade | *(a preencher)* | *(a preencher)* |
| Painel de custo de tokens | *(a preencher)* | *(a preencher)* |
| Retenção de log definida | *(a preencher)* | *(a preencher)* |
