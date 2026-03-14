# ---- ビルドステージ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build
# ---- 実行ステージ ----
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S botgroup && adduser -S botuser -G botgroup
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
USER botuser
CMD ["node", "dist/index.js"]
