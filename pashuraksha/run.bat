@echo off
rem ============================================
rem  PashuRaksha AI - one-click launcher
rem ============================================
cd /d "%~dp0backend"
echo Installing dependencies (first run only)...
python -m pip install -q -r ..\requirements.txt
echo.
echo Starting PashuRaksha AI at http://127.0.0.1:8000
echo Demo OTP for every login: 123456
echo.
start "" http://127.0.0.1:8000
python main.py
