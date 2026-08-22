@echo off
echo ========================================================
echo   BTC Quant Terminal - Setup & Environment Init
echo ========================================================

if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] Creating .env from .env.example...
        copy .env.example .env >nul
    )
)

where wasm-pack >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Compiling Rust engine to WebAssembly...
    cd src-rust
    wasm-pack build --target web --out-dir ..\src\lib\wasm
    cd ..
    echo [OK] Wasm engine built successfully.
) else (
    echo [NOTE] wasm-pack not found in PATH.
    echo        If Rust is installed, install wasm-pack with: cargo install wasm-pack
    echo        The application will continue with npm setup.
)

echo.
echo [INFO] Installing npm packages...
call npm install

echo.
where docker >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Docker detected. Running post-install image prune to maintain clean disk...
    docker image prune -f >nul 2>&1
)

echo.
echo ========================================================
echo Setup complete.
echo - Native dev server: npm run dev
echo - Isolated Docker:   npm run docker:up
echo - Docker rebuild:    npm run docker:rebuild
echo ========================================================
pause

