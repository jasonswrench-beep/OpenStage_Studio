@echo off
title OpenStage Studio: make the app icons
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if exist OpenStage_Studio_Icon.zip (
  echo Unpacking OpenStage_Studio_Icon.zip into the branding folder.
  powershell -NoProfile -Command "Expand-Archive -LiteralPath 'OpenStage_Studio_Icon.zip' -DestinationPath 'branding' -Force" || (pause & exit /b 1)
)
node tools\make-icons.mjs branding || (pause & exit /b 1)
pause
