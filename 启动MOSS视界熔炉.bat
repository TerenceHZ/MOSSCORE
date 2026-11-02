@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "NODE=C:\Users\ROG\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

if not exist "%NODE%" set "NODE=C:\Users\ROG\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%I"

if not exist "%NODE%" (
  echo [!] Node.js not found.
  pause
  exit /b 1
)

cd /d "%ROOT%"
start "MOSS Sketch" "%NODE%" server-preview.mjs
timeout /t 2 >nul
start "" "http://127.0.0.1:4321/design/moss-sketch.html"

echo.
echo   550C // MOSS SKETCH
echo   http://127.0.0.1:4321/design/moss-sketch.html
echo.
echo   Keep the server window open.
pause
