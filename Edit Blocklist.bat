@echo off
title OpenStage Studio: your blocklist
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
node src\guard\cli.ts start-blocklist || (pause & exit /b 1)
start "" notepad blocklist.local.json
