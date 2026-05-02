# tests/test_fallback_handler.py
"""降级处理器单元测试

根据设计文档 11.3 节测试用例：
- 飞书API失败降级测试
- LLM超时降级测试
- 知识库召回失败降级测试
- Word生成失败降级测试
- 降级链测试
"""
import pytest
import time
from unittest.mock import Mock, MagicMock
from concurrent.futures import TimeoutError as FuturesTimeoutError

from src.core.fallback_handler import (
    FallbackType,
    FallbackResult,
    FallbackHandler,
    FallbackChain,
    FALLBACK_TEMPLATES,
    get_fallback_template
)


# ============= 基础测试 =============

def test_fallback_type_enum():
    """测试降级类型枚举"""
    assert FallbackType.FEISHU_API.value == "feishu_api"
    assert FallbackType.LLM_TIMEOUT.value == "llm_timeout"
    assert FallbackType.KNOWLEDGE_RECALL.value == "knowledge_recall"
    assert FallbackType.WORD_GENERATION.value == "word_generation"


def test_fallback_result_dataclass():
    """测试降级结果数据结构"""
    result = FallbackResult(
        success=True,
        fallback_type=FallbackType.FEISHU_API,
        message="测试消息",
        data={"key": "value"},
        original_error="原始错误"
    )

    assert result.success == True
    assert result.fallback_type == FallbackType.FEISHU_API
    assert result.message == "测试消息"
    assert result.data == {"key": "value"}
    assert result.original_error == "原始错误"
    assert result.timestamp is not None


def test_fallback_templates():
    """测试预设降级模板"""
    assert "diagnosis_hypothesis" in FALLBACK_TEMPLATES
    assert "strategy_questions" in FALLBACK_TEMPLATES
    assert "business_questions" in FALLBACK_TEMPLATES
    assert "demo_scripts" in FALLBACK_TEMPLATES
    assert "risk_responses" in FALLBACK_TEMPLATES

    # 获取模板
    template = get_fallback_template("diagnosis_hypothesis")
    assert len(template) > 0

    # 不存在的模板
    empty = get_fallback_template("non_existent")
    assert empty == ""


# ============= FallbackHandler 测试 =============

def test_handler_init():
    """测试初始化"""
    handler = FallbackHandler(max_workers=3)

    assert handler.fallback_counts[FallbackType.FEISHU_API] == 0
    assert len(handler.fallback_history) == 0
    assert handler._executor is not None


def test_handle_feishu_failure():
    """测试飞书API失败处理"""
    handler = FallbackHandler()

    result = handler.handle_feishu_failure(
        operation="list_records",
        error=Exception("网络超时")
    )

    assert result.success == True
    assert result.fallback_type == FallbackType.FEISHU_API
    assert "本地缓存" in result.message or "手动同步" in result.message
    assert result.data["local_cached"] == True

    # 统计增加
    assert handler.fallback_counts[FallbackType.FEISHU_API] == 1


def test_handle_lark_cli_failure():
    """测试 lark-cli 失败处理"""
    handler = FallbackHandler()

    result = handler.handle_lark_cli_failure(
        operation="base query",
        error=Exception("命令执行失败"),
        max_retries=3
    )

    assert result.success == True
    assert result.fallback_type == FallbackType.LARK_CLI
    assert result.data["retry_available"] == True
    assert result.data["max_retries"] == 3


def test_handle_llm_timeout_success():
    """测试LLM正常响应"""
    handler = FallbackHandler()

    # Mock 快速响应的生成器
    def quick_generator():
        return "快速生成的文本"

    result = handler.handle_llm_timeout(
        generator=quick_generator,
        timeout_seconds=5,
        fallback_value="降级值"
    )

    assert result.success == True
    assert result.data["result"] == "快速生成的文本"


def test_handle_llm_timeout_fallback():
    """测试LLM超时降级"""
    handler = FallbackHandler()

    # Mock 慢速生成器
    def slow_generator():
        time.sleep(15)  # 超过超时时间
        return "慢速生成的文本"

    result = handler.handle_llm_timeout(
        generator=slow_generator,
        timeout_seconds=2,
        fallback_value="降级模板内容"
    )

    assert result.success == False
    assert "超时" in result.message
    assert result.data["fallback_value"] == "降级模板内容"


def test_handle_llm_timeout_exception():
    """测试LLM异常降级"""
    handler = FallbackHandler()

    # Mock 会抛出异常的生成器
    def failing_generator():
        raise ValueError("API错误")

    result = handler.handle_llm_timeout(
        generator=failing_generator,
        timeout_seconds=5,
        fallback_value="降级值"
    )

    assert result.success == False
    assert "API错误" in result.original_error


