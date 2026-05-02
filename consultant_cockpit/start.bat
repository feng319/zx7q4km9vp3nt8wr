@echo off
REM 顾问现场作战系统启动脚本
REM 使用系统 Python 直接启动，无需虚拟环境

cd /d "%~dp0"
python -m streamlit run src\ui\main_app.py
