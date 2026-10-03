@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo  Attendance Bridge - install essential software
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Opening the official installer page...
  start "" "https://nodejs.org/en/download"
  echo Install Node.js LTS, then run install.bat again.
  pause
  exit /b 1
)

echo Installing project packages...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo Installing Electron...
call npm install electron@33.2.1 --save-dev --no-fund --no-audit
if errorlevel 1 (
  echo Local Electron install failed. Trying global...
  call npm install -g electron@33.2.1 --no-fund --no-audit
)

echo Preparing data folder...
if not exist "data" mkdir data
if not exist "data\config.json" (
  echo {"listenPort":3780,"iclockEnabled":true,"syncUrl":"https://server.roohschool.edu.bd/server/postAttendence","syncIntervalMinutes":15,"autoSync":false,"devices":[]} > data\config.json
)
if not exist "data\attendance.json" echo [] > data\attendance.json
if not exist "data\events.json" echo [] > data\events.json

echo.
echo Done. Essential software is installed.
echo Start desktop:  npm start
echo Build installer: npm run dist
echo Start API only: npm run server
echo Or double-click start.bat
pause