def test_handle_knowledge_recall_success():
    """测试知识库召回成功"""
    handler = FallbackHandler()

    # Mock 知识召回器
    from src.core.knowledge_retriever import SKUCard

    mock_retriever = Mock()
    mock_retriever.recall_by_keywords = Mock(return_value=[
        SKUCard(id="sku_001", title="测试SKU", summary="摘要", confidence="🟢", stage="测试")
    ])

    result = handler.handle_knowledge_recall_failure(
        manual_query="储能",
        knowledge_retriever=mock_retriever,
        top_k=5
    )

    assert result.success == True
    assert len(result.data["results"]) == 1


def test_handle_knowledge_recall_empty():
    """测试知识库召回无结果"""
    handler = FallbackHandler()

    mock_retriever = Mock()
    mock_retriever.recall_by_keywords = Mock(return_value=[])

    result = handler.handle_knowledge_recall_failure(
        manual_query="不存在的关键词",
        knowledge_retriever=mock_retriever,
        top_k=5
    )

    assert result.success == False
    assert len(result.data["results"]) == 0


def test_handle_knowledge_recall_exception():
    """测试知识库召回异常"""
    handler = FallbackHandler()

    mock_retriever = Mock()
    mock_retriever.recall_by_keywords = Mock(side_effect=Exception("召回失败"))

    result = handler.handle_knowledge_recall_failure(
        manual_query="测试",
        knowledge_retriever=mock_retriever,
        top_k=5
    )

    assert result.success == False
    assert "召回失败" in result.original_error


def test_handle_word_generation_failure():
    """测试Word生成失败降级"""
    handler = FallbackHandler()

    content = {
        "diagnosis_hypothesis": "测试假设",
        "strategy_questions": ["问题1", "问题2"],
        "nested": {"key": "value"}
    }

    result = handler.handle_word_generation_failure(
        content=content,
        error=Exception("docx生成失败")
    )

    assert result.success == True
    assert result.fallback_type == FallbackType.WORD_GENERATION
    assert result.data["format"] == "plain_text"
    assert len(result.data["text_content"]) > 0


def test_convert_to_text():
    """测试内容转纯文本"""
    handler = FallbackHandler()

    content = {
        "title": "标题",
        "items": ["项目1", "项目2"],
        "nested": {"key1": "值1", "key2": "值2"}
    }

    text = handler._convert_to_text(content)

    assert "标题" in text
    assert "项目1" in text
    assert "nested" in text


def test_get_fallback_report():
    """测试降级统计报告"""
    handler = FallbackHandler()

    # 产生几次降级
    handler.handle_feishu_failure("op1", Exception("e1"))
    handler.handle_feishu_failure("op2", Exception("e2"))
    handler.handle_lark_cli_failure("op3", Exception("e3"))

    report = handler.get_fallback_report()

    assert report["total_fallbacks"] == 3
    assert report["by_type"]["feishu_api"] == 2
    assert report["by_type"]["lark_cli"] == 1
    assert len(report["recent_fallbacks"]) == 3


def test_clear_history():
    """测试清除历史"""
    handler = FallbackHandler()

    handler.handle_feishu_failure("op", Exception("e"))
    assert len(handler.fallback_history) == 1

    handler.clear_history()
    assert len(handler.fallback_history) == 0
    assert handler.fallback_counts[FallbackType.FEISHU_API] == 0


def test_shutdown():
    """测试关闭线程池"""
    handler = FallbackHandler()
    handler.shutdown()

    # 验证线程池已关闭（后续操作应该安全）
    # 注意：shutdown 后不应再使用 handler


# ============= FallbackChain 测试 =============

def test_fallback_chain_success():
    """测试降级链主函数成功"""
    handler = FallbackHandler()
    chain = FallbackChain(handler)

    # 主函数成功
    def primary_func():
        return "主函数结果"

    result = chain.execute(primary_func)
    assert result == "主函数结果"


def test_fallback_chain_fallback():
    """测试降级链降级执行"""
    handler = FallbackHandler()
    chain = FallbackChain(handler)

    # 主函数失败
    def primary_func():
        raise Exception("主函数失败")

    # 第一个降级方案
    def fallback1():
        return "降级方案1结果"

    chain.add(fallback1)

    result = chain.execute(primary_func)
    assert result == "降级方案1结果"


def test_fallback_chain_multiple_fallbacks():
    """测试降级链多级降级"""
    handler = FallbackHandler()
    chain = FallbackChain(handler)

    def primary_func():
        raise Exception("主函数失败")

    def fallback1():
        raise Exception("降级方案1失败")

    def fallback2():
        return "降级方案2结果"

    chain.add(fallback1)
    chain.add(fallback2)

    result = chain.execute(primary_func)
    assert result == "降级方案2结果"


def test_fallback_chain_all_fail():
    """测试降级链全部失败"""
    handler = FallbackHandler()
    chain = FallbackChain(handler)

    def primary_func():
        raise Exception("主函数失败")

    def fallback1():
        raise Exception("降级方案1失败")

    chain.add(fallback1)

    with pytest.raises(Exception) as exc_info:
        chain.execute(primary_func)

    assert "主函数失败" in str(exc_info.value)