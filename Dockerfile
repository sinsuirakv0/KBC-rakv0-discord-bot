# ---- ビルドステージ ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# ---- 実行ステージ ----
FROM node:20-alpine
WORKDIR /app

# セキュリティ: root 以外のユーザーで実行
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER botuser

CMD ["node", "dist/index.js"]
