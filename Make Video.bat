@echo off
title OpenStage Studio: make a video
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
echo Making a video of %SCRIPT%
echo (To make a video of another script, drag its .json file onto this file.)
echo.
echo The program being recorded fills one screen for a minute or two: the main one, or the one local-settings.json names.
echo You can leave it running; it ignores the mouse and the keyboard, and closes by itself when the take is done.
echo The first time, narration needs the voice: run Get Voice.bat once first.
echo.
node src\pipeline\make-video.ts "%SCRIPT%" || (pause & exit /b 1)
echo.
for %%F in ("%SCRIPT%") do set "NAME=%%~nF"
if exist "renders\%NAME%" start "" "renders\%NAME%"
pause
