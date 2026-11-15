@echo off
title OpenStage Studio: release check
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
if not exist studio-helper\target\release\studio-helper.exe goto build
if not exist src-tauri\target\release\openstage-studio.exe goto build
goto built
:build
echo OpenStage Studio is not built yet. Building it now; the first time takes several minutes.
call "%~dp0Build Studio.bat" nopause || (pause & exit /b 1)
:built
echo After a new version of a program: rehearses every script (every series, and the examples) and names the exact
echo step in each that no longer works. Nothing is recorded and no script is changed; with an AI chosen, each broken
echo script gets a repaired copy beside it to read. Drag folders or scripts onto this file to check only those.
echo.
node src\batch\release.ts %*
start "" renders\release-check\report.txt
pause
