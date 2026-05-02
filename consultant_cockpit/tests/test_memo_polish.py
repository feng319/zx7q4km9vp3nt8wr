# tests/test_memo_polish.py
import pytest
from src.core.memo_generator import MemoGenerator
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from datetime import datetime


@pytest.fixture
def chain_with_data():
    """测试用共识链（含确认数据）"""
    chain = ConsensusChain()
    chain.add_record(ConsensusRecord(
        id="fact_1", timestamp=datetime.now(), type="fact",
        stage="战略梳理", content="客户产品线5条",
        source="manual", status="confirmed"
    ))
    chain.add_record(ConsensusRecord(
        id="consensus_1", timestamp=datetime.now(), type="consensus",
        stage="战略梳理", content="客户认可聚焦储能",
        source="candidate_selected", status="confirmed",
        recommendation="聚焦储能主航道"
    ))
    return chain


def test_polish_chapter_fallback_when_no_llm(chain_with_data):
    """测试无LLM时降级为要点列表"""
    generator = MemoGenerator(chain_with_data, llm_client=None)
    chapter_data = {"方向": "聚焦储能", "依据": "客户认可"}

    result = generator.polish_chapter(chapter_data)

    # 降级时应返回要点列表格式
    assert "-" in result
    assert "聚焦储能" in result


def test_polish_chapter_truncation(chain_with_data):
    """测试字数截断不破坏内容完整性"""
    class MockLLM:
        def generate(self, prompt, temperature=0.3):
            return "这是一段非常长的润色结果" * 50  # 生成超长文本

    generator = MemoGenerator(chain_with_data, llm_client=MockLLM())
    chapter_data = {"方向": "聚焦储能"}

    result = generator.polish_chapter(chapter_data, max_words=50)

    # 截断后不应超过 max_words + 3（"..."的长度）
    assert len(result) <= 53
    assert result.endswith("...")


def test_polish_chapter_llm_exception_fallback(chain_with_data):
    """测试LLM调用异常时降级为要点列表"""
    class BrokenLLM:
        def generate(self, prompt, temperature=0.3):
            raise ConnectionError("API不可用")

    generator = MemoGenerator(chain_with_data, llm_client=BrokenLLM())
    chapter_data = {"方向": "聚焦储能", "依据": "客户认可"}

    result = generator.polish_chapter(chapter_data)

    # 异常时应降级为要点列表
    assert "-" in result
    assert "聚焦储能" in result
