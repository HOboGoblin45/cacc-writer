@echo off
setlocal

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%~dp0..\start-all-silent.bat"
set "SHORTCUT=%STARTUP_DIR%\Appraisal Agent.bat"

REM Resolve absolute path of target
pushd "%~dp0.."
set "TARGET=%CD%\start-all-silent.bat"
popd

echo.
echo Installing Appraisal Agent auto-startup...
echo.
echo Source: %TARGET%
echo Startup: %SHORTCUT%
echo.

if not exist "%TARGET%" (
    echo ERROR: Could not find start-all-silent.bat at:
    echo   %TARGET%
    echo.
    echo Make sure you run this from the scripts\ folder inside cacc-writer.
    pause
    exit /b 1
)

REM Copy the bat file as a wrapper shortcut into the Startup folder
(
    echo @echo off
    echo start "" "%TARGET%"
) > "%SHORTCUT%"

if exist "%SHORTCUT%" (
    echo SUCCESS! Appraisal Agent will now start automatically when Windows boots.
    echo.
    echo To remove it later, run: scripts\uninstall-startup.bat
) else (
    echo ERROR: Could not write to Startup folder.
    echo You may need to run this as Administrator.
)
echo.
pause

