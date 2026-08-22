SHELL := /bin/zsh

# Detect node / npm: use user fnm path if present, otherwise fallback to system PATH
FNM_NODE_BIN := $(HOME)/.local/share/fnm/node-versions/v18.20.8/installation/bin
NODE_BIN := $(shell if [ -d "$(FNM_NODE_BIN)" ]; then echo "$(FNM_NODE_BIN)"; else dirname $$(which npm 2>/dev/null || echo "/usr/local/bin"); fi)
NPM := $(shell if [ -x "$(NODE_BIN)/npm" ]; then echo "$(NODE_BIN)/npm"; else which npm 2>/dev/null || echo "npm"; fi)
export PATH := $(NODE_BIN):$(HOME)/.cargo/bin:$(PATH)

.PHONY: help setup dev build preview env-check build-wasm

help:
	@echo ""
	@echo "  BTC Quant Terminal — Comandos"
	@echo ""
	@echo "  make setup          Instalar dependencias (npm install)"
	@echo "  make build-wasm     Compilar motor Rust a WebAssembly"
	@echo "  make dev            Levantar servidor de desarrollo (Vite + Wasm)"
	@echo "  make build          Generar build de producción"
	@echo "  make preview        Previsualizar build de producción"
	@echo "  make env-check      Verificar entorno (Node/NPM/Rust)"
	@echo ""

build-wasm:
	@echo "→ Compilando Rust a Wasm ..."
	@if [ -f "$$HOME/.cargo/env" ]; then . "$$HOME/.cargo/env"; fi; \
	cd src-rust && wasm-pack build --target web --out-dir ../src/lib/wasm
	@echo "✓ Wasm listo en src/lib/wasm"

setup:
	@echo "→ Instalando dependencias npm ..."
	@$(NPM) install
	@echo "✓ Node modules listos"

dev: build-wasm
	@$(NPM) run dev

build: build-wasm
	@$(NPM) run build

preview:
	@$(NPM) run preview

env-check:
	@echo "--- Node ---"
	@node --version 2>/dev/null || $(NODE_BIN)/node --version 2>/dev/null || echo "Node no encontrado"
	@echo "--- NPM ---"
	@$(NPM) --version 2>/dev/null || echo "NPM no encontrado"
	@echo "--- Rust ---"
	@rustc --version 2>/dev/null || (if [ -f "$$HOME/.cargo/env" ]; then . "$$HOME/.cargo/env" && rustc --version; else echo "Rust no encontrado"; fi)
	@echo "--- wasm-pack ---"
	@wasm-pack --version 2>/dev/null || (if [ -f "$$HOME/.cargo/env" ]; then . "$$HOME/.cargo/env" && wasm-pack --version; else echo "wasm-pack no encontrado"; fi)
