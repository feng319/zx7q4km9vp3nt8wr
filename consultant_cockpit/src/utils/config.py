# src/utils/config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """配置管理"""
    # LLM配置
    LLM_API_KEY = os.getenv("OPENAI_API_KEY", "")
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4")

    # 候选生成配置
    CANDIDATE_MAX_REGENERATE = 2  # 最大重生成次数
    CANDIDATE_MIN_FACTS = 3  # 最少事实数
    CANDIDATE_SIMILARITY_THRESHOLD = 0.85  # 差异度阈值

    # 服务包定价(从配置文件读取)
    SERVICE_PACKAGES = {
        "deep_diagnosis": {"name": "初步诊断深化", "price": 599},
        "business_model": {"name": "商业模式专项咨询", "price": 1999},
        "strategy_workshop": {"name": "战略主线确认工作坊", "price": 19800},
    }
