@echo off
REM 顾问现场作战系统启动脚本
REM 自动使用虚拟环境中的 Python

cd /d "%~dp0"
set VENV_PYTHON=..\Anything2Ontology\.venv\Scripts\python.exe

if exist "%VENV_PYTHON%" (
    "%VENV_PYTHON%" -m streamlit run src\ui\main_app.py
) else (
    echo 虚拟环境未找到，请检查路径: %VENV_PYTHON%
    pause
)
