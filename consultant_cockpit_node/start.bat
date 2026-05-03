@echo off
chcp 65001 >nul
echo ====================================
echo 顾问现场作战系统 - 启动中...
echo ====================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

REM 检查 node_modules
if not exist "node_modules" (
    echo [提示] 首次运行，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

REM 检查 .env 文件
if not exist ".env" (
    echo [警告] 未找到 .env 文件，请复制 .env.example 并填写真实配置
    pause
    exit /b 1
)

echo [启动] 服务运行在 http://localhost:8501
echo [提示] 按 Ctrl+C 停止服务
echo.

node server.js

pause
