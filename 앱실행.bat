@echo off
chcp 65001 > nul
echo.
echo  맛집찾기 앱을 시작합니다...
echo.
start "" "http://localhost:8080/"
powershell -ExecutionPolicy Bypass -File "%~dp0서버시작.ps1"
pause
