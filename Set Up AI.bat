@echo off
title OpenStage Studio: choose the AI
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (call npm.cmd install || (pause & exit /b 1))
echo AI is optional. It plans videos from a manual, writes their scripts and repairs them in rehearsal; it never
echo records a video and never approves one. Every script it writes is a file you can read and change first.
echo.
node src\ai\setup.ts
pause
