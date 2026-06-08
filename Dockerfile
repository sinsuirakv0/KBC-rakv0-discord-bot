FROM mcr.microsoft.com/playwright:v1.60.0-noble AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
