@echo off
rem ============================================
rem  PashuAarogya AI - one-click launcher
rem  Starts (1) the Pashu Lens AI sidecar if the
rem  PashuPehchaan breed model is present, then
rem  (2) the main platform.
rem ============================================
set "AI_DIR=%PASHU_AI_DIR%"
if "%AI_DIR%"=="" set "AI_DIR=C:\Users\admin\Desktop\BreedVision18\Breed-Vision-main\breed-ai-service"

if exist "%AI_DIR%\.venv\Scripts\python.exe" (
  echo Starting Pashu Lens AI sidecar (EfficientNetV2, 50 breeds) on port 8001 ...
  start "PashuAarogya - AI sidecar" /min cmd /c "cd /d "%AI_DIR%" && .venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8001"
) else (
  echo [info] Breed model not found at %AI_DIR% - Pashu Lens will report "AI unavailable".
)

cd /d "%~dp0backend"
echo Installing dependencies (first run only)...
python -m pip install -q -r ..\requirements.txt
echo.
echo Starting PashuAarogya at http://127.0.0.1:8000  (LAN: see QR on login page)
echo Demo OTP for every login: 123456
echo.
start "" http://127.0.0.1:8000
python main.py
