@echo off
title Test the installed OpenStage Studio
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
echo Installs the setup made by Build Installer.bat for you only, then works the installed Studio through Windows'
echo accessibility interface, as a screen reader does: every page, then the example video on the take screen.
echo Then it uninstalls it, and checks that your work and the downloads are still there. Leave the mouse and keyboard alone.
echo.
node tools\release-smoke.mjs
pause
