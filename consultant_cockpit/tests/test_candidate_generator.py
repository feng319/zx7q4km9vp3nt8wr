# tests/test_candidate_generator.py
import pytest
from unittest.mock import Mock, patch
from src.core.candidate_generator import CandidateGenerator, Candidate
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from datetime import datetime

@pytest.fixture
def mock_llm_client():
    """Mock LLM客户端"""
    return Mock()

@pytest.fixture
def consensus_chain():
    """测试用共识链"""
    chain = ConsensusChain()
    # 添加3条已确认事实
    for i in range(3):
        chain.add_record(ConsensusRecord(
            id=f"fact_{i}",
            timestamp=datetime.now(),
            type="fact",
            stage="战略梳理",
            content=f"事实{i}",
            source="manual",
            status="confirmed"
        ))
    # 添加1个待确认假设
    chain.add_record(ConsensusRecord(
        id="hypothesis_1",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="客户需要聚焦储能",
        source="manual",
        status="pending_client_confirm"
    ))
    return chain

def test_check_constraints_success(consensus_chain):
    """测试三约束检查通过"""
    generator = CandidateGenerator(Mock(), consensus_chain)
    # Mock备弹区有🟢SKU
    mock_skus = [{"id": "sku_001", "confidence": "🟢"}]
    result = generator.check_constraints(mock_skus)
    assert result["valid"] == True

def test_check_constraints_insufficient_facts():
    """测试事实数不足"""
    chain = ConsensusChain()
    chain.add_record(ConsensusRecord(
        id="fact_1",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="事实1",
        source="manual",
        status="confirmed"
    ))
    generator = CandidateGenerator(Mock(), chain)
    result = generator.check_constraints([])
    assert result["valid"] == False
    assert "建议先追问" in result["message"]

def test_generate_candidates(mock_llm_client, consensus_chain):
    """测试生成候选"""
    # Mock LLM返回
    mock_llm_client.generate.return_value = """
候选A: 聚焦储能主航道,稳健型策略
候选B: 多元化发展,平衡型策略
候选C: 轻资产转型,激进型策略
"""
    generator = CandidateGenerator(mock_llm_client, consensus_chain)
    candidates = generator.generate_candidates()
    assert len(candidates) == 3
    assert all(isinstance(c, Candidate) for c in candidates)
