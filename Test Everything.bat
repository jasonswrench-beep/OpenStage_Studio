@echo off
title OpenStage Studio tests
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
where cargo >nul 2>nul || (echo Rust is not installed. Get it from rustup.rs, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
echo Checking the TypeScript.
call npx.cmd tsc --noEmit || (echo The TypeScript check FAILED. & pause & exit /b 1)
echo.
echo Running the TypeScript tests.
call npm.cmd test || (echo The TypeScript tests FAILED. & pause & exit /b 1)
echo.
echo Running the helper's tests.
cargo test --release --manifest-path studio-helper\Cargo.toml || (echo The helper's tests FAILED. & pause & exit /b 1)
echo.
echo All the tests passed.
pause
