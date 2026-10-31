FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev

COPY server/src server/src

USER node
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
