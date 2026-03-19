@echo off
cd /d "%~dp0"

REM ── Daily backup (runs silently in background) ─────────────────────────────
if exist "scripts\daily-backup.mjs" (
    start "" /min cmd /c "node scripts\daily-backup.mjs"
)

REM ── 1. Start ACI desktop agent (residential) ──────────────────────────────
if exist "desktop_agent\venv\Scripts\pythonw.exe" (
    start "" /min "desktop_agent\venv\Scripts\pythonw.exe" "%~dp0desktop_agent\agent.py"
) else (
    start "" /min cmd /c "cd /d %~dp0 && python desktop_agent\agent.py"
)

REM ── 2. Start Real Quantum agent (commercial) ──────────────────────────────
if exist "real_quantum_agent\venv\Scripts\pythonw.exe" (
    start "" /min "real_quantum_agent\venv\Scripts\pythonw.exe" "%~dp0real_quantum_agent\agent.py"
) else (
    start "" /min cmd /c "cd /d %~dp0 && python real_quantum_agent\agent.py"
)

REM ── 3. Start cacc-writer Node.js server ──────────────────────────────────
start "" /min cmd /c "cd /d %~dp0 && node cacc-writer-server.js"

REM ── 4. Wait 5 seconds, then open browser ─────────────────────────────────
timeout /t 5 /nobreak >nul
start "" http://localhost:5178
