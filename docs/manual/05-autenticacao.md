## Autenticação e identidade

### Dois modos, e a diferença importa

**Com Supabase configurado** (`NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` no cliente, `SUPABASE_SERVICE_ROLE_KEY` no
servidor), a IARA exige login. A identidade vem de um **token verificado pelo
servidor** (`nucleo/Autenticacao.ts`), e o `id_usuario` que o cliente envia é
**ignorado**.

**Sem essas variáveis**, o app cai em modo local: a identidade vem de um seletor
e uma faixa no topo da tela diz isso o tempo todo. É adequado para
desenvolvimento e **não** para a internet — um menu suspenso não é controle de
acesso. O motor recusa subir assim em produção.

### Criar um operador

Supabase → Authentication → Users → *Add user* (e-mail e senha). Opcionalmente
preencha `user_metadata.nome` para a IARA chamar a pessoa pelo nome.

O roster em `lib/operadores.ts` é a lista fechada de quem existe. Para o canal
WhatsApp, o campo `telefone` é a trava: número que não está lá não abre sessão.

### Papéis (RBAC)

| Papel | O que muda |
|---|---|
| `operador` | padrão de quem não aparece em lista nenhuma |
| `administrador` | acrescenta a permissão `externo` (agir alcançando terceiros) |
| `somente_leitura` | remove escrita e limita o catálogo a consultas |

A restrição vence a concessão: quem estiver nas duas listas fica somente leitura.
Configurado por `IARA_ADMINS` e `IARA_SOMENTE_LEITURA`, casando por `id_usuario`
ou por e-mail.

> **Débito conhecido (D-4):** o papel ainda não é passado por nenhum chamador de
> produção. Todos são `operador`. O padrão é o seguro — `externo` fica de fora —
> mas `administrador` e `somente_leitura` são caminhos não exercitados.

### Postura de segurança do banco

O navegador **nunca** fala com o Supabase para ler ou escrever dados — só o motor
fala, com a `service_role`. Por isso o RLS está ligado **sem política nenhuma**:
se a anon key vazar, ela não lê uma linha. A `service_role` ignora RLS por
definição, então só existe no servidor e **nunca** com prefixo `NEXT_PUBLIC_`.

O motor decodifica o papel do JWT na subida e reclama se alguém trocar as duas
por engano — o sintoma desse erro, sem o aviso, é silencioso.
