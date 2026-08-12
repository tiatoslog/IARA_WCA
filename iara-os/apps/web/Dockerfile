# IARA OS — kernel + interface num processo só (servidor/principal.ts).
# Alvo: Railway (ou qualquer host de container com processo persistente).
# O PORT vem do host; /saude é o health check.
FROM node:22-alpine

WORKDIR /app

# Camada de dependências separada: mudar código não invalida o npm ci.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
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
