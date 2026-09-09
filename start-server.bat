@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\express" call install.bat
echo Starting Attendance Bridge API on port 3780...
node server\index.js
