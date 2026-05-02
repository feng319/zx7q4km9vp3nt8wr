"""顾问现场作战系统启动脚本"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# 运行 Streamlit
if __name__ == "__main__":
    import streamlit.cli
    streamlit.cli.main_run(["src/ui/main_app.py", "--server.port=8501"])
