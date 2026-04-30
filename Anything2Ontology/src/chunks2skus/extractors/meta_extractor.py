"""Meta knowledge extractor - read-and-update mode for mapping.md and eureka.md."""

import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import structlog

from chunks2skus.config import settings
from chunks2skus.schemas.sku import SKUHeader, SKUType
from chunks2skus.utils.llm_client import call_llm

from .base import BaseExtractor

logger = structlog.get_logger(__name__)


# [DEPRECATED] Old JSON-wrapping prompt — kept for rollback reference only
# MAPPING_PROMPT replaced by MAPPING_DIRECT_PROMPT (v1.0) then MAPPING_DIFF_PROMPT (v2.0)

MAPPING_SYSTEM_PROMPT = {
    "en": "You are a precise documentation assistant. Be accurate and factual. Never invent or hallucinate information.",
    "zh": "你是一个精确的文档助手。务必准确、基于事实。绝不编造信息。",
}


# [DEPRECATED] Old direct-output prompt — kept for rollback reference only
# MAPPING_DIRECT_PROMPT replaced by MAPPING_DIFF_PROMPT (v2.0)


# [DEPRECATED] Old JSON-wrapping eureka prompt — kept for rollback reference only
# EUREKA_PROMPT replaced by EUREKA_DIRECT_PROMPT (v1.0)

EUREKA_SYSTEM_PROMPT = {
    "en": (
        "You are a creative visionary with high standards. "
        "Surface only insights that reveal structural patterns, surprising "
        "connections, or reusable design principles. Most industry research "
        "reports contain at least one cross-domain pattern worth capturing."
    ),
    "zh": (
        "你是一位高标准的创意思想家。"
        "仅呈现揭示结构性模式、意外联系或可复用设计原则的洞察。"
        "每份行业调研报告通常都包含至少一个可提炼的跨领域模式。"
    ),
}


