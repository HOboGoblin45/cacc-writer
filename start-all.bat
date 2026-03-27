@echo off
title Appraisal Agent â€” Full System
cd /d "%~dp0"

echo ============================================================
echo  Appraisal Agent â€” Full System Startup
echo ============================================================
echo.
echo  Starting all components:
echo    1. Appraisal Agent Server     (http://localhost:5178)
echo    2. ACI Automation Agent   (http://localhost:5180)  [residential]
echo    3. Real Quantum Agent     (http://localhost:5181)  [commercial]
echo.
echo  Each component opens in its own window.
echo  Close individual windows to stop that component.
echo.

REM â”€â”€ 1. Start ACI desktop agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo Starting ACI Agent (residential: 1004 / 1025 / 1073 / 1004c)...
if exist "desktop_agent\venv\Scripts\activate.bat" (
    start "CACC ACI Agent" cmd /k "cd /d %~dp0 && call desktop_agent\venv\Scripts\activate.bat && C:\Python313-32\python.exe desktop_agent\agent_v3.py"
) else (
    start "CACC ACI Agent" cmd /k "cd /d %~dp0 && C:\Python313-32\python.exe desktop_agent\agent_v3.py"
)

REM â”€â”€ 2. Start Real Quantum agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo Starting Real Quantum Agent (commercial)...
if exist "real_quantum_agent\venv\Scripts\activate.bat" (
    start "CACC RQ Agent" cmd /k "cd /d %~dp0 && call real_quantum_agent\venv\Scripts\activate.bat && python real_quantum_agent\agent.py"
) else (
    start "CACC RQ Agent" cmd /k "cd /d %~dp0 && python real_quantum_agent\agent.py"
)

REM â”€â”€ 3. Brief pause so agents can initialize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
timeout /t 2 /nobreak >nul

REM â”€â”€ 4. Start Node.js server and open browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo Starting Appraisal Agent Server...
echo.
echo ============================================================
echo  Appraisal Agent running at http://localhost:5178
echo  Close this window to stop the main server.
echo ============================================================
echo.

REM Clear stale env vars so .env always takes effect
set OPENAI_API_KEY=
set OPENAI_MODEL=
set PORT=

start "" http://localhost:5178
node cacc-writer-server.js
pause

