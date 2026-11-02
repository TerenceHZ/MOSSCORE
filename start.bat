@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

set "RUNTIME=%ROOT%\.runtime"
set "ELECTRON_VER=33.4.11"
set "ELECTRON_DIR=%RUNTIME%\electron"
set "ELECTRON_ZIP=%RUNTIME%\electron-v%ELECTRON_VER%-win32-x64.zip"
set "ELECTRON_EXE=%ELECTRON_DIR%\electron.exe"

title 550C // MARKET TERMINAL

if exist "%ELECTRON_EXE%" goto :ensure_shortcut

echo.
echo   ==================================================
echo      550C // MARKET TERMINAL
echo      First run: downloading the Electron runtime.
echo      Approx. 115 MB. Keep this window open.
echo      This is a one-time setup.
echo   ==================================================
echo.

if not exist "%RUNTIME%" mkdir "%RUNTIME%"
if not exist "%ELECTRON_DIR%" mkdir "%ELECTRON_DIR%"

echo [1/2] Downloading Electron %ELECTRON_VER% ...
if exist "%ELECTRON_ZIP%" del /f /q "%ELECTRON_ZIP%" >nul 2>nul
call :download_file "https://registry.npmmirror.com/-/binary/electron/%ELECTRON_VER%/electron-v%ELECTRON_VER%-win32-x64.zip" "%ELECTRON_ZIP%"
if not exist "%ELECTRON_ZIP%" call :download_file "https://github.com/electron/electron/releases/download/v%ELECTRON_VER%/electron-v%ELECTRON_VER%-win32-x64.zip" "%ELECTRON_ZIP%"
if not exist "%ELECTRON_ZIP%" goto :fail_download
for %%A in ("%ELECTRON_ZIP%") do if %%~zA LSS 10000000 goto :fail_download

echo [2/2] Extracting Electron ...
call :extract_zip "%ELECTRON_ZIP%" "%ELECTRON_DIR%"
if not exist "%ELECTRON_EXE%" goto :fail_download
del /f /q "%ELECTRON_ZIP%" >nul 2>nul

call :create_shortcut
goto :launch

:ensure_shortcut
if not exist "%RUNTIME%\shortcut-created" call :create_shortcut
goto :launch

:create_shortcut
if exist "%RUNTIME%\shortcut-created" exit /b 0
if not exist "%ROOT%\scripts\create-shortcut.ps1" exit /b 0
set "ICON=%ROOT%\build\icon.ico"
if not exist "%ICON%" set "ICON=%ELECTRON_EXE%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\create-shortcut.ps1" -Root "%ROOT%" -Electron "%ELECTRON_EXE%" -Icon "%ICON%" >nul 2>nul
echo done> "%RUNTIME%\shortcut-created"
exit /b 0

:launch
echo.
echo [3/3] Starting 550C ...
start "" "%ELECTRON_EXE%" --no-sandbox --disable-gpu-sandbox "%ROOT%"
exit /b 0

:download_file
if exist "%~2" del /f /q "%~2" >nul 2>nul
where curl.exe >nul 2>nul
if errorlevel 1 goto :download_file_ps
curl.exe -L --fail --retry 2 --connect-timeout 20 -o "%~2" "%~1"
if errorlevel 1 goto :download_file_fail
if not exist "%~2" goto :download_file_fail
exit /b 0
:download_file_ps
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing -Uri '%~1' -OutFile '%~2' } catch { exit 1 }"
if errorlevel 1 goto :download_file_fail
if not exist "%~2" goto :download_file_fail
exit /b 0
:download_file_fail
if exist "%~2" del /f /q "%~2" >nul 2>nul
exit /b 1

:extract_zip
where tar.exe >nul 2>nul
if errorlevel 1 goto :extract_zip_ps
tar.exe -xf "%~1" -C "%~2"
if exist "%ELECTRON_EXE%" exit /b 0
:extract_zip_ps
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Expand-Archive -LiteralPath '%~1' -DestinationPath '%~2' -Force } catch { exit 1 }"
exit /b 0

:fail_download
echo.
echo   ==================================================
echo     [!] Electron download or extraction failed.
echo     [!] Check your network or proxy, then retry.
echo     [!] The mirror is registry.npmmirror.com.
echo     [!] A proxy or VPN can also help.
echo   ==================================================
echo.
pause
exit /b 1
