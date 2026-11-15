@echo off
title OpenStage Studio: check the guard
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
echo The guard's acceptance test: a script that types a blocked name must be stopped at the script scan, a planted
echo file path must be flagged by the frame scan, and export must stay shut until the flag is resolved.
echo The practice program fills one screen for about a minute (see local-settings.json).
echo.
node src\guard\check-guard.ts
echo.
pause