# Prompt for eureka.md - DIRECT markdown output with NO_UPDATE_NEEDED signal
EUREKA_DIRECT_PROMPT = {
    "en": '''You are a creative analyst maintaining a concise document of cross-cutting insights.

EXISTING EUREKA NOTES:
{existing_eureka}

NEW CHUNK BEING PROCESSED:
Chunk IDs: {chunk_ids_str}
Content (excerpt):
{content}

Factual SKUs extracted from this chunk:
{factual_skus}

TASK:
Review the new chunk and decide whether it contributes any GENUINELY NOVEL insight
not already captured in the existing eureka notes. Most industry research reports
contain at least one cross-domain pattern worth capturing — actively look for them.

An insight qualifies ONLY if it:
1. Identifies a cross-cutting PATTERN that spans multiple domains or concepts
2. Reveals a surprising CONNECTION between seemingly unrelated areas
3. Suggests a non-obvious DESIGN PRINCIPLE or reusable mechanism
4. Raises a fundamental QUESTION that reframes understanding
5. Proposes a domain design principle or architecture pattern reusable in other domains

An insight does NOT qualify if it:
- Is a straightforward application of the content ("this data could power a dashboard")
- Has a core principle IDENTICAL to an existing insight (same mechanism, same conclusion). Mere topic overlap is NOT duplication — insights from different angles on the same topic should be preserved as separate bullets
- Is domain-specific and not reusable across domains
- Is a feature suggestion without deeper structural insight

Note: Do not output domain knowledge already covered by existing SKUs as eureka insights.

RULES:
- Organize by THEME (## headers), not by source chunk
- Append source chunk IDs as inline citations: [chunk_001, chunk_005]
- PRESERVE existing insight bullets as-is — do NOT modify, merge, or remove them
- Only APPEND genuinely new insights from this batch that are not already captured
- Dedup rule: only skip a new insight if its CORE PRINCIPLE is identical to an existing one. "Topic related but angle different" insights MUST be kept — e.g., "VPP aggregation strategy for price arbitrage" and "VPP aggregation strategy for grid stability" are two separate insights
- Maximum 20 bullets across all themes. If the limit is reached, STOP appending new bullets — do NOT merge or compress existing bullets to make room
- Use concise, precise language — one sentence per bullet

OUTPUT:
- If update is needed: output the COMPLETE eureka.md content directly as markdown
- If no update is needed: output ONLY the text NO_UPDATE_NEEDED
''',

    "zh": '''你是一位创意分析师，负责维护一份简明的跨领域洞察文档。

现有灵感笔记：
{existing_eureka}

正在处理的新片段：
片段ID：{chunk_ids_str}
内容（摘录）：
{content}

当前 chunk 已提取的 Factual SKU：
{factual_skus}

任务：
审阅新片段，判断它是否贡献了现有灵感笔记中尚未记录的真正新颖洞察。
每份行业调研报告通常都包含至少一个可提炼的跨领域模式——主动识别它们。

洞察只在以下情况才合格：
1. 识别出跨越多个领域或概念的交叉模式
2. 揭示看似无关领域之间的意外联系
3. 提出非显而易见的设计原则或可复用机制
4. 提出重新构建理解的根本性问题
5. 提出可复用于其他领域的领域设计原则或架构模式

以下情况不合格：
- 内容的直接应用（"这些数据可以做仪表盘"）
- 与已有洞察的核心原则完全相同（相同机制、相同结论）。仅仅是主题相关不构成重复——同一主题不同角度的洞察应作为独立条目保留
- 是领域特定的且不具可复用性的功能建议
- 没有深层结构性洞察的功能建议

注意：不要将已有 SKU 已覆盖的领域知识重复作为 eureka 洞察输出。

规则：
- 按主题（## 标题）组织，而非按源片段
- 附加源片段ID作为行内引用：[chunk_001, chunk_005]
- 已有洞察条目不得修改、合并或删除，保持原样
- 仅追加本批次 chunk 中出现的、与已有所有条目核心原则不重叠的新洞察
- 去重规则：仅当新洞察的核心原则与已有洞察完全相同时才跳过。"主题相关但角度不同"的洞察必须保留——例如"虚拟电厂聚合策略用于套利"和"虚拟电厂聚合策略用于电网稳定"是两条独立洞察
- 所有主题合计最多20条。如果已达到上限，停止追加新条目——不得合并或压缩已有条目来腾出空间
- 使用简洁精确的语言——每条一句话

输出规则：
- 如果需要更新：直接输出完整的 eureka.md 内容（纯 markdown）
- 如果不需要更新：只输出 NO_UPDATE_NEEDED
''',
}

# Prompt for mapping.md - DIFF mode (only output new additions)
MAPPING_DIFF_PROMPT = {
    "zh": '''你正在维护知识工作空间的路由文档 mapping.md。

已有分类结构（仅供参照，不要输出已有内容）：
{mapping_structure}

需要新增的 SKU：
{sku_list}

任务：
对每个新 SKU，判断它应该放入哪个已有分类，或者是否需要新建分类。

每个 SKU 的描述应回答"什么时候需要查阅这个 SKU"，而非"这个 SKU 包含什么内容"。
按使用场景逻辑分组，而非按来源文档分组。

输出格式——对每个新 SKU 输出一行：
- 如果加入已有分类：`## 分类名` 开头一行标记目标分类，然后是 SKU 条目
- 如果新建分类：`## 新分类名` 开头，然后是 SKU 条目

示例输出：
## 虚拟电厂技术
- `factual/vpp-arch`: 需要了解虚拟电厂系统架构时查阅
- `factual/vpp-policy`: 需要了解虚拟电厂政策法规时查阅

## 新能源并网
- `factual/grid-integration`: 需要了解新能源并网技术规范与稳定性时查阅

注意：
- 分类名必须精确匹配已有分类（见上方结构），或标明为新分类
- 每个新 SKU 只输出一行描述
- 不要输出已有 SKU 的内容
- 每条 mapping 描述的生成顺序：
  1. 先读该 SKU 的 name 字段，确定核心主题
  2. 再读 description 字段补充细节
  3. 描述中的核心概念必须来自 name，不得来自同分组其他 SKU
''',

    "en": '''You are maintaining the routing document mapping.md for a knowledge workspace.

EXISTING category structure (for reference only, do not output existing content):
{mapping_structure}

NEW SKUs to add:
{sku_list}

TASK:
For each new SKU, decide whether it belongs to an existing category or needs a new one.

Each SKU description should answer "When would you need to consult this SKU?", NOT "What does this SKU contain?".
Group by usage scenario, NOT by source document.

Output format — one line per new SKU:
- If adding to existing category: start with `## Category Name` to mark the target, then the SKU entry
- If creating new category: start with `## New Category Name`, then the SKU entry

Example output:
## Virtual Power Plant Technology
- `factual/vpp-arch`: When you need to understand VPP system architecture
- `factual/vpp-policy`: When you need to understand VPP policy and regulations

## Renewable Energy Grid Integration
- `factual/grid-integration`: When you need to understand grid integration specs and stability

Notes:
- Category name must exactly match an existing category (see structure above) or be clearly new
- One line of description per new SKU
- Do NOT output existing SKU content
- Generation order for each mapping description:
  1. Read the SKU's name field first to determine the core topic
  2. Then read the description field for supplementary details
  3. The core concept in the description must come from name, NOT from other SKUs in the same group
''',
}


