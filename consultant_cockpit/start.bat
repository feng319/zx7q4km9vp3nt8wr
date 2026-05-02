@echo off
REM 顾问现场作战系统启动脚本
REM 使用系统 Python 3.12 直接启动，无需虚拟环境

cd /d "%~dp0"
"C:\Users\56839\AppData\Local\Programs\Python\Python312\python.exe" -m streamlit run src\ui\main_app.py
