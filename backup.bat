@echo off
chcp 65001 >nul
title LocalQuantConsole Backup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup_local.ps1"
exit /b %ERRORLEVEL%
