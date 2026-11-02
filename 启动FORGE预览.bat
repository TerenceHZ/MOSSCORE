@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "PAGE=%ROOT%\vendor\agent-display\index.html"
set "URL=file:///%PAGE:\=/%"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if not exist "%PAGE%" (
  echo [!] Not found: %PAGE%
  echo     Run 下载FORGE源码.bat first.
  pause
  exit /b 1
)

if exist "%CHROME%" (
  start "" "%CHROME%" --new-window --allow-file-access-from-files "%URL%#forge"
  exit /b 0
)

if exist "%EDGE%" (
  start "" "%EDGE%" --new-window --allow-file-access-from-files "%URL%#forge"
  exit /b 0
)

start "" "%PAGE%#forge"
