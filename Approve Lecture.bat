@echo off
title OpenStage Studio: approve a lecture
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
if "%~1"=="" (
  echo Drag a lecture script (in the lectures folder) onto this file, once you have read it.
  pause
  exit /b 1
)
set /p "BY=Your name (the approval records it): "
node src\lecture\write.ts --approve "%~1" --by "%BY%"
pause
