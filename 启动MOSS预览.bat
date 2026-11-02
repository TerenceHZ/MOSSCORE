@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "APP=%ROOT%\vendor\prompt-spider-ui-main"
set "NODE=C:\Users\ROG\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
set "CHECK=%ROOT%\moss-check.log"

if not exist "%APP%\server.mjs" (
  echo [!] Not found: %APP%\server.mjs
  pause
  exit /b 1
)

if not exist "%NODE%" set "NODE=C:\Users\ROG\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%I"

if not exist "%NODE%" (
  echo [!] Node.js not found.
  pause
  exit /b 1
)

echo 550C // MOSS PREVIEW CHECK > "%CHECK%"
for %%F in (renderer.js spider.js main.js model.js boot.js) do (
  "%NODE%" --check "%APP%\app\%%F" >> "%CHECK%" 2>&1
  if errorlevel 1 (
    echo [!] Syntax error in %%F
    echo.
    type "%CHECK%"
    start "" notepad "%CHECK%"
    pause
    exit /b 1
  )
)

echo.
echo   550C // MOSS PREVIEW
echo   %APP%
echo   Node: %NODE%
echo.
echo   Starting local preview at http://127.0.0.1:4317
echo.

cd /d "%APP%"
start "MOSS Preview Server" "%NODE%" server.mjs
timeout /t 2 >nul
start "" "http://127.0.0.1:4317"

echo   Server window opened. Keep it open while viewing.
echo   If the browser shows an error, wait 2 seconds and refresh.
echo.
pause
