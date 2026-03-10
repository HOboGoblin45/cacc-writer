@echo off
title CACC Writer — Full System
cd /d "%~dp0"

echo ============================================================
echo  CACC Writer — Full System Startup
echo ============================================================
echo.
echo  Starting all components:
echo    1. CACC Writer Server     (http://localhost:5178)
echo    2. ACI Automation Agent   (http://localhost:5180)  [residential]
echo    3. Real Quantum Agent     (http://localhost:5181)  [commercial]
echo.
echo  Each component opens in its own window.
echo  Close individual windows to stop that component.
echo.

REM ── 1. Start ACI desktop agent ────────────────────────────────────────────
echo Starting ACI Agent (residential: 1004 / 1025 / 1073 / 1004c)...
if exist "desktop_agent\venv\Scripts\activate.bat" (
    start "CACC ACI Agent" cmd /k "cd /d %~dp0 && call desktop_agent\venv\Scripts\activate.bat && python desktop_agent\agent.py"
) else (
    start "CACC ACI Agent" cmd /k "cd /d %~dp0 && python desktop_agent\agent.py"
)

REM ── 2. Start Real Quantum agent ───────────────────────────────────────────
echo Starting Real Quantum Agent (commercial)...
if exist "real_quantum_agent\venv\Scripts\activate.bat" (
    start "CACC RQ Agent" cmd /k "cd /d %~dp0 && call real_quantum_agent\venv\Scripts\activate.bat && python real_quantum_agent\agent.py"
) else (
    start "CACC RQ Agent" cmd /k "cd /d %~dp0 && python real_quantum_agent\agent.py"
)

REM ── 3. Brief pause so agents can initialize ───────────────────────────────
timeout /t 2 /nobreak >nul

REM ── 4. Start Node.js server and open browser ─────────────────────────────
echo Starting CACC Writer Server...
echo.
echo ============================================================
echo  CACC Writer running at http://localhost:5178
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
