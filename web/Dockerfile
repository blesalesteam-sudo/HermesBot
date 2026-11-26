# hermesbot-web: la web que abren los dos socios.
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
# Aquí se guarda el historial del chat. En Railway, monta un volumen en /data.
ENV DATA_DIR=/data

CMD ["npm", "start"]
