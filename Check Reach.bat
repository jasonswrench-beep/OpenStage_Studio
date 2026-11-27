@echo off
title OpenStage Studio: check reach
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
echo Phase 5's acceptance test: Practice Planner, with its hook off, records a video through the accessibility driver;
echo then the hosted AI (the key Set Up AI.bat saved) uses only the connector to write a script and rehearse it until it passes.
echo The practice program fills your take screen meanwhile. Your own connector settings are not touched.
echo.
node src\connector\check-reach.ts
pause
