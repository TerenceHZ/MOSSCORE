@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "SCRIPT=%ROOT%\3d\moss_build_v2.py"
set "PREVIEW=%ROOT%\3d\moss-preview-v2.png"
set "WIRE=%ROOT%\3d\moss-wireframe-v2.png"
set "HOLO=%ROOT%\3d\moss-hologram-v2.png"
set "LINEART=%ROOT%\3d\moss-lineart-v2.png"
set "GLB=%ROOT%\3d\moss-v2.glb"
set "BLENDER="

if not exist "%SCRIPT%" (
  echo [!] Script not found: %SCRIPT%
  pause
  exit /b 1
)

where blender.exe >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%I in ('where blender.exe 2^>nul') do if not defined BLENDER set "BLENDER=%%I"
)

if not defined BLENDER if exist "D:\Blender\blender.exe" set "BLENDER=D:\Blender\blender.exe"
if not defined BLENDER if exist "C:\Blender\blender.exe" set "BLENDER=C:\Blender\blender.exe"
if not defined BLENDER for /d %%D in ("D:\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
if not defined BLENDER for /d %%D in ("C:\Program Files\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
if not defined BLENDER for /d %%D in ("%LOCALAPPDATA%\Programs\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
if not defined BLENDER for /d %%D in ("D:\Program Files\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"

if not defined BLENDER (
  echo.
  echo [!] Blender not found.
  echo     Install Blender 4.x from https://www.blender.org/download/
  echo     Then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   550C // MOSS BUILD
echo   Blender: %BLENDER%
echo   Script : %SCRIPT%
echo.
echo   Building model, exporting GLB and rendering preview...
echo.

"%BLENDER%" -b -P "%SCRIPT%"

if exist "%ROOT%\3d\moss-v2.blend" (
  echo.
  echo   Rendering 550C hologram pass...
  "%BLENDER%" -b -P "%ROOT%\3d\moss_hologram.py"
  echo.
  echo   Rendering 550C line-art pass...
  "%BLENDER%" -b -P "%ROOT%\3d\moss_lineart.py"
)

echo.
echo   Blender exit code: %ERRORLEVEL%
echo   Check:
echo     %PREVIEW%
echo     %WIRE%
echo     %HOLO%
echo     %LINEART%
echo     %GLB%
echo.

if exist "%PREVIEW%" start "" "%PREVIEW%"
if exist "%WIRE%" start "" "%WIRE%"
if exist "%HOLO%" start "" "%HOLO%"
if exist "%LINEART%" start "" "%LINEART%"
if exist "%GLB%" echo   GLB created.
pause
