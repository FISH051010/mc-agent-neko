@echo off
chcp 65001 >nul 2>&1
title mc-agent
cd /d "%~dp0"

rem ==========================================================================
rem  KEEP THIS FILE PURE ASCII.
rem  (Chinese rationale + full test matrix: see BUILD-WIN-ZIP.md, the section
rem   about why the launcher .bat must stay ASCII.)
rem
rem  cmd.exe's batch parser mis-tracks file offsets across multi-byte
rem  characters.  Any non-ASCII text written directly in a .bat makes cmd
rem  resume parsing in the middle of a line and execute the tail as a command:
rem      'xxxx' is not recognized as an internal or external command
rem  Measured 2026-08-07 on Win11: broken in ALL 18 combinations of
rem      {utf8+BOM, utf8, gbk} x {chcp 65001, chcp 936, no chcp}
rem      x {console codepage 936, 65001}
rem  A UTF-8 BOM does NOT help.  The only thing that works is an ASCII-only
rem  .bat that prints Chinese by `type`-ing a UTF-8 (no BOM) file under
rem  chcp 65001.  All Chinese strings therefore live in app\dist-msg\*.txt.
rem  tools\build-win-zip.ps1 asserts this file is ASCII-only -- if you add
rem  Chinese here the build will refuse to produce a package.
rem
rem  `cd /d "%~dp0"` above is the foundation of the portable layout: the
rem  program treats the folder holding this .bat as the user layer
rem  (bot.json / settings.json / skins / keys.json).  Without it the working
rem  directory on double-click would be C:\Windows\System32.
rem ==========================================================================

set "MSGDIR=%~dp0app\dist-msg"

if not exist "%~dp0node\node.exe" goto :incomplete
if not exist "%~dp0app\main.js"   goto :incomplete

call :say startup

rem Heap limit and GC switch match the flags the program itself uses when it
rem spawns its agent child process.  Without them long mining/chopping runs hit
rem Node's default ~2GB heap cap and the process dies.
"%~dp0node\node.exe" --max-old-space-size=8192 --expose-gc "%~dp0app\main.js"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" goto :crashed
call :say stopped
goto :done

:crashed
call :say crashed
goto :done

:incomplete
set "EXITCODE=1"
call :say incomplete
goto :done

:done
echo.
pause
exit /b %EXITCODE%

rem --- print a UTF-8 message file, with an ASCII fallback if it is missing ---
:say
if exist "%MSGDIR%\%~1.txt" type "%MSGDIR%\%~1.txt"
if not exist "%MSGDIR%\%~1.txt" echo   [!] Package is incomplete. Please unzip ALL files into one folder and retry.
goto :eof
