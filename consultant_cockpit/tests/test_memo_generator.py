# tests/test_memo_generator.py
import pytest
from src.core.memo_generator import MemoGenerator
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from datetime import datetime

@pytest.fixture
def consensus_chain():
    """测试用共识链"""
    chain = ConsensusChain()
    # 添加事实
    chain.add_record(ConsensusRecord(
        id="fact_1",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="客户产品线5条",
        source="manual",
        status="confirmed"
    ))
    # 添加判断
    chain.add_record(ConsensusRecord(
        id="consensus_1",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="客户认可聚焦储能",
        source="candidate_selected",
        status="confirmed",
        recommendation="聚焦储能主航道"
    ))
    return chain

def test_extract_data(consensus_chain):
    """测试数据提取"""
    generator = MemoGenerator(consensus_chain)
    data = generator.extract_data()

    assert "facts" in data
    assert len(data["facts"]) == 1
    assert data["facts"][0]["content"] == "客户产品线5条"

    assert "consensus" in data
    assert len(data["consensus"]) == 1

def test_generate_memo_structure(consensus_chain):
    """测试生成备忘录结构"""
    generator = MemoGenerator(consensus_chain)
    structure = generator.generate_structure()

    assert "chapters" in structure
    assert "关键发现" in structure["chapters"]
    assert "初步建议方向" in structure["chapters"]