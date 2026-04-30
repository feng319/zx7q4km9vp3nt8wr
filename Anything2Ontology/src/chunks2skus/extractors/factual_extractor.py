"""Factual knowledge extractor - isolated processing, creates new SKUs."""

import json
from pathlib import Path
from typing import Any

import structlog

from chunks2skus.config import settings
from chunks2skus.schemas.sku import SKUHeader, SKUType
from chunks2skus.utils.llm_client import call_llm_json

from .base import BaseExtractor

logger = structlog.get_logger(__name__)


FACTUAL_PROMPT = {
    "en": '''You are extracting factual knowledge from a document chunk.

Factual knowledge includes:
- Basic facts, definitions, and data points
- Statistics and measurements
- "What is what" information
- Descriptive details

Content that should NOT be extracted (metadata, no standalone knowledge value):
- Survey time, location, interviewee — document header information
- Sentences that merely say "This report was completed by X on Y for Z"
- Descriptive paragraphs that cannot be used independently without the document context

If a potential SKU only contains the above types of information, skip it and do not generate.

Information density requirement (IMPORTANT):
Each SKU's content must answer "So what?" — not just state a fact, but also explain its significance, magnitude, or relationship to other concepts. SKUs that merely state "X exists" or "X is Y" without providing any context should NOT be generated.

CHUNK CONTENT:
{content}

TASK:
Extract distinct factual knowledge units. Each unit should be self-contained.
For structured/tabular data, use JSON format. For narrative facts, use markdown.

Format selection rules (IMPORTANT):
- Content with 3+ comparable fields of structured data → content.json
- Content with time series, price ranges, or technical parameter tables → content.json
- Concept explanations, process descriptions, principle analysis → content.md

Knowledge transformation rules (IMPORTANT):
- Do NOT directly copy source text paragraphs. You must transform source information into structured knowledge
- Comparative data must be converted to Markdown tables or JSON arrays
- Step-by-step processes must be converted to ordered lists
- Specifications and parameters must be converted to field-value pairs
- Narrative paragraphs must be distilled into key points — do not preserve the original prose

STRUCTURED DATA RULES (IMPORTANT):
- If the chunk contains structured data (markdown tables, HTML tables, JSON arrays, CSV-like lists, repeated key-value entries, item catalogs, stat blocks), keep the ENTIRE dataset as ONE factual unit with content_type "json". Convert the full dataset into a JSON array of objects. Do NOT split individual rows, entries, or items into separate SKUs.
- Only split into multiple SKUs when the chunk contains genuinely DIFFERENT topics (e.g., a weapon stats table AND an unrelated game mechanic explanation). Rows within the same table or entries in the same list are NEVER separate units.
- When in doubt, prefer fewer, larger units over many small ones. A single table = one unit. A single list of items = one unit.

Follow the MECE principle (Mutually Exclusive, Collectively Exhaustive):
- Facts should not overlap
- Cover all factual content in the chunk

Output ONLY valid JSON:
{{
  "facts": [
    {{
      "name": "short-identifier-name",
      "description": "One-line summary that stands alone — a reader unfamiliar with other SKUs in this document should be able to determine the core topic from this description alone. Do NOT use qualifiers that position this SKU as a subtopic of another concept (e.g., avoid 'commonly used in X for Y' unless X is itself the core topic). ✅ 'Core performance metrics in carbon capture utilization and storage' (domain context is necessary) / ❌ 'Energy-saving technologies commonly used in integrated energy services' (positions itself as a subset of another concept)",
      "content_type": "markdown" or "json",
      "content": "The actual factual content (string for markdown, object/array for json)"
    }}
  ]
}}

If no factual knowledge is found, return: {{"facts": []}}

Note: Use the same language as the document content for the "name" field.
''',

    "zh": '''你正在从文档片段中提取事实性知识。

事实性知识包括：
- 基本事实、定义和数据点
- 统计数据和度量指标
- "是什么"类信息
- 描述性细节

不应提取的内容（元数据，不具备独立知识价值）：
- 调研时间、调研地点、调研对象等文档头部信息
- 仅包含"本报告由XX于XX时间针对XX完成"类句子的内容
- 无法脱离文档上下文独立使用的描述性段落

如果一个潜在SKU仅包含上述类型信息，跳过它，不要生成。

信息密度要求（重要）：
每个 SKU 的 content 必须能回答"所以呢？"——不仅陈述事实，还要说明该事实的意义、数量级、或与其他概念的关系。仅陈述"X 存在"或"X 是 Y"而不提供任何上下文的 SKU 不应生成。

文档片段内容：
{content}

任务：
提取独立的事实性知识单元。每个单元应当自包含。
对于结构化/表格数据，使用JSON格式。对于叙述性事实，使用markdown格式。

格式选择规则（重要）：
- 包含3个以上可对比字段的结构化数据 → content.json
- 包含时间序列、价格区间、技术参数表 → content.json
- 概念解释、流程描述、原理分析 → content.md

知识转化规则（重要）：
- 不要直接复制原文段落。必须将原文信息转化为结构化知识
- 包含数据对比的内容必须转化为 Markdown 表格或 JSON 数组
- 包含步骤流程的内容必须转化为有序列表
- 参数规格必须转化为字段-值对
- 原文的叙述性段落必须提炼为要点，不得原样保留

结构化数据规则（重要）：
- 如果片段中包含结构化数据（markdown表格、HTML表格、JSON数组、CSV风格列表、重复的键值条目、物品目录、属性数据块），必须将整个数据集作为一个事实单元保留，content_type设为"json"，将完整数据集转换为JSON对象数组。绝对不要将单独的行、条目或项目拆分为独立的SKU。
- 仅当片段包含真正不同的主题时才拆分为多个SKU（例如一个武器属性表和一段无关的游戏机制说明）。同一表格中的行或同一列表中的条目永远不应被拆分。
- 当无法确定时，优先选择更少、更大的单元，而非许多小单元。一张表格=一个单元。一个物品列表=一个单元。

遵循MECE原则（相互独立，完全穷尽）：
- 各事实之间不应重叠
- 覆盖片段中的所有事实性内容

仅输出合法JSON：
{{
  "facts": [
    {{
      "name": "简短中文标识名（如：虚拟电厂架构）",
      "description": "该事实单元的一句话摘要，必须独立成立——读者在不知道同文档其他 SKU 内容的情况下，应能从 description 准确判断本 SKU 的核心主题。禁止使用将本 SKU 定位为其他概念子话题的限定语，除非该限定语本身就是本 SKU 的核心主题。✅ \"碳捕集利用与封存技术中的核心性能指标\"（领域背景是必要的）/ ❌ \"综合能源服务常用的节能降碳技术\"（把自身定位为另一个概念的子集）",
      "content_type": "markdown" or "json",
      "content": "实际的事实性内容（markdown为字符串，json为对象/数组）"
    }}
  ]
}}

如果未发现事实性知识，返回：{{"facts": []}}

注意：name 字段使用与文档内容相同的语言。
''',
}


