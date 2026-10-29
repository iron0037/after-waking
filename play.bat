@echo off
rem After Waking: start the dev server and open the game in your browser.
rem Uses npm.cmd directly, so PowerShell's script execution policy doesn't matter.
cd /d "%~dp0"

rem Already running (another play.bat window)? Just open the game.
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo The game server is already running. Opening the game...
  start "" http://localhost:5173
  exit /b 0
)

if not exist node_modules (
  echo Installing dependencies...
  call "C:\Program Files\nodejs\npm.cmd" install
)
rem Vite opens the browser itself once the server is ready (--open), so the page
rem never loads before the server is listening.
call "C:\Program Files\nodejs\npm.cmd" run dev -- --open
