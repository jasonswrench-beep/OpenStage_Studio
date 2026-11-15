@echo off
title OpenStage Studio: review a video
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
set "FOLDER=%~1"
if "%FOLDER%"=="" for /f "delims=" %%D in ('node src\guard\cli.ts latest-review') do set "FOLDER=%%D"
if "%FOLDER%"=="" (echo There is no video to review yet. Make one with Make Video.bat first. & pause & exit /b 1)
echo Opening the review of %FOLDER%
echo (To review another video, drag its folder from renders onto this file.)
start "" "src-tauri\target\release\openstage-studio.exe" --review "%FOLDER%"
