@echo off
title Build OpenStage Studio
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
where cargo >nul 2>nul || (echo Rust is not installed. Get it from rustup.rs, then run this again. & pause & exit /b 1)
echo Checking that everything OpenStage Studio needs is installed.
call npm.cmd install || (pause & exit /b 1)
echo.
echo Building the helper: the part that records windows, speaks narration and writes the video.
cargo build --release --manifest-path studio-helper\Cargo.toml || (echo. & echo The helper did not build. Send the text above to the AI assistant. & if not "%1"=="nopause" pause & exit /b 1)
echo.
echo Building the app, with the practice program it records.
call npx.cmd tauri build --no-bundle || (echo. & echo The app did not build. Send the text above to the AI assistant. & if not "%1"=="nopause" pause & exit /b 1)
echo.
echo OpenStage Studio is built.
if not "%1"=="nopause" pause
