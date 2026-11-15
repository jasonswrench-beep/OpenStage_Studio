@echo off
title OpenStage Studio: copy the voice and the AI model
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
echo If an AI assistant running inside a packaged desktop app downloaded the voice or the built-in AI model, Windows
echo kept them in that app's own folder. This copies them to where Studio looks, checking every file. Nothing is
echo downloaded and nothing is deleted.
echo.
node tools\copy-downloads.ts
pause
