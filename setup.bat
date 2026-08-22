@echo off
echo ========================================================
echo Installing dependencies for BTC Chart Terminal...
echo ========================================================

where wasm-pack >nul 2>nul
if %errorlevel% equ 0 (
    echo Compiling Rust engine to WebAssembly...
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
echo Installing npm packages...
call npm install
echo.
echo ========================================================
echo Setup complete.
echo You can run the application with: npm run dev
echo ========================================================
pause
