# src/core/consensus_chain.py
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from src.utils.logger import get_logger

_logger = get_logger("consensus_chain")

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
                _logger.warning(f"飞书同步失败: {e}")

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

    def correct_record(self, record_id: str, new_content: str, source: str = "manual_correction") -> ConsensusRecord:
        """修正记录（不覆盖原记录，新增一条修正记录）

        设计文档 4.1 节要求：
        - 原记录标记为 superseded
        - 新记录 source=manual_correction，replaces 指向原记录

        Args:
            record_id: 要修正的记录ID
            new_content: 修正后的内容
            source: 修正来源（默认 manual_correction）

        Returns:
            新创建的修正记录
        """
        original = self.get_record(record_id)
        if not original:
            raise ValueError(f"找不到记录: {record_id}")

        # 创建新记录
        new_record = ConsensusRecord(
            id=f"{record_id}_corr_{len(self.records)}",
            timestamp=datetime.now(),
            type=original.type,
            stage=original.stage,
            content=new_content,
            source=source,
            evidence_sku=original.evidence_sku.copy(),
            status="confirmed",
            replaces=record_id
        )

        # 标记原记录为已替代
        original.status = "superseded"
        original.superseded_by = new_record.id

        # 添加新记录
        self.records.append(new_record)

        return new_record

    def get_superseded_records(self) -> List[ConsensusRecord]:
        """获取已被替代的记录（用于追溯修正历史）"""
        return [
            r for r in self.records
            if r.status == "superseded"
        ]

    def get_correction_history(self, record_id: str) -> List[ConsensusRecord]:
        """获取某条记录的修正历史

        Args:
            record_id: 原始记录ID

        Returns:
            修正记录列表（按时间正序）
        """
        history = []
        current = self.get_record(record_id)
        while current and current.superseded_by:
            corrected = self.get_record(current.superseded_by)
            if corrected:
                history.append(corrected)
                current = corrected
            else:
                break
        return history

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