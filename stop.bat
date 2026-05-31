@echo off
chcp 65001 >nul
title LocalQuantConsole Stop
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_local.ps1"
exit /b %ERRORLEVEL%
