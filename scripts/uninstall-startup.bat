@echo off
setlocal

set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CACC Writer.bat"

echo.
echo Removing CACC Writer from Windows startup...
echo.

if exist "%SHORTCUT%" (
    del /f /q "%SHORTCUT%"
    if not exist "%SHORTCUT%" (
        echo SUCCESS! CACC Writer has been removed from Windows startup.
    ) else (
        echo ERROR: Could not remove the startup entry. Try running as Administrator.
    )
) else (
    echo INFO: CACC Writer was not found in the Windows startup folder.
    echo Nothing to remove.
)
echo.
pause
