# IARA OS — kernel + interface num processo só (servidor/principal.ts).
# Alvo: Railway (ou qualquer host de container com processo persistente).
# O PORT vem do host; /saude é o health check.
FROM node:22-alpine

WORKDIR /app

# Camada de dependências separada: mudar código não invalida o npm ci.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# AS VARIÁVEIS DO CLIENTE PRECISAM EXISTIR AQUI, NO BUILD — não no runtime.
#
# `NEXT_PUBLIC_*` não é lida quando o processo sobe: ela é ESCRITA DENTRO do
# bundle JavaScript durante o `next build`. Variáveis de serviço do host chegam
# ao container em runtime e não entram num `docker build` sozinhas; para o build
# enxergá-las é preciso declará-las como ARG.
#
# Esquecer isso não quebra o deploy — e é justamente o que faz dele um problema
# difícil. O motor sobe, o healthcheck passa, a página abre. Só que o navegador
# recebe um bundle que não sabe que existe Supabase, decide que não há login,
# mostra o SELETOR DE OPERADOR e manda um `ola` sem token. O servidor, esse sim
# configurado, recusa com 4401. A tela mostra as duas coisas ao mesmo tempo —
# "modo local sem autenticação" e "a sessão expirou ou foi recusada" — e a
# equipe não consegue entrar de jeito nenhum.
#
# Aconteceu em 12/08/2026, no primeiro deploy real. Se um dia o login sumir e o
# seletor voltar, comece por aqui.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_IARA_WS
ARG NEXT_PUBLIC_IARA_MOTOR
ARG NEXT_PUBLIC_IARA_MODO_LOCAL
ARG NEXT_PUBLIC_IARA_INSTALADOR
ARG NEXT_PUBLIC_IARA_INSTALADOR_SHA256
ARG NEXT_PUBLIC_IARA_INSTALADOR_NOTAS
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_IARA_WS=$NEXT_PUBLIC_IARA_WS \
    NEXT_PUBLIC_IARA_MOTOR=$NEXT_PUBLIC_IARA_MOTOR \
    NEXT_PUBLIC_IARA_MODO_LOCAL=$NEXT_PUBLIC_IARA_MODO_LOCAL \
    NEXT_PUBLIC_IARA_INSTALADOR=$NEXT_PUBLIC_IARA_INSTALADOR \
    NEXT_PUBLIC_IARA_INSTALADOR_SHA256=$NEXT_PUBLIC_IARA_INSTALADOR_SHA256 \
    NEXT_PUBLIC_IARA_INSTALADOR_NOTAS=$NEXT_PUBLIC_IARA_INSTALADOR_NOTAS

# O build do Next fica AQUI mesmo quando o processo sobe com IARA_MODO=headless,
# onde ele é peso morto (~1 min de CI, ~200 MB de imagem). NÃO remova para
# "otimizar": é o que faz `IARA_MODO=unificado` ser um interruptor de emergência
# de uma variável só. Se o front na nuvem cair — domínio expirado, deploy
# travado, NEXT_PUBLIC_IARA_WS apontando para o lugar errado — trocar essa
# variável no painel devolve o sistema inteiro num endereço só, sem rebuild.
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# tsx executa o TypeScript do servidor direto — mesmo comando do `npm start`.
CMD ["npx", "tsx", "servidor/principal.ts"]
