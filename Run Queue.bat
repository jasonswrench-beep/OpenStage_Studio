@echo off
title OpenStage Studio: record a whole queue
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
echo Records every video in the queue with nobody watching. Drag a manual onto this file to plan, write, rehearse and
echo record all of it; drag series folders or scripts to record those; or run it as it is to record every series.
echo Each script is rehearsed first; one that breaks is skipped (with a repaired copy to read, if an AI is chosen).
echo Videos already made from the same script are not made again, so you can stop and start it again.
echo The computer and screen stay awake meanwhile; the program being recorded fills your take screen.
echo Every video still needs your review and approval before it can be exported.
echo.
node src\batch\queue.ts %*
if exist renders\queue-report.txt start "" renders\queue-report.txt
pause
