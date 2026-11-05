FROM rust:1.95-slim AS pdf-builder
WORKDIR /build
COPY rust/pdf-text ./pdf-text
RUN cargo build --locked --release --manifest-path pdf-text/Cargo.toml

FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=pdf-builder /build/pdf-text/target/release/pdf-text /usr/local/bin/pdf-text

ENV NODE_ENV=production
ENV PORT=3000
ENV PDF_TEXT_BIN=/usr/local/bin/pdf-text

EXPOSE 3000

CMD ["node", "server.js"]