INIT_MAPPING = {
    "en": (
        "# SKU Mapping\n\n"
        "This file maps all Standard Knowledge Units (SKUs) to their use cases.\n\n"
        "---\n\n"
        "*No SKUs mapped yet.*\n"
    ),
    "zh": (
        "# SKU 映射\n\n"
        "本文件将所有标准知识单元（SKU）映射到其使用场景。\n\n"
        "---\n\n"
        "*尚未映射任何 SKU。*\n"
    ),
}

INIT_EUREKA = {
    "en": (
        "# Eureka Notes\n\n"
        "Cross-cutting insights and creative ideas discovered during knowledge extraction.\n\n"
        "---\n\n"
        "*No insights yet.*\n"
    ),
    "zh": (
        "# 灵感笔记\n\n"
        "知识提取过程中发现的跨领域洞察和创意。\n\n"
        "---\n\n"
        "*暂无洞察。*\n"
    ),
}


class MetaExtractor(BaseExtractor):
    """
    Extracts meta knowledge - mapping.md and eureka.md.

    Operates in read-and-update mode with TWO SEPARATE LLM calls:
    - mapping.md: Low temperature (0.2) for accuracy
    - eureka.md: High temperature (0.7) for creativity
    """

    extractor_name = "meta"
    sku_type = SKUType.META

    def __init__(self, output_dir: Path):
        super().__init__(output_dir)
        self.mapping_path = self.type_dir / "mapping.md"
        self.eureka_path = self.type_dir / "eureka.md"
        self.header_path = self.type_dir / "header.md"

        # Initialize files if they don't exist
        self._init_files()

    def _init_files(self) -> None:
        """Initialize mapping.md, eureka.md, and header.md if they don't exist."""
        if not self.mapping_path.exists():
            self.mapping_path.write_text(
                INIT_MAPPING[settings.language],
                encoding="utf-8",
            )

        if not self.eureka_path.exists():
            self.eureka_path.write_text(
                INIT_EUREKA[settings.language],
                encoding="utf-8",
            )

        if not self.header_path.exists():
            header = SKUHeader(
                name="meta-knowledge",
                classification=SKUType.META,
                character_count=0,
                source_chunk="aggregated",
                description="SKU routing (mapping.md) and creative insights (eureka.md)",
            )
            self.header_path.write_text(header.to_markdown(), encoding="utf-8")

    def extract(
        self,
        content: str,
        chunk_ids: list[str] | str,
        context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Update meta knowledge from content using two PARALLEL LLM calls.

        mapping.md and eureka.md are independent — they can be updated concurrently.

        Args:
            content: Chunk content to process
            chunk_ids: Identifier(s) of the source chunk(s) — single string or list
            context: Context containing all current SKUs

        Returns:
            List with single SKU info dict (the meta knowledge)
        """
        # Normalize chunk_ids to list for consistent handling
        if isinstance(chunk_ids, str):
            chunk_ids = [chunk_ids]
        chunk_ids_str = ", ".join(chunk_ids)

        logger.info("Extracting meta knowledge", chunk_ids=chunk_ids_str)

        # Run mapping + eureka updates in PARALLEL (they are independent)
        with ThreadPoolExecutor(max_workers=2) as executor:
            mapping_future = executor.submit(self._update_mapping, chunk_ids[-1], context)
            eureka_future = executor.submit(self._update_eureka, content, chunk_ids, context)

            # Wait for both to complete
            mapping_future.result()
            eureka_future.result()

        # Update header with character count
        self._update_header()

        logger.info(
            "Meta extraction complete",
            chunk_ids=chunk_ids_str,
            mapping_chars=len(self.mapping_path.read_text(encoding="utf-8")),
            eureka_chars=len(self.eureka_path.read_text(encoding="utf-8")),
        )

        return [
            {
                "sku_id": "meta-knowledge",
                "name": "meta-knowledge",
                "classification": SKUType.META,
                "path": f"{self.sku_type.value}",
                "source_chunk": "aggregated",
                "character_count": self._get_total_chars(),
                "description": "SKU routing (mapping.md) and creative insights (eureka.md)",
            }
        ]

    def _update_mapping(self, chunk_id: str, context: dict[str, Any] | None) -> None:
        """
        Update mapping.md using diff output + code merge.

        Instead of asking LLM to output the full mapping.md, we only ask for
        new additions and merge them into the existing file programmatically.
        This avoids the risk of LLM rewriting or deleting existing content,
        and dramatically reduces prompt size.
        """
        logger.debug("Updating mapping.md (diff mode)", chunk_id=chunk_id)

        # In diff mode, only send NEW SKUs to reduce prompt size and avoid duplicates
        sku_list = self._format_sku_list(context, new_only=True)
        current_mapping = self.mapping_path.read_text(encoding="utf-8")
        current_size = len(current_mapping)

        # Get structural skeleton instead of full content
        mapping_structure = self._get_mapping_structure(current_mapping)

        prompt = MAPPING_DIFF_PROMPT[settings.language].format(
            mapping_structure=mapping_structure,
            sku_list=sku_list,
        )

        # Use call_llm for direct diff output
        response = call_llm(
            prompt,
            system_prompt=MAPPING_SYSTEM_PROMPT[settings.language],
            temperature=0.2,
            max_tokens=32000,  # diff output is much shorter than full file
        )

        if not response:
            logger.warning("Failed to get mapping diff response", chunk_id=chunk_id)
            return

        # Merge diff into existing mapping
        merged = self._merge_mapping_diff(current_mapping, response)

        # Validate mapping descriptions overlap with SKU descriptions (diagnostic only)
        new_skus = (context.get("new_skus") or []) if context else []
        if new_skus:
            self._validate_mapping_entries(merged, new_skus)

        # Safety: merged should be >= original (only additions)
        if len(merged) >= len(current_mapping):
            self.mapping_path.write_text(merged.replace("\\", "/"), encoding="utf-8")
            logger.info(
                "Updated mapping.md (diff merge)",
                old_size=current_size,
                new_size=len(merged),
                diff_lines=len(response.split("\n")),
                chunk_id=chunk_id,
            )
        else:
            logger.warning(
                "Mapping diff merge resulted in shorter file, skipping",
                old_size=current_size,
                new_size=len(merged),
                chunk_id=chunk_id,
            )

    def _validate_mapping_entries(self, new_mapping: str, new_skus: list[dict]) -> None:
        """Validate that mapping descriptions overlap with SKU descriptions and header titles.

        Two-layer validation:
        1. Description overlap — uses description field (same as before)
        2. Header title overlap — reads the actual header.md title from disk (ground truth)

        The header title is the authoritative final state — if the LLM confused two SKUs
        in the same batch (e.g., wrote company-info description for a process-flow SKU),
        the description overlap may pass (both are from the same chunk), but the header
        title overlap will catch the mismatch.

        Logs warnings for low overlap, does NOT block writes.
        """
        for sku in new_skus:
            description = sku.get("description", "")
            path = sku.get("path", "")
            if not description or len(description) < 5:
                continue

            # Take first 10 chars of description as keyword anchor
            anchor = description[:10]

            # Get SKU path marker (last segment)
            path_marker = path.replace("\\", "/").split("/")[-1] if path else ""
            if not path_marker:
                continue

            # Find the mapping line containing this SKU path
            mapping_lines = new_mapping.split("\n")
            sku_mapping_desc = ""
            for line in mapping_lines:
                if path_marker in line:
                    sku_mapping_desc = line
                    break

            if not sku_mapping_desc:
                continue

            # Check if any consecutive 2-char fragment of anchor appears in mapping line
            has_overlap = any(
                anchor[i:i+2] in sku_mapping_desc
                for i in range(len(anchor) - 1)
            )

            if not has_overlap:
                logger.warning(
                    "Low overlap mapping entry",
                    sku_path=path_marker,
                    description_anchor=anchor,
                    mapping_line=sku_mapping_desc.strip()[:80],
                )

            # Layer 2: Header title overlap check
            # Read the actual header.md title from disk (ground truth)
            sku_dir = Path(path) if path else None
            header_path = sku_dir / "header.md" if sku_dir else None
            if header_path and header_path.exists():
                header_content = header_path.read_text(encoding="utf-8")
                # Extract title from first line: "# Title"
                title_match = re.match(r"#\s+(.+)", header_content)
                if title_match:
                    header_title = title_match.group(1).strip()
                    is_match, reason = self._check_header_mapping_match(
                        header_title, sku_mapping_desc
                    )
                    if not is_match:
                        logger.warning(
                            "Header-mapping title mismatch",
                            sku_path=path_marker,
                            header_title=header_title[:40],
                            mapping_line=sku_mapping_desc.strip()[:80],
                        )
                    elif reason == "skipped_english":
                        logger.debug(
                            "Header-mapping check skipped (english title)",
                            sku_path=path_marker,
                        )

    @staticmethod
    def _check_header_mapping_match(
        header_title: str, mapping_line: str
    ) -> tuple[bool, str]:
        """Check if header title overlaps with mapping description.

        Returns:
            (is_match, reason) where reason is one of:
            - "matched": 2-char overlap found
            - "skipped_english": english kebab-case title, content match skipped
            - "mismatch": no overlap found
        """
        clean_title = header_title.strip()

        # Bug 1 fix: English kebab-case titles (procedural SKUs)
        # cannot be meaningfully matched against Chinese mapping descriptions
        if re.match(r"^[a-z][a-z0-9\-]+$", clean_title):
            return True, "skipped_english"

        # Bug 2 fix: Chinese titles — scan entire title with 2-char sliding window
        # instead of skipping first 2 chars (title[2:6]), which missed important
        # prefixes like "鸭制品", "2008年"
        if len(clean_title) >= 2:
            for start in range(len(clean_title) - 1):
                anchor = clean_title[start : start + 2]
                if anchor in mapping_line:
                    return True, "matched"

        return False, "mismatch"

    def _get_mapping_structure(self, mapping: str, max_chars: int = 12000) -> str:
        """Extract structural skeleton from mapping.md for diff prompt.

        Keeps section headers and SKU path lines, removes descriptive paragraphs.
        """
        lines = mapping.split("\n")
        result = []
        for line in lines:
            stripped = line.strip()
            # Keep all headers
            if stripped.startswith("#"):
                result.append(line)
            # Keep SKU path lines (bullets with paths)
            elif stripped.startswith("-") and (
                "**" in stripped or "`" in stripped or "/" in stripped
            ):
                result.append(line)
            # Skip descriptive paragraphs

        compressed = "\n".join(result)
        if len(compressed) > max_chars:
            compressed = compressed[:max_chars] + "\n... (truncated structure)"
        return compressed

    def _merge_mapping_diff(self, current_mapping: str, diff_output: str) -> str:
        """Merge LLM's diff output into existing mapping.md.

        Parses the diff output into sections (marked by ## headers) and either
        appends to an existing section or creates a new one at the end.
        """
        # Remove placeholder text from current mapping
        lines = [
            l for l in current_mapping.split("\n")
            if "尚未映射任何" not in l and "No SKUs mapped yet" not in l
        ]
        diff_lines = diff_output.strip().split("\n")

        # Initialize seen_sku_paths from existing mapping to prevent duplicates
        existing_sku_paths = set(re.findall(r'`([^`]+/[^`]+)`', current_mapping))
        seen_sku_paths: set[str] = existing_sku_paths

        # Parse diff into sections: {header: [content_lines]}
        diff_sections: list[tuple[str, list[str]]] = []
        current_header = None
        current_content: list[str] = []

        for line in diff_lines:
            if line.strip().startswith("## "):
                # Save previous section
                if current_header is not None:
                    diff_sections.append((current_header, current_content))
                current_header = line.strip()
                current_content = []
            elif current_header is not None:
                current_content.append(line)

        # Don't forget the last section
        if current_header is not None:
            diff_sections.append((current_header, current_content))

        if not diff_sections:
            return current_mapping

        # Apply each diff section
        result_lines = lines[:]

        for header, content in diff_sections:
            # Filter out empty content lines at the end
            while content and not content[-1].strip():
                content.pop()
            if not content:
                continue

            # SKU path dedup: skip lines whose path already exists in mapping
            deduped_content = []
            for line in content:
                stripped = line.strip()
                # Extract SKU path from lines like: - `factual/xxx`: description
                path_match = re.search(r"`([^`]+/[^`]+)`", stripped)
                if path_match:
                    sku_path = path_match.group(1)
                    if sku_path in seen_sku_paths:
                        logger.debug("Skipping duplicate SKU path in mapping diff", path=sku_path)
                        continue
                    seen_sku_paths.add(sku_path)
                deduped_content.append(line)
            content = deduped_content

            if not content:
                continue

            # Find matching section in current mapping (fuzzy match)
            insert_idx = self._find_section_index(result_lines, header)

            if insert_idx is not None:
                # Append to existing section — find where section ends
                end_idx = insert_idx + 1
                while end_idx < len(result_lines):
                    if result_lines[end_idx].strip().startswith("## "):
                        break
                    end_idx += 1
                # Insert content before next section header
                for i, content_line in enumerate(content):
                    result_lines.insert(end_idx + i, content_line)
            else:
                # New section — append to end of file
                result_lines.append("")
                result_lines.append(header)
                result_lines.extend(content)

        return "\n".join(result_lines)

    def _find_section_index(self, lines: list[str], header: str) -> int | None:
        """Find line index of a section header, with fuzzy matching."""
        header_name = header.strip("# ").strip().lower()

        for i, line in enumerate(lines):
            if not line.strip().startswith("#"):
                continue
            line_name = line.strip("# ").strip().lower()
            # Exact match
            if line_name == header_name:
                return i
            # Fuzzy: >60% word overlap
            header_words = set(header_name.split())
            line_words = set(line_name.split())
            if header_words and line_words:
                overlap = len(header_words & line_words)
                if overlap / max(len(header_words), 1) > 0.6:
                    return i
        return None

    def _update_eureka(self, content: str, chunk_ids: list[str] | str, context: dict[str, Any] | None = None) -> None:
        """
        Update eureka.md with genuinely novel cross-cutting insights.

        Uses direct markdown output with NO_UPDATE_NEEDED signal.
        Temperature 0.7 for creative latitude; the prompt enforces quality.
        """
        # Normalize chunk_ids for consistent handling
        if isinstance(chunk_ids, str):
            chunk_ids = [chunk_ids]
        chunk_ids_str = ", ".join(chunk_ids)

        logger.debug("Evaluating eureka update", chunk_ids=chunk_ids_str)

        current_eureka = self.eureka_path.read_text(encoding="utf-8")
        current_size = len(current_eureka)

        # Format factual SKU list from context
        factual_skus = self._format_factual_skus(context)

        prompt = EUREKA_DIRECT_PROMPT[settings.language].format(
            existing_eureka=current_eureka,
            chunk_ids_str=chunk_ids_str,
            content=content[:8000],  # Limit content to avoid token overflow
            factual_skus=factual_skus,
        )

        # Use call_llm for direct markdown output
        response = call_llm(
            prompt,
            system_prompt=EUREKA_SYSTEM_PROMPT[settings.language],
            temperature=0.7,
            max_tokens=32000,
        )

        if not response:
            logger.warning("Failed to get eureka response", chunk_ids=chunk_ids_str)
            return

        # Check if LLM signaled no update needed
        if response.strip() == "NO_UPDATE_NEEDED":
            logger.debug("No eureka update needed", chunk_ids=chunk_ids_str)
            return

        # Shrinkage guard: reject if content shrank by more than 50%
        # (eureka may legitimately consolidate/shorten entries)
        if len(response) >= max(50, current_size * 0.5) or current_size < 100:
            self.eureka_path.write_text(response, encoding="utf-8")
            logger.info(
                "Updated eureka.md",
                chunk_ids=chunk_ids_str,
                old_size=current_size,
                new_size=len(response),
            )
        else:
            logger.warning(
                "Rejected eureka update: content shrank by more than 50%",
                old_size=current_size,
                new_len=len(response),
                chunk_ids=chunk_ids_str,
            )

    def _format_factual_skus(self, context: dict[str, Any] | None) -> str:
        """Format factual SKU names from context for eureka prompt."""
        if not context:
            return "(无)"
        skus = context.get("new_skus") or context.get("all_skus") or []
        factual = [s for s in skus if s.get("classification") == SKUType.FACTUAL
                   or (hasattr(s.get("classification"), "value") and s.get("classification").value == "factual")]
        if not factual:
            return "(无)"
        return "\n".join(f"- {s.get('name', 'unknown')}: {s.get('description', '')}" for s in factual)

    def _format_sku_list(self, context: dict[str, Any] | None, new_only: bool = False) -> str:
        """Format the current SKU list for the prompt.

        Args:
            context: Context dict containing SKU lists.
            new_only: If True, only format new SKUs from this batch (for diff mode).
                      Falls back to all_skus if new_skus not available.
        """
        if not context:
            return "*No SKUs extracted yet.*"

        # In diff mode, prefer new_skus (only SKUs from current batch)
        if new_only and "new_skus" in context:
            skus = context["new_skus"]
        elif "all_skus" in context:
            skus = context["all_skus"]
        else:
            return "*No SKUs extracted yet.*"

        if not skus:
            return "*No SKUs extracted yet.*"

        lines = []
        for sku in skus:
            classification = sku.get("classification", "unknown")
            if hasattr(classification, "value"):
                classification = classification.value

            # Simplify path to classification/sku_id format
            path = sku.get("path", "")
            if "\\" in path or "/" in path:
                parts = path.replace("\\", "/").split("/")
                simplified = f"{parts[-2]}/{parts[-1]}"
            else:
                simplified = path or "unknown"

            # Add name as primary anchor (bold) for LLM focus
            name = sku.get("name", "")
            desc = sku.get("description", "No description")
            if name:
                lines.append(f"- [{classification}] {simplified}: **{name}** — {desc}")
            else:
                lines.append(f"- [{classification}] {simplified}: {desc}")

        return "\n".join(lines)

    def _update_header(self) -> None:
        """Update header.md with current character count."""
        header = SKUHeader(
            name="meta-knowledge",
            classification=SKUType.META,
            character_count=self._get_total_chars(),
            source_chunk="aggregated",
            description="SKU routing (mapping.md) and creative insights (eureka.md)",
        )
        self.header_path.write_text(header.to_markdown(), encoding="utf-8")

    def _get_total_chars(self) -> int:
        """Get total character count of meta knowledge."""
        total = 0
        if self.mapping_path.exists():
            total += len(self.mapping_path.read_text(encoding="utf-8"))
        if self.eureka_path.exists():
            total += len(self.eureka_path.read_text(encoding="utf-8"))
        return total
