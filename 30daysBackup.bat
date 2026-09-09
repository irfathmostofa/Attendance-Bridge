@echo off
:Start
echo Running code...

node backup.js

timeout /t 10 /nobreak > nul
goto Start
```




