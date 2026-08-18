## Segurança e LGPD

### Dados pessoais tratados

| Dado | Origem | Onde fica | Base legal |
|---|---|---|---|
| Nome do operador | roster e `user_metadata` do Supabase | banco e sessão | *(a preencher)* |
| E-mail do operador | Supabase Auth | banco | *(a preencher)* |
| Telefone do operador | `lib/operadores.ts`, quando o canal WhatsApp é usado | repositório | *(a preencher)* |
| Conteúdo das conversas | o próprio operador | shard privado | *(a preencher)* |
| Localização aproximada | permissão do navegador, por sessão | **só memória do processo** | *(a preencher)* |

A posição do aparelho **nunca é gravada** (`servidor/nucleo/LocalOperador.ts`).

### Postura já implementada

- **Isolamento por operador** em três camadas, sendo o prompt a última.
- **RLS ligado sem política**: a anon key não lê uma linha.
- **`service_role` só no servidor**, nunca com prefixo `NEXT_PUBLIC_`.
- **Falha fechada** no canal WhatsApp sem verificação de assinatura, e no motor
  sem as variáveis obrigatórias em produção.
- **Trilha de auditoria** append-only com selo HMAC opcional.
- **Validação de parâmetro na fronteira**: campo não declarado no esquema não
  alcança o provedor.
- **Estrangulamento pré-autenticação** no barramento.

### Terceiros que recebem dados

| Terceiro | O que recebe | Quando |
|---|---|---|
| Anthropic (Claude) | o texto do turno que subiu para raciocínio | só quando as camadas baratas não resolvem |
| Microsoft (Edge TTS) | o texto da resposta, para virar áudio | voz neural gratuita, que é o padrão |
| Convai | o texto da resposta | apenas se `CONVAI_API_KEY` for configurada |
| Meta (WhatsApp) | mensagens do canal | apenas se o canal for ligado |
| Open-Meteo | coordenadas | consulta de clima |
| Supabase | tudo que é persistido | quando configurado |

### Pendências de conformidade

*(a preencher)*

| Item | Status | Responsável |
|---|---|---|
| Encarregado de dados (DPO) designado | *(a preencher)* | *(a preencher)* |
| Política de retenção de conversas | *(a preencher)* | *(a preencher)* |
| Registro de operações de tratamento | *(a preencher)* | *(a preencher)* |
| Aviso aos operadores sobre o que é registrado | *(a preencher)* | *(a preencher)* |
| Procedimento de exclusão a pedido do titular | *(a preencher)* | *(a preencher)* |
| Contrato ou DPA com cada terceiro da tabela acima | *(a preencher)* | *(a preencher)* |
