@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\qa_gate.ps1" %*
exit /b %ERRORLEVEL%
