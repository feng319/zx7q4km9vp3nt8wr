@echo off
chcp 65001 >nul 2>nul
echo ====================================
echo Consultant Cockpit - Starting...
echo ====================================
echo.

REM Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found, please install Node.js 18+
    pause
    exit /b 1
)

REM Check node_modules
if not exist "node_modules" (
    echo [INFO] First run, installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Check .env file
if not exist ".env" (
    echo [WARN] .env not found, please copy .env.example and configure
    pause
    exit /b 1
)

echo [START] Server running at http://localhost:8501
echo [TIP] Press Ctrl+C to stop
echo.

node server.js

pause
