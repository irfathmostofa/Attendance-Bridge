@echo off
setlocal
cd /d "%~dp0"
echo Creating a local backup (30-day retention is handled by the app)...
node -e "fetch('http://127.0.0.1:3780/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'scheduled'})}).then(r=>r.json()).then(d=>{console.log(d.name||d.file||d.message||d); if(!d.ok && d.ok!==undefined) process.exit(1)}).catch(e=>{console.error('App is not running. Start Attendance Bridge first.'); process.exit(1)})"
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Done.
