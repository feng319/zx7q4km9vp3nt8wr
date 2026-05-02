# src/core/consensus_chain.py
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field

class ConsensusRecord(BaseModel):
    """共识链记录"""
    id: str
    timestamp: datetime
    type: Literal["fact", "consensus"]
    stage: Literal["战略梳理", "商业模式", "行业演示"]
    content: str
    source: Literal["manual", "candidate_selected", "ai_suggested", "manual_correction"]
    evidence_sku: List[str] = Field(default_factory=list)
    status: Literal["recorded", "pending_client_confirm", "confirmed", "superseded"] = "recorded"
    confidence: Optional[Literal["high", "medium", "low"]] = None
    replaces: Optional[str] = None
    superseded_by: Optional[str] = None
    feishu_record_id: Optional[str] = None
    recommendation: Optional[str] = None  # 仅consensus类有

class ConsensusChain:
    """共识链管理器"""
    def __init__(self):
        self.records: List[ConsensusRecord] = []

    def add_record(self, record: ConsensusRecord):
        """添加记录"""
        self.records.append(record)

    def get_record(self, record_id: str) -> Optional[ConsensusRecord]:
        """获取记录"""
        for record in self.records:
            if record.id == record_id:
                return record
        return None

    def confirm_record(self, record_id: str):
        """确认记录"""
        record = self.get_record(record_id)
        if record:
            record.status = "confirmed"

    def get_confirmed_facts(self) -> List[ConsensusRecord]:
        """获取已确认的事实（排除已被替代的记录）"""
        return [
            r for r in self.records
            if r.type == "fact" and r.status == "confirmed"
        ]

    def get_confirmed_consensus(self) -> List[ConsensusRecord]:
        """获取已确认的判断（排除已被替代的记录）"""
        return [
            r for r in self.records
            if r.type == "consensus" and r.status == "confirmed"
        ]

    def get_pending_consensus(self) -> List[ConsensusRecord]:
        """获取待确认的判断"""
        return [
            r for r in self.records
            if r.status == "pending_client_confirm"
        ]

    def get_active_records(self) -> List[ConsensusRecord]:
        """获取所有有效记录（排除已被替代的记录）"""
        return [
            r for r in self.records
            if r.status != "superseded"
        ]