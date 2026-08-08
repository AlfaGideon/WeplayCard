@echo off
setlocal
cd /d "%~dp0"

REM --- 1) Пытаемся поднять локальный сервер (Python или Node) ---
set "SERVER_CMD="
where py >nul 2>nul        && set "SERVER_CMD=py serve.py"
if not defined SERVER_CMD ( where python >nul 2>nul  && set "SERVER_CMD=python serve.py" )
if not defined SERVER_CMD ( where python3 >nul 2>nul && set "SERVER_CMD=python3 serve.py" )
if not defined SERVER_CMD ( where node >nul 2>nul   && set "SERVER_CMD=node server.js" )

if defined SERVER_CMD (
  start "WeplayCard" cmd /c "%SERVER_CMD%"
  timeout /t 2 >nul
  start "" http://localhost:8000
  goto :done
)

REM --- 2) Иначе открываем автономный файл (без сервера, офлайн) ---
if exist "weplaycard-standalone.html" (
  start "" "%~dp0weplaycard-standalone.html"
  goto :done
)

echo.
echo  Ne najdeny Python/Node i net weplaycard-standalone.html.
echo  Postav Python (python.org) ili Node.js (nodejs.org) i povtori.
echo.
pause

:done
endlocal
