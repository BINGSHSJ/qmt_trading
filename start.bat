@echo off
chcp 65001 >nul
title LocalQuantConsole Start
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_local.ps1"
exit /b %ERRORLEVEL%
