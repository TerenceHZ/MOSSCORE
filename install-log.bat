@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "LOG=%~dp0install.log"
echo 550C INSTALL LOG > "%LOG%"
echo DATE=%DATE% %TIME% >> "%LOG%"
echo ROOT=%CD% >> "%LOG%"
echo. >> "%LOG%"
echo [start.bat] >> "%LOG%"

call "%~dp0start.bat" < nul >> "%LOG%" 2>&1
set "CODE=%ERRORLEVEL%"

echo. >> "%LOG%"
echo EXIT_CODE=%CODE% >> "%LOG%"

echo.
echo   550C installer finished. Exit code: %CODE%
echo   Log file: %LOG%
echo.
start "" notepad "%LOG%"
pause
