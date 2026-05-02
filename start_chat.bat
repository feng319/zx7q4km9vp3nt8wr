@echo off
REM 知识副驾启动脚本
REM 使用系统 Python 3.12 直接启动，无需虚拟环境

cd /d "%~dp0"
"C:\Users\56839\AppData\Local\Programs\Python\Python312\python.exe" -m streamlit run chat_ontology.py
