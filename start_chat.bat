@echo off
REM 知识副驾启动脚本
REM 使用系统 Python 直接启动，无需虚拟环境

cd /d "%~dp0"
python -m streamlit run chat_ontology.py
