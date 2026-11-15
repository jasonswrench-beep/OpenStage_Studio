@echo off
title OpenStage Studio: check the AI scripts
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
echo Phase 3's acceptance test: from one manual chapter, the AI plans the videos and writes every script, and at least
echo four in five must pass rehearsal after automatic repair, with no hand edits. It uses the AI Set Up AI.bat chose.
echo The practice program fills one screen for a few minutes (see local-settings.json).
echo.
node src\ai\series.ts run "examples\manuals\Practice Planner Guide.openexplainer" --chapter Planning
pause
