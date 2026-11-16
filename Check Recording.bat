@echo off
title OpenStage Studio recording check
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
echo Turns the example recording into a script, finds its controls in the practice program, and makes the video
echo twice to check it is the same. It opens the practice program on the take screen; leave that display alone.
echo.
node src\recording\check-recording.ts
pause
