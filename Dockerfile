# ---- ビルドステージ ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install        # ← npm ci から変更
COPY src ./src
RUN npm run build
# ---- 実行ステージ ----
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S botgroup && adduser -S botuser -G botgroup
COPY package*.json ./
RUN npm install --omit=dev   # ← npm ci から変更
COPY --from=builder /app/dist ./dist
USER botuser
CMD ["node", "dist/index.js"]
