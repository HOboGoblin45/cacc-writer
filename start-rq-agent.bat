@echo off
title CACC Real Quantum Agent
cd /d "%~dp0"

echo ============================================================
echo  Appraisal Agent â€” Real Quantum Automation Agent
echo ============================================================
echo.
echo  This agent inserts AI-generated narratives into Real Quantum
echo  commercial appraisal software via browser automation.
echo.
echo  BEFORE STARTING:
echo  1. Make sure Chrome is running with remote debugging:
echo     chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\rq-session
echo  2. Log into Real Quantum in that Chrome window
echo  3. Open the commercial report you are working on
echo.
echo  Agent will run at http://localhost:5181
echo  Press Ctrl+C to stop.
echo.

REM Activate virtual environment if it exists
if exist "real_quantum_agent\venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call real_quantum_agent\venv\Scripts\activate.bat
) else (
    echo WARNING: Virtual environment not found.
    echo Run setup first:
    echo   cd real_quantum_agent
    echo   python -m venv venv
    echo   venv\Scripts\activate
    echo   pip install -r requirements.txt
    echo   playwright install chromium
    echo.
)

python real_quantum_agent\agent.py
pause

