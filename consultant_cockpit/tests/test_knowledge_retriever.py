# tests/test_knowledge_retriever.py
import pytest
from datetime import datetime, timedelta
from src.core.knowledge_retriever import KnowledgeRetriever, SKUCard


def test_match_keywords():
    """测试关键词匹配"""
    retriever = KnowledgeRetriever()
    matched = retriever.match_keywords("客户想做虚拟电厂业务")
    assert "虚拟电厂" in matched


def test_recall_by_keywords():
    """测试关键词召回"""
    retriever = KnowledgeRetriever()
    skus = retriever.recall_by_keywords(["虚拟电厂"])
    assert len(skus) <= 3
    assert all(isinstance(sku, SKUCard) for sku in skus)
    # 验证时间戳
    assert all(sku.recalled_at is not None for sku in skus)


def test_sku_timestamp():
    """测试SKU时间戳（用于3分钟半透明化）"""
    retriever = KnowledgeRetriever()
    retriever.recall_by_keywords(["储能"])

    # 模拟3分钟后的SKU
    old_sku = SKUCard(
        id="sku_old",
        title="旧SKU",
        summary="3分钟前的召回",
        confidence="🟢",
        stage="战略梳理",
        recalled_at=datetime.now() - timedelta(minutes=4)
    )
    retriever.sku_cache.append(old_sku)

    fresh = retriever.get_fresh_skus(max_age_seconds=180)
    assert len(fresh) < len(retriever.sku_cache)  # 旧SKU被过滤


def test_rate_limit():
    """测试召回限流"""
    retriever = KnowledgeRetriever()
    retriever.recall_by_keywords(["储能"])

    # 立即再次召回应该被限流
    assert not retriever.check_rate_limit(min_interval_seconds=5)
