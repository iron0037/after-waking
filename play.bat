@echo off
rem After Waking: start the dev server and open the game in your browser.
rem Uses npm.cmd directly, so PowerShell's script execution policy doesn't matter.
rem Vite opens the browser itself once the server is ready (--open), so the page
rem never loads before the server is listening.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call "C:\Program Files\nodejs\npm.cmd" install
)
call "C:\Program Files\nodejs\npm.cmd" run dev -- --open
