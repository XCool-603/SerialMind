@echo off
REM ============================================================
REM  SerialMind desktop build
REM  The Windows SDK on this machine is registered but incomplete,
REM  so vcvars64.bat cannot assemble LIB/INCLUDE. Set them here.
REM  NOTE: use goto instead of "if (...)" blocks, because paths
REM  containing "Program Files (x86)" break cmd block parsing.
REM  Usage: scripts\build-desktop.cmd
REM ============================================================
setlocal

set "VCROOT=D:\VS2022BuildTools\VC\Tools\MSVC\14.44.35207"
set "SDKROOT=C:\Program Files (x86)\Windows Kits\10"
set "SDKVER=10.0.22621.0"

if not exist "%VCROOT%\lib\x64\libcpmt.lib" goto :no_msvc
if not exist "%SDKROOT%\Lib\%SDKVER%\um\x64\kernel32.lib" goto :no_sdk

set "PATH=%VCROOT%\bin\Hostx64\x64;%SDKROOT%\bin\%SDKVER%\x64;%PATH%"
set "LIB=%VCROOT%\lib\x64;%SDKROOT%\Lib\%SDKVER%\um\x64;%SDKROOT%\Lib\%SDKVER%\ucrt\x64"
set "INCLUDE=%VCROOT%\include;%SDKROOT%\Include\%SDKVER%\ucrt;%SDKROOT%\Include\%SDKVER%\um;%SDKROOT%\Include\%SDKVER%\shared;%SDKROOT%\Include\%SDKVER%\winrt"

echo [INFO] VCROOT = %VCROOT%
echo [INFO] SDK    = %SDKROOT%\%SDKVER%
echo [INFO] Building SerialMind desktop...

cd /d "%~dp0.."
call npx tauri build
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%

:no_msvc
echo [ERROR] MSVC x64 libs not found: %VCROOT%\lib\x64
endlocal & exit /b 1

:no_sdk
echo [ERROR] Windows SDK x64 libs not found: %SDKROOT%\Lib\%SDKVER%\um\x64
echo         Install "Windows 11 SDK" component, or drop the import libs there.
endlocal & exit /b 1
