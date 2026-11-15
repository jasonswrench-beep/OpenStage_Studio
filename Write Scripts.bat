@echo off
title OpenStage Studio: write scripts for a plan
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
set "SERIES=%~1"
if "%SERIES%"=="" (echo Drag a series folder, from the series folder, onto this file. & pause & exit /b 1)
echo Writing a script for every approved video in %SERIES%
echo The program opens on one screen (see local-settings.json) so its real controls can be read.
node src\ai\series.ts write "%SERIES%"
start "" "%SERIES%"
pause
