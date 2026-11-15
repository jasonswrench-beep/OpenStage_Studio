@echo off
title OpenStage Studio: check batch and re-record
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
echo Phase 4's acceptance test: the invented Practice Planner manual records unattended, then a version with two
echo renamed controls is checked, and the release check must name exactly the steps they break. It uses the AI
echo Set Up AI.bat chose and takes about half an hour; the program fills your take screen meanwhile.
echo.
node src\batch\check-batch.ts
pause
