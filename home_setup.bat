@echo off
echo ================================================
echo   MediCloud Home Setup Script
echo ================================================
echo.

REM Reset to localhost
echo VITE_API_URL=http://localhost:8001/api > frontend\.env
echo.
echo .env reset to localhost
echo.

REM Rebuild frontend
echo Rebuilding frontend...
docker-compose up --build -d medicloud_frontend
echo.

echo ================================================
echo   Done! MediCloud running on localhost.
echo   Open: http://localhost:3001
echo ================================================
pause
