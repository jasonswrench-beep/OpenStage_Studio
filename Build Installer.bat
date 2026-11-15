@echo off
title Build the OpenStage Studio installer
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
where cargo >nul 2>nul || (echo Rust is not installed. Get it from rustup.rs, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
echo Building the installer (not signed: for checking on this computer). The first time it downloads Node.js (36 MB) and the
echo installer tool; it takes several minutes.
echo.
node tools\build-installer.mjs || (echo. & echo The installer was not made. Send the text above to the AI assistant. & pause & exit /b 1)
pause
