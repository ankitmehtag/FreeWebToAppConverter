FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY worker/package.json worker/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace=server --workspace=shared

COPY shared/src shared/src
COPY server/src server/src

USER node
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
