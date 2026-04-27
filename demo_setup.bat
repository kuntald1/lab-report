@echo off
echo ================================================
echo   MediCloud Demo Setup Script
echo ================================================
echo.

REM Get current IP address
echo Your current IP addresses:
ipconfig | findstr "IPv4"
echo.

REM Ask for IP
set /p LAPTOP_IP="Enter your laptop IP for demo (e.g. 192.168.0.50): "

REM Update .env file
echo VITE_API_URL=http://%LAPTOP_IP%:8001/api > frontend\.env
echo.
echo .env updated to: http://%LAPTOP_IP%:8001/api
echo.

REM Rebuild frontend only
echo Rebuilding frontend with new IP...
docker-compose up --build -d medicloud_frontend
echo.

echo ================================================
echo   Done! MediCloud is ready for demo.
echo.
echo   Open on YOUR laptop:   http://localhost:3001
echo   Open on CLIENT device: http://%LAPTOP_IP%:3001
echo   API:                   http://%LAPTOP_IP%:8001/docs
echo ================================================
pause
