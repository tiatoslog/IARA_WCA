## Troubleshooting

Sintomas reais, com a causa que já os produziu.

### A IARA fica presa em "reconectando…", sem erro nenhum

Indistinguível de motor fora do ar. Causas, em ordem de frequência:

1. `NEXT_PUBLIC_IARA_WS` mudou mas o front **não foi reconstruído**.
   `NEXT_PUBLIC_*` é embutida no bundle em tempo de build; editar no painel não
   basta.
2. `IARA_ORIGENS` não contém a origem exata do front, e o motor está em headless.
3. O host hiberna (plano free) e derruba o WebSocket.

### A tela mostra "modo local sem autenticação" e "a sessão expirou" ao mesmo tempo

O bundle não recebeu as `NEXT_PUBLIC_SUPABASE_*`. Num deploy por Docker, elas
precisam estar como `ARG` no Dockerfile. O motor sobe, o healthcheck passa, e
ninguém entra.

### A IARA conversa normalmente mas fica MUDA

`NEXT_PUBLIC_IARA_MOTOR` e `NEXT_PUBLIC_IARA_WS` divergiram. O áudio da voz é
servido pelo HTTP do motor; o padrão é derivar um do outro justamente para as
duas não desandarem quando alguém troca o domínio e atualiza só uma.

### O canal WhatsApp recusa tudo, inclusive mensagem legítima

- `WHATSAPP_APP_SECRET` ausente: falha fechada, de propósito.
- Algum intermediário reserializou o JSON. A Meta assina o corpo bruto; proxy que
  reescreve o corpo invalida a assinatura.

### `next build` falha com erro que culpa o código

Se for em Docker: `node_modules` do Windows foi copiado por cima do `npm ci` do
container. É o que o `.dockerignore` impede — confira se ele foi para a imagem.

### O dev server quebra do nada

`npm run build` rodou com o `dev` ativo. Os dois compartilham `.next`.
Solução: `npm run limpar`.

### Erro de compilação apontando para uma palavra aleatória num shader

Crase dentro de bloco GLSL. Rode `npm run verificar` — a guarda aponta a linha.

### A IARA recusa uma pergunta do operador sobre o registro dele mesmo

Era um defeito de comparação de identidade com autenticação ligada (uuid não casa
com id do roster) e está corrigido comparando por nome normalizado. Se reaparecer,
o ponto é `lib/operadores.ts`, `outrosOperadores`.

### A IARA diz que não pode criar pasta / abrir aplicativo

Esperado quando o motor roda na nuvem: o agente local age na máquina do operador,
via IARA Desktop. Enquanto o canal reverso não existir, essas habilidades
operariam só dentro do container — e recusar é preferível a fingir que criou.
