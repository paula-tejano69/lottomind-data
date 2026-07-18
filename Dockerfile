FROM node:20-bookworm-slim

WORKDIR /app

# Sem dependências nativas — instalação rápida e sem compilação.
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server.js"]
