@echo off
setlocal

set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Appraisal Agent.bat"

echo.
echo Removing Appraisal Agent from Windows startup...
echo.

if exist "%SHORTCUT%" (
    del /f /q "%SHORTCUT%"
    if not exist "%SHORTCUT%" (
        echo SUCCESS! Appraisal Agent has been removed from Windows startup.
    ) else (
        echo ERROR: Could not remove the startup entry. Try running as Administrator.
    )
) else (
    echo INFO: Appraisal Agent was not found in the Windows startup folder.
    echo Nothing to remove.
)
echo.
pause

