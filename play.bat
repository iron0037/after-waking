@echo off
rem After Waking: start the dev server and open the game in your browser.
rem Uses npm.cmd directly, so PowerShell's script execution policy doesn't matter.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call "C:\Program Files\nodejs\npm.cmd" install
)
start "" http://localhost:5173
call "C:\Program Files\nodejs\npm.cmd" run dev
