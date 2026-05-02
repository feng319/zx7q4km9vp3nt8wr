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

def test_superseded_facts_excluded():
    """测试被修正的事实不进入备忘录"""
    chain = ConsensusChain()
    # 添加一条正常确认的事实
    chain.add_record(ConsensusRecord(
        id="fact_normal",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="正常事实",
        source="manual",
        status="confirmed"
    ))
    # 添加一条被替代的事实
    chain.add_record(ConsensusRecord(
        id="fact_superseded",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="被修正的旧事实",
        source="manual",
        status="superseded"
    ))

    generator = MemoGenerator(chain)
    data = generator.extract_data()
    contents = [f["content"] for f in data["facts"]]

    assert "正常事实" in contents
    assert "被修正的旧事实" not in contents

def test_strip_metadata():
    """测试元数据剥离"""
    chain = ConsensusChain()
    chain.add_record(ConsensusRecord(
        id="consensus_1",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="测试判断",
        source="candidate_selected",
        status="confirmed",
        recommendation="测试方向"
    ))

    generator = MemoGenerator(chain)
    structure = generator.generate_structure()

    # 检查结构中有"来源"字段
    assert "来源" in structure["chapters"]["初步建议方向"][0]

    # 检查 _strip_metadata 能正确剥离
    clean = generator._strip_metadata(structure["chapters"]["初步建议方向"][0])
    assert "来源" not in clean
    assert "方向" in clean