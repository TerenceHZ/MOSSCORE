@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "LOG=%ROOT%\moss-build.log"

echo 550C // MOSS BUILD LOG > "%LOG%"
echo DATE=%DATE% %TIME% >> "%LOG%"
echo ROOT=%ROOT% >> "%LOG%"
echo. >> "%LOG%"

call "%ROOT%\构建MOSS.bat" < nul >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo EXIT_CODE=%ERRORLEVEL% >> "%LOG%"

start "" notepad "%LOG%"
pause
