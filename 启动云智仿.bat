@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 云智仿
node "tools\probe.mjs" >nul 2>&1
if not errorlevel 1 goto open
echo 正在启动本地服务（首次启动约需 1-3 秒）...
start "云智仿服务" /min cmd /c node "server\index.mjs"
set /a n=0
:wait
node "tools\probe.mjs" >nul 2>&1
if not errorlevel 1 goto open
set /a n+=1
if %n% GEQ 25 goto fail
ping -n 2 127.0.0.1 >nul
goto wait
:fail
echo 服务启动超时：请在项目目录执行 node server\index.mjs 查看报错。
pause
exit /b 1
:open
start "" "http://127.0.0.1:5174/"
exit /b 0
