# src/core/memo_generator.py
from typing import Dict, List
from src.core.consensus_chain import ConsensusChain

class MemoGenerator:
    """备忘录生成器(三层架构)"""

    def __init__(self, consensus_chain: ConsensusChain):
        self.consensus_chain = consensus_chain

    def extract_data(self) -> Dict:
        """第一层: 数据提取(确定性规则)"""
        data = {
            "facts": [],
            "consensus": [],
            "pending": [],
            "client_profile": {}  # 从外部注入
        }

        # 提取已确认事实
        for record in self.consensus_chain.get_confirmed_facts():
            data["facts"].append({
                "stage": record.stage,
                "content": record.content,
                "source": record.source
            })

        # 提取已确认判断
        for record in self.consensus_chain.get_confirmed_consensus():
            data["consensus"].append({
                "content": record.content,
                "source": record.source,
                "recommendation": record.recommendation
            })

        # 提取待确认判断
        for record in self.consensus_chain.get_pending_consensus():
            data["pending"].append({
                "content": record.content
            })

        return data

    def generate_structure(self) -> Dict:
        """第二层: 结构组装(模板+规则)"""
        data = self.extract_data()

        structure = {
            "chapters": {}
        }

        # 一、问题重构
        structure["chapters"]["问题重构"] = {
            "原始诉求": data["client_profile"].get("显性诉求", ""),
            "核心问题": data["consensus"][0]["content"] if data["consensus"] else ""
        }

        # 二、关键发现
        structure["chapters"]["关键发现"] = {
            "战略层面": [f["content"] for f in data["facts"] if f["stage"] == "战略梳理"][:3],
            "商业模式层面": [f["content"] for f in data["facts"] if f["stage"] == "商业模式"][:3]
        }

        # 三、初步建议方向
        structure["chapters"]["初步建议方向"] = [
            {
                "方向": c["recommendation"] or c["content"],
                "来源": "系统生成" if c["source"] == "candidate_selected" else "顾问判断"
            }
            for c in data["consensus"]
        ]

        # 四、需要进一步访谈
        structure["chapters"]["需要进一步访谈"] = [
            p["content"] for p in data["pending"]
        ]

        return structure

    def generate_word(self, output_path: str):
        """生成Word文档(第三层: AI润色在Day 2实现)"""
        from docx import Document

        structure = self.generate_structure()
        doc = Document()

        # 标题
        doc.add_heading('客户初步诊断备忘录', 0)

        # 一、问题重构
        doc.add_heading('一、问题重构', level=1)
        problem = structure["chapters"]["问题重构"]
        doc.add_paragraph(f"原始诉求: {problem['原始诉求']}")
        doc.add_paragraph(f"诊断后的核心问题: {problem['核心问题']}")

        # 二、关键发现
        doc.add_heading('二、关键发现', level=1)
        findings = structure["chapters"]["关键发现"]
        for stage, facts in findings.items():
            if facts:
                doc.add_heading(stage, level=2)
                for fact in facts:
                    doc.add_paragraph(fact, style='List Bullet')

        # 三、初步建议方向
        doc.add_heading('三、初步建议方向', level=1)
        for i, direction in enumerate(structure["chapters"]["初步建议方向"], 1):
            doc.add_paragraph(f"方向{i}: {direction['方向']}")

        doc.save(output_path)
