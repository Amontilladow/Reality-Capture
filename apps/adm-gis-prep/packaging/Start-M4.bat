@echo off
rem Starts M4 GIS Preparation. Use this if double-clicking m4adm.exe shows "Windows cannot access the specified device, path, or file".
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' | Unblock-File" >nul 2>&1
echo Starting M4 GIS Preparation... the first start can take a few minutes. Leave this window open.
"%~dp0m4adm.exe"
if errorlevel 1 pause
