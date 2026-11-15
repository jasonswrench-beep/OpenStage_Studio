@echo off
title OpenStage Studio: export upload packages
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
echo Making an upload package for every video that has been reviewed and approved, in the packages folder.
echo Videos still waiting for review are listed with what they need.
echo (To export only some, drag their folders from renders onto this file.)
echo.
node src\package\export.ts %*
if exist packages start "" packages
pause
