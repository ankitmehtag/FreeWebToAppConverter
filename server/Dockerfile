FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY worker/package.json worker/
RUN npm ci --omit=dev --workspace=server --workspace=shared

COPY server/src server/src

USER node
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
