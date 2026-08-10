# IARA OS — kernel + interface num processo só (servidor/principal.ts).
# Alvo: Railway (ou qualquer host de container com processo persistente).
# O PORT vem do host; /saude é o health check.
FROM node:22-alpine

WORKDIR /app

# Camada de dependências separada: mudar código não invalida o npm ci.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# tsx executa o TypeScript do servidor direto — mesmo comando do `npm start`.
CMD ["npx", "tsx", "servidor/principal.ts"]
