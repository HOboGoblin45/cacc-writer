@echo off
echo ============================================================
echo  CACC Writer — Launch Chrome with Remote Debugging
echo ============================================================
echo.
echo This opens Chrome with remote debugging on port 9222.
echo Use this window to log into Real Quantum.
echo.
echo IMPORTANT: Close ALL other Chrome windows first.
echo.
pause

REM Try standard Chrome install locations
set CHROME1="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME2="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set CHROME3="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if exist %CHROME1% (
    echo Starting Chrome from: %CHROME1%
    start "" %CHROME1% --remote-debugging-port=9222 --user-data-dir=C:\rq-session
    goto done
)
if exist %CHROME2% (
    echo Starting Chrome from: %CHROME2%
    start "" %CHROME2% --remote-debugging-port=9222 --user-data-dir=C:\rq-session
    goto done
)
if exist %CHROME3% (
    echo Starting Chrome from: %CHROME3%
    start "" %CHROME3% --remote-debugging-port=9222 --user-data-dir=C:\rq-session
    goto done
)

echo ERROR: Chrome not found in standard locations.
echo Please edit this file and set the correct path to chrome.exe
pause
exit /b 1

:done
echo.
echo Chrome launched with debug port 9222.
echo.
echo Next steps:
echo   1. Log into Real Quantum in the Chrome window that just opened
echo   2. Navigate to your commercial appraisal assignment
echo   3. Run: python real_quantum_agent/selector_discovery.py
echo.
