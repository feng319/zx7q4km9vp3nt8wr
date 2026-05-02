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

    def __init__(self, feishu_client=None):
        self.records: List[ConsensusRecord] = []
        self.feishu_client = feishu_client

    def add_record(self, record: ConsensusRecord, sync_to_feishu: bool = True):
        """添加记录（可选同步到飞书）

        Args:
            record: 共识记录
            sync_to_feishu: 是否同步到飞书（默认 True）
        """
        self.records.append(record)

        if sync_to_feishu and self.feishu_client:
            try:
                self.feishu_client.sync_consensus_record(record.model_dump())
            except Exception as e:
                # 飞书同步失败不影响本地记录
                print(f"飞书同步失败: {e}")

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