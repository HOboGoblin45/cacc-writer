@echo off
title Appraisal Agent Server
cd /d "%~dp0"

REM Clear any stale system/user OPENAI_API_KEY so .env always takes effect
set OPENAI_API_KEY=
set OPENAI_MODEL=
set PORT=

echo Starting Appraisal Agent...
echo.
echo Server will open at http://localhost:5178
echo Close this window to stop the server.
echo.
start "" http://localhost:5178
node cacc-writer-server.js
pause


