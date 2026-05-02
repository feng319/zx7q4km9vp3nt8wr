# src/core/memo_generator.py
from typing import Dict, List, Optional
import json
from src.core.consensus_chain import ConsensusChain


class MemoGenerator:
    """备忘录生成器(三层架构)"""

    def __init__(self, consensus_chain: ConsensusChain, llm_client=None):
        self.consensus_chain = consensus_chain
        self.llm_client = llm_client

    def _strip_metadata(self, direction: Dict) -> Dict:
        """剥离内部元数据字段（来源等），防止写入Word或传给LLM"""
        return {
            "方向": direction.get("方向", "")
            # 注意：不包含"来源"字段
        }

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
            # 剥离内部元数据后再写入Word
            clean_direction = self._strip_metadata(direction)
            doc.add_paragraph(f"方向{i}: {clean_direction['方向']}")

        doc.save(output_path)

    def polish_chapter(self, chapter_data: Dict, max_words: int = 200) -> str:
        """第三层：AI润色章节

        Args:
            chapter_data: 章节数据（键值对或列表）
            max_words: 最大字数限制

        Returns:
            润色后的段落文字，或降级后的要点列表
        """
        if not self.llm_client:
            # 降级：无LLM时直接返回要点列表
            return self._format_as_bullets(chapter_data)

        prompt = f"""请将以下要点转化成连贯的段落文字。

要求：
1. 只能用下面的要点，不能添加任何额外信息
2. 字数不超过{max_words}字
3. 所有数字和专有名词必须与原始要点完全一致
4. 语气专业、客观、建设性，不使用夸张词汇

要点：
{json.dumps(chapter_data, ensure_ascii=False, indent=2)}

直接输出润色后的段落，不要其他解释。"""

        try:
            result = self.llm_client.generate(prompt, temperature=0.3)
            # 字数截断
            if len(result) > max_words:
                result = result[:max_words] + "..."
            return result
        except Exception as e:
            # 降级：润色失败时使用原始要点
            return self._format_as_bullets(chapter_data)

    def _format_as_bullets(self, chapter_data: Dict) -> str:
        """降级：格式化为要点列表"""
        lines = []
        for key, value in chapter_data.items():
            if isinstance(value, list):
                for item in value:
                    lines.append(f"- {item}")
            else:
                lines.append(f"- {key}: {value}")
        return "\n".join(lines)