class FactualExtractor(BaseExtractor):
    """
    Extracts factual knowledge from chunks.

    Creates isolated SKU folders with header.md + content.md/json.
    Does NOT reference previous chunks (isolated processing).
    """

    extractor_name = "factual"
    sku_type = SKUType.FACTUAL

    def __init__(self, output_dir: Path):
        super().__init__(output_dir)
        self._sku_counter = self._get_next_sku_number()

    def _get_next_sku_number(self) -> int:
        """Find the next available SKU number."""
        existing = list(self.type_dir.glob("sku_*"))
        if not existing:
            return 1
        numbers = []
        for d in existing:
            try:
                num = int(d.name.split("_")[1])
                numbers.append(num)
            except (IndexError, ValueError):
                pass
        return max(numbers, default=0) + 1

    def extract(
        self,
        content: str,
        chunk_id: str,
        context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Extract factual knowledge from content.

        Args:
            content: Chunk content to process
            chunk_id: Identifier of the source chunk
            context: Ignored (isolated processing)

        Returns:
            List of created SKU info dicts
        """
        logger.info("Extracting factual knowledge", chunk_id=chunk_id)

        # Call LLM for extraction with structured output + retry
        prompt = FACTUAL_PROMPT[settings.language].format(content=content)
        parsed = call_llm_json(prompt, max_tokens=64000)

        if not parsed or "facts" not in parsed:
            logger.warning("Failed to get factual extraction response", chunk_id=chunk_id)
            return []

        facts = parsed.get("facts", [])
        if not facts:
            logger.info("No factual knowledge found in chunk", chunk_id=chunk_id)
            return []

        # Create SKU folders
        created_skus = []
        for fact in facts:
            sku_info = self._create_sku(fact, chunk_id)
            if sku_info:
                created_skus.append(sku_info)

        logger.info(
            "Factual extraction complete",
            chunk_id=chunk_id,
            skus_created=len(created_skus),
        )

        return created_skus

    def _create_sku(self, fact: dict[str, Any], chunk_id: str) -> dict[str, Any] | None:
        """
        Create an SKU folder with header.md and content file.

        Args:
            fact: Extracted fact dict from LLM
            chunk_id: Source chunk ID

        Returns:
            SKU info dict, or None on failure
        """
        name = fact.get("name", f"fact_{self._sku_counter}")
        description = fact.get("description", "")
        content_type = fact.get("content_type", "markdown")
        content = fact.get("content", "")

        # Create SKU folder
        sku_id = f"sku_{self._sku_counter:03d}"
        sku_dir = self.type_dir / sku_id
        sku_dir.mkdir(exist_ok=True)

        # Determine content and character count
        if content_type == "json" and isinstance(content, (dict, list)):
            content_str = json.dumps(content, ensure_ascii=False, indent=2)
            content_file = sku_dir / "content.json"
        else:
            content_str = str(content)
            content_file = sku_dir / "content.md"

        # Warn if markdown content lacks structure markers
        if content_type == "markdown":
            has_structure = any(marker in content_str for marker in ("#", "- ", "| ", "1."))
            if not has_structure:
                logger.warning("Markdown SKU lacks structure markers", name=name, chars=len(content_str))

        char_count = len(content_str)

        # Skip trivially short SKUs (metadata fragments)
        if char_count < 80:
            logger.info("Skipping trivially short SKU", name=name, chars=char_count)
            return None

        # Create header.md
        header = SKUHeader(
            name=name,
            classification=SKUType.FACTUAL,
            character_count=char_count,
            source_chunk=chunk_id,
            description=description,
        )

        header_path = sku_dir / "header.md"
        header_path.write_text(header.to_markdown(), encoding="utf-8")

        # Create content file
        content_file.write_text(content_str, encoding="utf-8")

        self._sku_counter += 1

        logger.debug("Created factual SKU", sku_id=sku_id, name=name)

        return {
            "sku_id": sku_id,
            "name": name,
            "classification": SKUType.FACTUAL,
            "path": f"{self.sku_type.value}/{sku_id}",
            "source_chunk": chunk_id,
            "character_count": char_count,
            "description": description,
        }
