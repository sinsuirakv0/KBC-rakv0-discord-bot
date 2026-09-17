FROM rust:1.89-bookworm AS motion-core-builder
WORKDIR /app
COPY native/motion-core ./native/motion-core
RUN cargo build --release --manifest-path native/motion-core/Cargo.toml \
  && cp native/motion-core/target/release/libkbc_motion_core.so /kbc_motion_core.node

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=motion-core-builder /kbc_motion_core.node ./dist/commands/shared/motion/kbc_motion_core.node
COPY content ./content
EXPOSE 3000
CMD ["node", "dist/index.js"]
