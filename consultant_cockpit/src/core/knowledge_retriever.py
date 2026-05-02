# src/core/knowledge_retriever.py
from typing import List, Dict, Optional
from datetime import datetime
from pydantic import BaseModel
import json
from pathlib import Path


class SKUCard(BaseModel):
    """SKU弹药卡片"""
    id: str
    title: str
    summary: str
    confidence: str  # 🟢/🟡/🔴
    stage: str
    recalled_at: datetime  # 召回时间戳，用于3分钟半透明化


class KnowledgeRetriever:
    """知识召回器"""

    def __init__(self, keywords_path: str = "config/keywords.json"):
        self.keywords = self._load_keywords(keywords_path)
        self.sku_cache: List[SKUCard] = []  # 备弹区缓存
        self.last_recall_time: Optional[datetime] = None

    def _load_keywords(self, path: str) -> List[Dict]:
        """加载关键词词典"""
        full_path = Path(__file__).parent.parent.parent / path
        with open(full_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("keywords", [])

    def match_keywords(self, text: str) -> List[str]:
        """从文本中匹配关键词"""
        matched = []
        text_lower = text.lower()
        for kw in self.keywords:
            if kw["concept"] in text:
                matched.append(kw["concept"])
                continue
            for syn in kw.get("synonyms", []):
                if syn.lower() in text_lower:
                    matched.append(kw["concept"])
                    break
        return list(set(matched))

    def recall_by_keywords(self, keywords: List[str], top_k: int = 3) -> List[SKUCard]:
        """根据关键词召回SKU（Day 2使用mock数据，Day 3接入真实知识库）"""
        # Mock SKU数据
        mock_skus = [
            SKUCard(
                id="sku_001",
                title="设备商转运营商路径",
                summary="从设备销售转向运营服务的典型案例",
                confidence="🟢",
                stage="商业模式",
                recalled_at=datetime.now()
            ),
            SKUCard(
                id="sku_002",
                title="储能系统集成商商业模式",
                summary="工商业储能系统集成商的盈利模式分析",
                confidence="🟡",
                stage="商业模式",
                recalled_at=datetime.now()
            ),
            SKUCard(
                id="sku_003",
                title="虚拟电厂聚合商案例",
                summary="负荷聚合商参与电力市场的路径",
                confidence="🟢",
                stage="战略梳理",
                recalled_at=datetime.now()
            )
        ]

        # 按关键词过滤（简化版，实际需要embedding）
        recalled = []
        for sku in mock_skus:
            for kw in keywords:
                if kw in sku.title or kw in sku.summary:
                    recalled.append(sku)
                    break

        # 更新缓存和时间戳
        if recalled:
            self.sku_cache = recalled[:top_k]
            self.last_recall_time = datetime.now()

        return self.sku_cache

    def get_fresh_skus(self, max_age_seconds: int = 180) -> List[SKUCard]:
        """获取新鲜度合格的SKU（3分钟以上的半透明化）"""
        now = datetime.now()
        fresh_skus = []
        for sku in self.sku_cache:
            age = (now - sku.recalled_at).total_seconds()
            if age <= max_age_seconds:
                fresh_skus.append(sku)
        return fresh_skus

    def check_rate_limit(self, min_interval_seconds: int = 5) -> bool:
        """检查召回限流（同一关键词5秒内不重复触发）"""
        if not self.last_recall_time:
            return True
        elapsed = (datetime.now() - self.last_recall_time).total_seconds()
        return elapsed >= min_interval_seconds
