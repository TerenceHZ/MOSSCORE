@echo off
chcp 65001 >nul
setlocal EnableExtensions

cd /d "%~dp0"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "ELECTRON_EXE=%ROOT%\.runtime\electron\electron.exe"
set "LOG=%ROOT%\debug.log"

echo [%DATE% %TIME%] DEBUG START > "%LOG%"
echo ROOT=%ROOT% >> "%LOG%"
echo ELECTRON=%ELECTRON_EXE% >> "%LOG%"

echo. >> "%LOG%"
echo [node] >> "%LOG%"
where node.exe >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
echo [npm] >> "%LOG%"
where npm.cmd >> "%LOG%" 2>&1

echo. >> "%LOG%"
if exist "%ELECTRON_EXE%" (
  echo ELECTRON_RUNTIME=FOUND >> "%LOG%"
) else (
  echo ELECTRON_RUNTIME=MISSING >> "%LOG%"
)

echo.
echo   550C debug launcher
echo   Log file: %LOG%
echo.

if not exist "%ELECTRON_EXE%" (
  echo   [ERROR] Electron runtime is not installed.
  echo   Run start.bat first, then run this file again.
  echo.
  pause
  exit /b 1
)

echo   Starting Electron ...
echo. >> "%LOG%"
echo [electron version] >> "%LOG%"
"%ELECTRON_EXE%" --no-sandbox --version >> "%LOG%" 2>&1
echo VERSION_EXIT=%ERRORLEVEL% >> "%LOG%"
echo. >> "%LOG%"
echo [electron app] >> "%LOG%"
set "ELECTRON_ENABLE_LOGGING=1"
set "ELECTRON_ENABLE_STACK_DUMPING=1"
"%ELECTRON_EXE%" --no-sandbox --disable-gpu-sandbox --enable-logging "%ROOT%" >> "%LOG%" 2>&1
set "CODE=%ERRORLEVEL%"
echo. >> "%LOG%"
echo EXIT_CODE=%CODE% >> "%LOG%"
echo   Electron exited with code %CODE%.
echo   Full log: %LOG%
echo.
pause
