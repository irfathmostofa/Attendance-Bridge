@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\express" (
  echo First run: installing essential software...
  call install.bat
)

echo Starting Attendance Bridge...
where electron >nul 2>nul
if exist "node_modules\.bin\electron.cmd" (
  call npx electron .
) else (
  echo Electron not found. Starting Node.js server instead...
  node server\index.js
)
