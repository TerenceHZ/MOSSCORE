@echo off
cd /d "%~dp0"
title 550C INSTALLER

echo.
echo   550C // INSTALLER
echo   This window stays open so errors are visible.
echo   Running start.bat ...
echo.

cmd /k ""%~dp0start.bat""
