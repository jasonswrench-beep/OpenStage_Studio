@echo off
title OpenStage Studio: plan videos from a manual
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
set "MANUAL=%~1"
if "%MANUAL%"=="" set "MANUAL=examples\manuals\Practice Planner Guide.openexplainer"
echo Planning videos from %MANUAL%
echo (Drag a manual, a documentation project or a PDF, onto this file to plan from it.)
set /p "CHAPTER=Which chapter? Type its number or words from its title, or press Enter for the first: "
if "%CHAPTER%"=="" (node src\ai\series.ts plan "%MANUAL%") else (node src\ai\series.ts plan "%MANUAL%" --chapter "%CHAPTER%")
if exist series start "" series
pause
