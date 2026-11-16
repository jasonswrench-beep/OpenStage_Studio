@echo off
title OpenStage Studio: a script from a recording
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
if "%~1"=="" (
  echo Drag a recording (a folder whose name ends in .capture, made with its interaction log on) onto this file.
  pause
  exit /b 1
)
echo Turning the recording into a draft script. Studio then opens the program on the take screen to find each control;
echo nothing is recorded. Leave that display alone until it says the script is made.
echo.
node src\recording\import.ts "%~1"
pause
