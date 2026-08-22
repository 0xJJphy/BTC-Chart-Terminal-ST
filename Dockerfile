# Multi-stage Dockerfile for BTC Quant Terminal
# Stage 1: Rust WebAssembly Builder
FROM rust:1.80-slim AS rust-builder

WORKDIR /build/src-rust

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl pkg-config libssl-dev build-essential ca-certificates \
    && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh \
    && rm -rf /var/lib/apt/lists/*

COPY src-rust/ ./
RUN wasm-pack build --target web --out-dir /build/src/lib/wasm

# Stage 2: Node.js Runtime & API Server
FROM node:20-bookworm-slim

WORKDIR /app

# System dependencies for native modules (DuckDB)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

# Copy compiled WebAssembly module from Stage 1
COPY --from=rust-builder /build/src/lib/wasm ./src/lib/wasm

# Copy source files
COPY . .

EXPOSE 5173 3001

CMD ["npm", "run", "dev"]
