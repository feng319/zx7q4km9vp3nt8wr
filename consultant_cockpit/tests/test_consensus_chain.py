# tests/test_consensus_chain.py
import pytest
from datetime import datetime
from src.core.consensus_chain import ConsensusRecord, ConsensusChain

def test_create_consensus_record():
    """测试创建共识记录"""
    record = ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="客户产品线5条",
        source="manual",
        status="recorded"
    )
    assert record.id == "cc_001"
    assert record.type == "fact"
    assert record.status == "recorded"

def test_consensus_chain_add_record():
    """测试共识链添加记录"""
    chain = ConsensusChain()
    record = ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="客户产品线5条",
        source="manual",
        status="recorded"
    )
    chain.add_record(record)
    assert len(chain.records) == 1
    assert chain.get_record("cc_001") == record

def test_consensus_chain_confirm_record():
    """测试确认共识记录"""
    chain = ConsensusChain()
    record = ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="客户认可聚焦储能",
        source="candidate_selected",
        status="pending_client_confirm"
    )
    chain.add_record(record)
    chain.confirm_record("cc_001")
    assert chain.get_record("cc_001").status == "confirmed"

def test_consensus_chain_get_confirmed_facts():
    """测试获取已确认的事实"""
    chain = ConsensusChain()
    chain.add_record(ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="事实1",
        source="manual",
        status="confirmed"
    ))
    chain.add_record(ConsensusRecord(
        id="cc_002",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="事实2",
        source="manual",
        status="recorded"
    ))
    facts = chain.get_confirmed_facts()
    assert len(facts) == 1
    assert facts[0].content == "事实1"
