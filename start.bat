@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron" (
  echo First run: installing essential software...
  call install.bat
)

echo Starting Attendance Bridge desktop app...
if exist "node_modules\.bin\electron.cmd" (
  call npx electron .
) else (
  echo Electron is missing. Run install.bat then try again.
  pause
  exit /b 1
)
