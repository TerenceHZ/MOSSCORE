@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "DEST=%ROOT%\vendor\agent-display"
set "ZIP=%TEMP%\agent-display-forge.zip"

if exist "%DEST%\index.html" (
  echo FORGE source already exists:
  echo   %DEST%\index.html
  pause
  exit /b 0
)

echo.
echo   Downloading FORGE source...
echo   This may take a minute.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://github.com/cyberdaddyleo/agent-display/archive/17311a6e1f66cfb665ac2cb8e5331e2b549b2db3.zip' -OutFile '%ZIP%'; Expand-Archive -Path '%ZIP%' -DestinationPath '%ROOT%\vendor' -Force"

if errorlevel 1 (
  echo.
  echo [!] Download or extraction failed.
  echo     Download manually:
  echo     https://github.com/cyberdaddyleo/agent-display/archive/17311a6e1f66cfb665ac2cb8e5331e2b549b2db3.zip
  echo     Extract it so this file exists:
  echo     %DEST%\index.html
  pause
  exit /b 1
)

for /d %%D in ("%ROOT%\vendor\agent-display-*") do (
  if not exist "%DEST%" mkdir "%DEST%"
  xcopy "%%D\*" "%DEST%\" /E /I /Y >nul
  rmdir /S /Q "%%D"
)

if exist "%DEST%\index.html" (
  echo.
  echo   OK:
  echo   %DEST%\index.html
) else (
  echo.
  echo [!] Extracted, but index.html was not found.
  echo     Check %ROOT%\vendor
)

pause
