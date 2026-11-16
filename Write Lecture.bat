@echo off
title OpenStage Studio: write a lecture
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
if "%~1"=="" (
  echo Drag your notes (a .md or .txt file) or a manual onto this file. A lecture script is written into the lectures folder.
  pause
  exit /b 1
)
node src\lecture\write.ts "%~1"
pause
