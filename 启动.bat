@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Prefer the project virtualenv; fall back to python on PATH.
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
"%PY%" quick-start.py %*
pause
