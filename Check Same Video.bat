@echo off
title OpenStage Studio: check that a script gives the same video twice
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
set "SCRIPT=%~1"
if "%SCRIPT%"=="" set "SCRIPT=examples\plan-a-lesson.json"
echo This makes the video of %SCRIPT% twice, from scratch each time, and checks that both are the same.
echo It takes about five minutes. The program being recorded fills your main screen during each take.
echo.
node src\pipeline\check-repeat.ts "%SCRIPT%"
echo.
pause
