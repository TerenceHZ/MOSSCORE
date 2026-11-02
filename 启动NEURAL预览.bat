@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "APP=%USERPROFILE%\MOSS CORE\MOSS CORE.exe"

if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)

echo [!] MOSS CORE desktop app not found:
echo     %APP%
echo.
echo     Run the installer or open the release folder.
pause
exit /b 1
