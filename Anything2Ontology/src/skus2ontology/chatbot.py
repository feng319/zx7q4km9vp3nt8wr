"""Step 2: Interactive chatbot for generating spec.md."""

import json
import re
import time
from datetime import datetime
from pathlib import Path

import click
import structlog

from skus2ontology.config import settings
from skus2ontology.schemas.ontology import AnchorPhase, ChatMessage, ChatSession
from skus2ontology.spec_validator import validate as validate_spec
from skus2ontology.utils.llm_client import call_llm, call_llm_chat

logger = structlog.get_logger(__name__)

# --- Constants ---

# Max characters for compressed mapping.md (used by _compress_mapping, not primary path)
MAPPING_SUMMARY_MAX_CHARS = 30000
# Soft limit for eureka.md — beyond this, use two-segment strategy
EUREKA_SOFT_LIMIT = 50000
# First chunk size when eureka exceeds soft limit
EUREKA_CHUNK_SIZE = 30000
# Max characters for SKU index summary in phase 2
SKU_INDEX_MAX_CHARS = 70000
# Anchor marker regex
ANCHOR_PATTERN = re.compile(r"【锚点：[^】]+】")

# --- Prompt Templates ---

SYSTEM_PROMPT_TEMPLATE = {
    "en": """You are a product specification assistant helping a user design an application.

You have access to a comprehensive knowledge base of Standard Knowledge Units (SKUs) organized into factual data, procedural skills, and relational knowledge. Your job is to:

1. Interview the user about their application goals, target users, and key features
2. Draft a spec.md document based on their answers
3. Iterate on the spec based on user feedback
4. Finalize the spec when the user is satisfied

KNOWLEDGE BASE TOPICS:
{mapping_titles}

CREATIVE IDEAS FROM KNOWLEDGE BASE:
{eureka_content}

SPEC CHAPTER TEMPLATE (follow this structure strictly):
```
# [App Name]
## Overview
(2-3 sentences explaining what problem the application solves)
## Target Users
(Specific user personas — who will use this application)
## Core Features
### Feature 1: [Name]
Description...
【锚点：related knowledge point】
### Feature 2: [Name]
Description...
## Technical Notes
(Data sources, external services, dependencies)
## MVP Scope
(Which features are included in v1, what is deferred)
```

RULES:
- When you can identify a specific SKU from the KNOWLEDGE BASE TOPICS list above, write the SKU reference directly (e.g., skus/factual/sku_002)
- When you can identify a specific chunk from eureka.md or the topic list, write the chunk reference directly: [chunk: xxx_chunk_xxx] (get the chunk identifier from the square brackets in eureka.md)
- If you already know the SKU or chunk reference, do NOT wrap it in 【锚点：...】 — write it directly. Anchor markers are ONLY for when you truly cannot identify any specific reference.
- Place anchor markers inside the relevant Core Features section
- The anchor markers will be automatically replaced with actual SKU references in a later step
- When drafting the spec, wrap it in a ```markdown code block
- The user types /confirm to finalize the current spec
- Be concise in your questions — ask 2-3 focused questions at a time
- Anchor descriptions MUST describe a specific knowledge point (e.g., a concrete skill, concept, or data point), NOT a knowledge base group title or eureka insight headline (e.g., "科技投资与风险防控" is a group title, NOT a valid anchor description)""",

    "zh": """你是一个产品规格助手，帮助用户设计应用程序。

你可以访问一个由标准知识单元（SKU）组成的综合知识库，包含事实数据、程序技能和关系知识。你的任务是：

1. 询问用户的应用目标、目标用户和关键功能
2. 根据用户回答起草 spec.md 文档
3. 根据用户反馈迭代规格
4. 用户满意后定稿

知识库主题分布：
{mapping_titles}

知识库中的创意：
{eureka_content}

Spec 章节模板（严格按此结构）：
```
# [应用名称]
## 概述
（2-3 句话说明这个应用解决什么问题）
## 目标用户
（具体描述用户画像——谁会使用这个应用）
## 核心功能
### 功能一：[名称]
描述...
【锚点：相关知识点】
### 功能二：[名称]
描述...
## 技术说明
（数据源、外部服务、依赖项等）
## MVP 范围
（第一版包含哪些功能，哪些留到后续）
```

规则：
- 当你能从上方「知识库主题分布」中识别出具体 SKU 时，写出 SKU 引用并附带其名称（如 skus/factual/sku_002 某某模式核心参数）——不允许只写路径不写名称
- 当你能从 eureka.md 或主题列表中识别出具体 chunk 时，直接写出 chunk 引用：[chunk: xxx_chunk_xxx]（chunk 标识从 eureka.md 的方括号里获取）
- 如果你已经知道 SKU 或 chunk 引用，**不要**用 【锚点：...】 包裹——直接写出。锚点标记**仅用于**你完全无法识别具体引用的情况
- 锚点标记放在对应的核心功能章节内
- 锚点标记将在后续步骤中自动替换为实际的 SKU 引用
- 起草规格时，用 ```markdown 代码块包裹
- 用户输入 /confirm 来确认当前规格
- 提问要简洁——每次问2-3个针对性问题
- 锚点描述必须是具体知识点名称（如某个技能、概念或数据点），不能是知识库的分组标题或洞察标题（如"科技投资与风险防控"是分组标题，不能作为锚点描述）""",
}

FINALIZE_PROMPT = {
    "en": """The user has confirmed the spec. Please output the FINAL, clean version of spec.md.

Output ONLY the spec content inside a ```markdown code block. No extra commentary.
Include all sections discussed.
IMPORTANT: Preserve ALL 【锚点：...】 anchor markers exactly as they are. Do NOT replace them with SKU paths — they will be automatically processed in the next step.
- Preserve ALL [chunk: xxx_chunk_xxx] references exactly as they appear — do not expand, replace, or remove them.""",

    "zh": """用户已确认规格。请输出最终、整洁的 spec.md 版本。

仅在 ```markdown 代码块内输出规格内容。不要额外评论。
包含所有讨论过的章节。
重要：保留所有【锚点：...】锚点标记，不要替换为 SKU 路径——它们将在下一步自动处理。
- 保留所有 [chunk: xxx_chunk_xxx] 格式的引用，原样保留，不要展开、替换或删除。""",
}

AUTO_FINALIZE_PROMPT = {
    "en": """The maximum number of conversation rounds has been reached. Please consolidate ALL topics discussed above into a FINAL, clean spec.md.

Output ONLY the spec content inside a ```markdown code block. No extra commentary.
Include ALL sections and features discussed across all rounds.
IMPORTANT: Preserve ALL 【锚点：...】 anchor markers exactly as they are. Do NOT replace them with SKU paths — they will be automatically processed in the next step.
- Preserve ALL [chunk: xxx_chunk_xxx] references exactly as they appear — do not expand, replace, or remove them.""",

    "zh": """对话已达最大轮次。请将目前所有讨论内容整理为最终、整洁的 spec.md。

仅在 ```markdown 代码块内输出规格内容。不要额外评论。
包含所有轮次中讨论过的章节和功能。
重要：保留所有【锚点：...】锚点标记，不要替换为 SKU 路径——它们将在下一步自动处理。
- 保留所有 [chunk: xxx_chunk_xxx] 格式的引用，原样保留，不要展开、替换或删除。""",
}

ANCHOR_SYSTEM_PROMPT = {
    "en": """You are a reference anchoring assistant. Your ONLY task is to replace anchor markers in a spec draft with actual SKU references.

SKU INDEX:
{sku_index_summary}

RULES:
- Replace every 【锚点：description】 marker with the most semantically matching SKU reference
- Reference format: skus/CLASSIFICATION/SKU_ID  (e.g., skus/factual/sku_001, skus/procedural/skill_003)
- CLASSIFICATION is one of: factual, procedural, relational — use the value from the index
- SKU_ID is the id from the index (e.g., sku_001, skill_003)
- Preserve ALL existing [chunk: xxx_chunk_xxx] references exactly as they appear — these are valid chunk references, NOT anchor markers. Do NOT wrap them in 【锚点：...】 or modify them in any way.
- SPECIAL CASE: if an anchor marker already contains a [chunk: xxx_chunk_xxx] reference (e.g., 【锚点：[chunk: xxx] description】), REPLACE the entire anchor with the chunk reference alone, preserving the chunk identifier exactly. Do NOT output the 【锚点：...】 wrapper or extra brackets.
- Do NOT modify any other text in the spec — only replace anchor markers
- If no matching SKU exists in the index, keep the original 【锚点：description】 unchanged
- NEVER reference SKU IDs that are not listed in the index above
- Output the complete spec with replacements, wrapped in a ```markdown code block""",

    "zh": """你是一个引用锚定助手。你的唯一任务是将 spec 草稿中的锚点标记替换为实际的 SKU 引用。

SKU 索引：
{sku_index_summary}

规则：
- 将每个【锚点：描述】标记替换为语义最匹配的 SKU 引用
- 引用格式：skus/分类/SKU_ID 名称（如 skus/factual/sku_001 某某模式核心参数、skus/procedural/skill_003 某某流程设计规则）——每个 SKU 引用必须附带索引中的 name 字段，不允许只写路径
- 分类取值：factual、procedural、relational — 使用索引中的 classification 字段值
- SKU_ID 是索引中的 sku_id 字段值（如 sku_001、skill_003）
- 保留所有已有的 [chunk: xxx_chunk_xxx] 引用不变——这些是有效的 chunk 引用，不是锚点标记。不要用【锚点：...】包裹它们，也不要以任何方式修改它们。
- 特殊情况：如果【锚点：...】内部已经包含一个 [chunk: xxx_chunk_xxx] 引用（如【锚点：[chunk: xxx] 描述】），请用该 chunk 引用本身整体替换掉整个锚点，保留 chunk 标识符原样。不要输出【锚点：...】外壳，也不要增加多余的 `]`。
- 不要修改 spec 中的任何其他文字——只替换锚点标记
- 如果索引中没有匹配的 SKU，保留原始的【锚点：描述】不变
- 绝对不要引用索引中未列出的 SKU ID
- 输出完整的替换后 spec，用 ```markdown 代码块包裹""",
}

UI_MESSAGES = {
    "en": {
        "finalizing": "\nFinalizing spec draft...",
        "anchoring": "\nPhase 2: Replacing anchors with SKU references...",
        "spec_saved": "\nspec.md saved to {path}",
        "max_rounds": "\nMax rounds ({rounds}) reached. Auto-finalizing...",
        "remaining": "  ({remaining} round remaining — type /confirm to finalize)",
        "error_llm": "Error: Failed to get LLM response. Check your API key.",
        "error_response": "Error: Failed to get LLM response.",
        "chat_ended": "\nChat ended by user.",
        "anchor_degraded": "Warning: Anchor replacement failed, using draft with anchors as final output.",
        "anchors_all_replaced": "\nAll anchor markers successfully replaced with SKU references.",
        "anchors_remaining": "\nWarning: {count} anchor(s) not replaced:",
        "anchors_more": "  ... and {more} more",
        "anchor_count": "  Found {count} anchors, starting replacement...",
    },
    "zh": {
        "finalizing": "\n正在生成含锚点的 spec 草稿...",
        "anchoring": "\n阶段二：将锚点替换为 SKU 引用...",
        "spec_saved": "\nspec.md 已保存至 {path}",
        "max_rounds": "\n已达最大轮次（{rounds}）。自动生成最终规格...",
        "remaining": "  （剩余 {remaining} 轮——输入 /confirm 确认规格）",
        "error_llm": "错误：无法获取LLM响应。请检查API密钥。",
        "error_response": "错误：无法获取LLM响应。",
        "chat_ended": "\n用户结束对话。",
        "anchor_degraded": "警告：锚点替换失败，使用含锚点的草稿作为最终输出。",
        "anchors_all_replaced": "\n所有锚点已成功替换为 SKU 引用。",
        "anchors_remaining": "\n警告：{count} 个锚点未替换：",
        "anchors_more": "  ... 还有 {more} 个",
        "anchor_count": "  共发现 {count} 个锚点，开始替换...",
    },
}


# --- Utility Functions ---


def _mapping_titles_only(content: str) -> str:
    """Extract # and ## section headers from mapping.md for phase 1."""
    lines = content.split("\n")
    titles = [
        line for line in lines
        if line.strip().startswith("#") and not line.strip().startswith("### ")
    ]
    return "\n".join(titles)


def _compress_mapping(content: str, name_to_path: dict[str, str] | None = None) -> str:
    """
    Compress mapping.md by keeping section headers and SKU path lines.
    Strips verbose text to save tokens. Used as a fallback utility.

    If name_to_path is provided (name → "skus/classification/sku_XXX"),
    slug-based paths in mapping.md are replaced with real file paths inline.
    """
    lines = content.split("\n")
    compressed = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            compressed.append(line)
        elif stripped.startswith("- `"):
            compressed.append(line)
        elif stripped == "---":
            compressed.append(line)

    # Inline prefix normalization: ensure all paths have skus/ prefix
    resolved = []
    for line in compressed:
        stripped = line.strip()
        if stripped.startswith("- `") and "`:" in stripped:
            # Support both "skus/factual/sku_001" and "factual/sku_001" formats
            m = re.match(r"^(- `(?:skus/)?(\w+/)([^`]+)`:\s*)(.+)$", stripped)
            if m:
                _, cls_path, slug, desc = m.groups()
                # sku_XXX/skill_XXX: always add skus/ prefix
                if re.match(r"sku_\d+|skill_\d+", slug):
                    resolved.append(f"- `skus/{cls_path}{slug}`: {desc}")
                    continue
                # True slug (e.g. vpp-arch): try name-based matching if available
                if name_to_path:
                    for name, path in name_to_path.items():
                        if len(name) >= 2 and name in desc:
                            resolved.append(f"- `{path}`: {desc}")
                            break
                    else:
                        resolved.append(line)
                    continue
        resolved.append(line)
    matched = sum(1 for line in resolved if line.startswith("- `skus/"))
    logger.info("slug→path inline resolution", total_lines=len(compressed), matched=matched)
    compressed = resolved

    result = "\n".join(compressed)
    if len(result) > MAPPING_SUMMARY_MAX_CHARS:
        # Truncate by complete lines to avoid cutting mid-record
        result_lines = result.split("\n")
        truncated = []
        total = 0
        for line in result_lines:
            if total + len(line) + 1 > MAPPING_SUMMARY_MAX_CHARS:
                break
            truncated.append(line)
            total += len(line) + 1
        result = "\n".join(truncated) + "\n... (truncated)"
    return result


def _extract_spec(response: str) -> str:
    """
    Extract spec content from LLM response.

    Priority:
    1. ```markdown code block
    2. Largest ``` code block
    3. Full response if it starts with #
    """
    markdown_pattern = re.compile(r"```markdown\s*\n(.*?)```", re.DOTALL)
    match = markdown_pattern.search(response)
    if match:
        return match.group(1).strip()

    code_blocks = re.findall(r"```(?:\w*)\s*\n(.*?)```", response, re.DOTALL)
    if code_blocks:
        return max(code_blocks, key=len).strip()

    if response.strip().startswith("#"):
        return response.strip()

    return response.strip()


# --- Main Chatbot Class ---


class SpecChatbot:
    """Interactive chatbot that generates spec.md through a two-phase process."""

    def __init__(self, ontology_dir: Path):
        self.ontology_dir = Path(ontology_dir).resolve()
        self.max_rounds = settings.max_chat_rounds
        self.session = ChatSession(max_rounds=self.max_rounds)
        self.lang = settings.language
        self.ui = UI_MESSAGES[self.lang]

    def run(self) -> str:
        """
        Run the two-phase chatbot.

        Phase 1: Interactive interview, produces spec draft with anchor markers.
        Phase 2: Automatic anchor replacement, produces final spec with SKU references.

        Returns:
            The final spec content.
        """
        logger.info("Starting spec chatbot", max_rounds=self.max_rounds)

        # Build phase 1 context
        system_prompt = self._build_system_prompt()
        self.session.messages.append(ChatMessage(role="system", content=system_prompt))

        # Get initial greeting from LLM
        messages_for_api = [{"role": m.role, "content": m.content} for m in self.session.messages]
        try:
            greeting = call_llm_chat(messages_for_api)
        except Exception as e:
            logger.error("Failed to get initial greeting from LLM", error=str(e))
            click.echo(self.ui["error_llm"])
            return ""

        if not greeting:
            click.echo(self.ui["error_llm"])
            return ""

        self.session.messages.append(ChatMessage(role="assistant", content=greeting))
        click.echo(f"\nAssistant: {greeting}\n")

        # --- Phase 1: Interactive interview loop ---
        while self.session.rounds_used < self.max_rounds:
            try:
                user_input = click.prompt("You", type=str)
            except (click.Abort, EOFError, KeyboardInterrupt):
                click.echo(self.ui["chat_ended"])
                break

            if not user_input.strip():
                continue

            if user_input.strip().lower() == "/confirm":
                self.session.confirmed = True
                break

            self.session.messages.append(ChatMessage(role="user", content=user_input))
            self.session.rounds_used += 1

            remaining = self.max_rounds - self.session.rounds_used
            if remaining <= 1:
                click.echo(self.ui["remaining"].format(remaining=remaining))

            messages_for_api = [
                {"role": m.role, "content": m.content} for m in self.session.messages
            ]
            try:
                response = call_llm_chat(messages_for_api)
            except Exception as e:
                logger.error("LLM call failed during chat", error=str(e))
                click.echo(self.ui["error_response"])
                continue

            if not response:
                click.echo(self.ui["error_response"])
                continue

            self.session.messages.append(ChatMessage(role="assistant", content=response))
            click.echo(f"\nAssistant: {response}\n")

        # --- Phase 1 finalize: produce draft with anchor markers ---
        if self.session.confirmed:
            click.echo(self.ui["finalizing"])
        else:
            click.echo(self.ui["max_rounds"].format(rounds=self.max_rounds))

        spec_draft = self._finalize(confirmed=self.session.confirmed)
        if not spec_draft:
            return ""

        # --- Phase 2: Replace anchors with SKU references (independent LLM call) ---
        click.echo(self.ui["anchoring"])
        draft_anchor_count = len(ANCHOR_PATTERN.findall(spec_draft))
        click.echo(self.ui["anchor_count"].format(count=draft_anchor_count))
        spec_final = self._anchor_references(spec_draft)

        # Degrade: if phase 2 fails, use the anchor-containing draft
        if not spec_final:
            spec_final = spec_draft
            logger.warning("Phase 2 anchor replacement failed, using draft with anchors")
            click.echo(self.ui["anchor_degraded"])

        # Post-process: unwrap any anchors whose content is already valid SKU/chunk refs
        # (Phase 2 LLM sometimes re-wraps resolved references back into anchor markers)
        before_unwrap = len(ANCHOR_PATTERN.findall(spec_final))
        spec_final = self._unwrap_resolved_anchors(spec_final)
        after_unwrap = len(ANCHOR_PATTERN.findall(spec_final))
        logger.info("unwrap_resolved_anchors", before=before_unwrap, after=after_unwrap, unwrapped=before_unwrap - after_unwrap)

        # Normalize non-standard reference formats (【chunk: ...】 → [chunk: ...])
        spec_final = self._normalize_reference_format(spec_final)

        # Expand SKU ranges (e.g., sku_469-477 → individual refs)
        spec_final = self._expand_sku_ranges(spec_final)

        # Second normalize pass: clean up any concatenation introduced by range expansion
        spec_final = self._normalize_reference_format(spec_final)

        # Deduplicate SKU references within each ### section (must run after normalize)
        spec_final = self._dedup_sku_refs(spec_final)

        # Report remaining anchors
        self._report_anchors(spec_final)

        # Backup + save
        self.session.spec_content = spec_final
        self._save_spec(spec_final)
        click.echo(self.ui["spec_saved"].format(path=self.ontology_dir / "spec.md"))

        # Auto-validate spec.md pollution
        spec_path = self.ontology_dir / "spec.md"
        passed = validate_spec(spec_path)
        if not passed:
            click.echo("⚠ spec.md validation found pollution (see log for details)")

        return spec_final

    # --- Phase 1 methods ---

    def _build_name_to_path(self) -> dict[str, str]:
        """Build SKU name → file path lookup from skus_index.json."""
        index_path = self.ontology_dir / "skus" / "skus_index.json"
        if not index_path.exists():
            return {}
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
            lookup = {}
            for entry in data.get("skus", []):
                name = entry.get("name", "").strip()
                path = entry.get("path", "")
                if name and path:
                    lookup[name] = path
            logger.info("Built name_to_path lookup", entries=len(lookup))
            return lookup
        except Exception:
            return {}

    def _build_system_prompt(self) -> str:
        """Build system prompt with mapping titles and eureka content."""
        mapping_titles = ""
        eureka_content = ""

        name_to_path = self._build_name_to_path()

        mapping_path = self.ontology_dir / "mapping.md"
        if mapping_path.exists():
            content = mapping_path.read_text(encoding="utf-8")
            mapping_titles = _compress_mapping(content, name_to_path=name_to_path)
            logger.info(
                "Loaded mapping.md (compressed)",
                original_chars=len(content),
                compressed_chars=len(mapping_titles),
            )

        eureka_path = self.ontology_dir / "eureka.md"
        if eureka_path.exists():
            content = eureka_path.read_text(encoding="utf-8")
            if len(content) > EUREKA_SOFT_LIMIT:
                # Two-segment strategy: first chunk fully, keep title lines from the rest
                remaining = content[EUREKA_CHUNK_SIZE:]
                title_lines = [
                    line for line in remaining.split("\n")
                    if line.strip().startswith("## ")
                ]
                eureka_content = (
                    content[:EUREKA_CHUNK_SIZE]
                    + "\n\n--- 以下洞察仅保留标题 ---\n"
                    + "\n".join(title_lines)
                )
                logger.warning(
                    "eureka.md exceeds soft limit, using two-segment strategy",
                    total_chars=len(content),
                    soft_limit=EUREKA_SOFT_LIMIT,
                )
            else:
                eureka_content = content
            logger.info("Loaded eureka.md", chars=len(eureka_content))

        return SYSTEM_PROMPT_TEMPLATE[self.lang].format(
            mapping_titles=mapping_titles or "(no mapping available)",
            eureka_content=eureka_content or "(no eureka notes available)",
        )

    def _finalize(self, confirmed: bool = False, max_retries: int = 3) -> str | None:
        """Send finalize prompt within chat context and extract spec draft with anchors."""
        finalize_prompt = (
            FINALIZE_PROMPT[self.lang] if confirmed
            else AUTO_FINALIZE_PROMPT[self.lang]
        )
        self.session.messages.append(
            ChatMessage(role="user", content=finalize_prompt)
        )

        messages_for_api = [
            {"role": m.role, "content": m.content} for m in self.session.messages
        ]

        for attempt in range(1, max_retries + 1):
            try:
                response = call_llm_chat(messages_for_api)
                if response:
                    break
                logger.warning("Finalize attempt %d: LLM returned empty response", attempt)
            except Exception as e:
                logger.warning(
                    "Finalize attempt %d/%d failed", attempt, max_retries, error=str(e)
                )
                if attempt < max_retries:
                    wait = 5 * attempt  # 5s, 10s
                    logger.info("Retrying in %d seconds...", wait)
                    time.sleep(wait)
                    continue
                logger.error("Failed to finalize spec after %d attempts", max_retries)
                return None
        else:
            logger.error("Failed to finalize spec: all %d attempts exhausted", max_retries)
            return None

        if not response:
            logger.error("Failed to get final spec from LLM")
            return None

        self.session.messages.append(ChatMessage(role="assistant", content=response))
        return _extract_spec(response)

    # --- Phase 2 methods ---

    def _build_sku_index_summary(self) -> str:
        """
        Build SKU index summary grouped by classification for phase 2.

        Paths are derived from classification + sku_id (not from the path field),
        ensuring consistent skus/{classification}/{sku_id} format regardless of
        what skus_index.json stores.
        """
        index_path = self.ontology_dir / "skus" / "skus_index.json"
        if not index_path.exists():
            logger.warning("skus_index.json not found at %s", index_path)
            return ""

        data = json.loads(index_path.read_text(encoding="utf-8"))
        # Handle both {"skus": [...]} list format and {"sku_001": {...}} dict format
        if isinstance(data, dict) and "skus" in data:
            skus = data["skus"]
        elif isinstance(data, dict):
            # dict format: {"sku_001": {...}, "sku_002": {...}, ...}
            # skip metadata keys that aren't SKU entries
            skus = [
                v for v in data.values()
                if isinstance(v, dict) and ("sku_id" in v or "classification" in v)
            ]
        else:
            skus = []

        # Group by classification, format as sku_id | name | description
        groups: dict[str, list[str]] = {}
        for sku in skus:
            cls = sku.get("classification", "unknown")
            sku_id = sku.get("sku_id", "")
            name = sku.get("name", "")
            desc = sku.get("description", "")[:30]
            line = f"  {sku_id} | {name}"
            if desc:
                line += f" | {desc}"
            if cls not in groups:
                groups[cls] = []
            groups[cls].append(line)

        # Build summary in fixed order
        lines: list[str] = []
        for cls in ["factual", "procedural", "relational"]:
            if cls in groups:
                lines.append(f"## {cls}")
                lines.extend(groups[cls])
                lines.append("")

        result = "\n".join(lines)

        if len(result) > SKU_INDEX_MAX_CHARS:
            # Truncate by complete lines
            result_lines = result.split("\n")
            truncated: list[str] = []
            total = 0
            for line in result_lines:
                if total + len(line) + 1 > SKU_INDEX_MAX_CHARS:
                    break
                truncated.append(line)
                total += len(line) + 1
            result = "\n".join(truncated)
            result += "\n\n... (索引已截断，未列出的 SKU 请通过 mapping.md 查找)"
            logger.warning(
                "SKU index summary truncated",
                original_chars=len("\n".join(result_lines)),
                limit=SKU_INDEX_MAX_CHARS,
            )

        logger.info("Built SKU index summary", chars=len(result), sku_count=len(skus))
        return result

    def _anchor_references(self, spec_draft: str) -> str | None:
        """
        Phase 2: Replace anchor markers with SKU references using a single
        independent LLM call (call_llm, not call_llm_chat).

        Returns final spec with anchors replaced, or None on failure.
        """
        sku_index = self._build_sku_index_summary()
        if not sku_index:
            logger.warning("No SKU index available for anchor replacement")
            return None

        system_prompt = ANCHOR_SYSTEM_PROMPT[self.lang].format(
            sku_index_summary=sku_index,
        )

        try:
            response = call_llm(
                prompt=spec_draft,
                system_prompt=system_prompt,
                temperature=0.2,
                max_tokens=settings.chatbot_max_tokens,
            )

            if not response:
                logger.error("Phase 2: LLM returned empty response")
                return None

            spec_final = _extract_spec(response)
            if not spec_final:
                logger.error("Phase 2: failed to extract spec from LLM response")
                return None

            # Validate: extracted spec must contain at least one heading
            if not re.search(r"^#+\s", spec_final, re.MULTILINE):
                logger.error(
                    "Phase 2: extracted content has no markdown headings, likely not a valid spec",
                    preview=spec_final[:200],
                )
                return None

            # Record anchor phase for chat_log.json
            total_before = len(ANCHOR_PATTERN.findall(spec_draft))
            self.session.anchor_phase = AnchorPhase(
                system_prompt=system_prompt,
                user_prompt=spec_draft,
                response=response,
                total_anchors_before=total_before,
            )

            logger.info(
                "Phase 2 anchor replacement complete",
                draft_chars=len(spec_draft),
                final_chars=len(spec_final),
            )
            return spec_final

        except Exception as e:
            logger.error("Phase 2 anchor replacement failed", error=str(e))
            return None

    @staticmethod
    def _dedup_sku_refs(spec: str) -> str:
        """Remove duplicate SKU reference lines within each ### section, keeping first."""
        SKU_REF_PATTERN = re.compile(r"^skus/\S+$")
        sections = re.split(r"(^### .+$)", spec, flags=re.MULTILINE)
        result: list[str] = []
        for section in sections:
            if section.startswith("### "):
                result.append(section)
                continue
            seen: set[str] = set()
            deduped_lines: list[str] = []
            for line in section.split("\n"):
                stripped = line.strip()
                if SKU_REF_PATTERN.match(stripped):
                    if stripped in seen:
                        logger.debug("Deduped SKU reference", ref=stripped)
                        continue
                    seen.add(stripped)
                deduped_lines.append(line)
            result.append("\n".join(deduped_lines))
        return "".join(result)

    @staticmethod
    def _unwrap_resolved_anchors(spec: str) -> str:
        """
        Post-process: if an anchor marker already contains valid SKU paths or
        chunk references, unwrap it by replacing the whole 【锚点：...】 with
        its inner content (split by 、into separate lines).

        Handles two formats:
        - 【锚点：skus/factual/sku_001、[chunk: xxx_chunk_001]】  (old format)
        - 【锚点：chunk:xxx_chunk_001（description）】              (new format from Phase 2 LLM)
        """
        SKU_PATH_RE = re.compile(r"skus/(?:factual|procedural|relational)/\S+")
        CHUNK_REF_RE = re.compile(r"\[chunk:\s*[^\]]+\]")
        # Matches chunk:XXX_chunk_001 where XXX can include Chinese chars
        # Excludes [] to avoid capturing trailing ] from [chunk: xxx] format
        CHUNK_BARE_RE = re.compile(r"chunk:\s*([^\s（）()\[\]、]+)")

        def replacer(m: re.Match) -> str:
            inner = m.group(0)[4:-1]  # strip 【锚点： and 】

            # Format 1 (priority): skus/... or [chunk: ...] inline
            if SKU_PATH_RE.search(inner) or CHUNK_REF_RE.search(inner):
                parts = [p.strip() for p in inner.split("、") if p.strip()]
                return "\n".join(parts)

            # Format 2: chunk:XXX（description） → [chunk: XXX]
            bare_chunks = CHUNK_BARE_RE.findall(inner)
            if bare_chunks:
                return "\n".join(f"[chunk: {c}]" for c in bare_chunks)

            return m.group(0)  # leave unchanged

        return ANCHOR_PATTERN.sub(replacer, spec)

    @staticmethod
    def _normalize_reference_format(spec: str) -> str:
        """
        Post-process: normalize non-standard reference formats to canonical forms.

        - 【chunk: xxx】 → [chunk: xxx]     (Chinese brackets → standard brackets)
        - [chunk: xxx]]  → [chunk: xxx]     (fix duplicated closing brackets)
        - 【skus/...】   → skus/...          (Chinese brackets around SKU paths)
        - ref、ref       → one per line      (Chinese comma-separated refs → newline-separated)
        - skus/... skus/... → one per line   (space-separated SKU refs → newline-separated)
        - [chunk: a][chunk: b] → one per line (adjacent chunk refs → newline-separated)
        """
        # 【chunk: xxx】 → [chunk: xxx]  (use 【】 not [] in character class)
        spec = re.sub(r"【(chunk:\s*[^】]+)】", r"[\1]", spec)
        # Fix duplicated closing brackets: [chunk: xxx]] → [chunk: xxx]
        spec = re.sub(r"(\[chunk:\s*[^\]]+\])\]+", r"\1", spec)
        # 【skus/...】 → skus/...
        spec = re.sub(r"【(skus/(?:factual|procedural|relational)/\S+)】", r"\1", spec)
        # Zero-width concatenation: SKU glued to SKU (no whitespace)
        spec = re.sub(
            r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)(?=skus/)",
            r"\1\n",
            spec,
        )
        # Zero-width concatenation: SKU glued to [chunk:
        spec = re.sub(
            r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)(?=\[chunk:)",
            r"\1\n",
            spec,
        )
        # Zero-width concatenation: [chunk: ...] glued to skus/
        spec = re.sub(
            r"(\[chunk:\s*[^\]]+\])(?=skus/)",
            r"\1\n",
            spec,
        )
        # Chinese comma (、) separated refs → one per line
        # SKU、SKU
        spec = re.sub(
            r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)、",
            r"\1\n",
            spec,
        )
        # [chunk: ...]、ref
        spec = re.sub(
            r"(\[chunk:\s*[^\]]+\])、",
            r"\1\n",
            spec,
        )
        # ref、[chunk: ...] — the 、before a chunk ref
        spec = re.sub(
            r"、(\[chunk:\s*[^\]]+\])",
            r"\n\1",
            spec,
        )
        # Space-separated SKU refs on same line → one per line
        spec = re.sub(
            r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)\s+(?=skus/)",
            r"\1\n",
            spec,
        )
        # Adjacent chunk refs on same line → one per line
        spec = re.sub(
            r"(\[chunk:\s*[^\]]+\])(?=\[chunk:)",
            r"\1\n",
            spec,
        )
        return spec

    @staticmethod
    def _expand_sku_ranges(spec: str) -> str:
        """Expand SKU range refs like skus/factual/sku_469-477 into individual refs."""
        def replacer(m: re.Match) -> str:
            cls = m.group(1)
            start = int(m.group(2))
            end = int(m.group(3))
            if end < start or end - start > 50:
                return m.group(0)  # safety: don't expand huge ranges
            return "\n".join(
                f"skus/{cls}/sku_{i:03d}" for i in range(start, end + 1)
            )
        return re.sub(
            r"skus/(factual|procedural|relational)/sku_(\d{3})-(\d{3})",
            replacer,
            spec,
        )

    def _report_anchors(self, spec_final: str) -> None:
        """Count and report remaining (unreplaced) anchor markers."""
        anchors = ANCHOR_PATTERN.findall(spec_final)
        all_replaced = len(anchors) == 0

        # Write stats back to session.anchor_phase
        if self.session.anchor_phase is not None:
            self.session.anchor_phase.remaining_anchors = len(anchors)
            self.session.anchor_phase.all_replaced = all_replaced

        if anchors:
            click.echo(self.ui["anchors_remaining"].format(count=len(anchors)))
            for a in anchors[:10]:
                click.echo(f"  - {a}")
            if len(anchors) > 10:
                click.echo(self.ui["anchors_more"].format(more=len(anchors) - 10))
            logger.info("Remaining anchors", count=len(anchors), sample=anchors[:10])
        else:
            click.echo(self.ui["anchors_all_replaced"])
            logger.info("All anchors replaced successfully")

    # --- Save ---

    def _save_spec(self, content: str) -> None:
        """Save spec.md to ontology, backing up any existing version."""
        spec_path = self.ontology_dir / "spec.md"

        if spec_path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = self.ontology_dir / f"spec.md.bak.{timestamp}"
            spec_path.rename(backup_path)
            logger.info("Backed up existing spec.md", backup=str(backup_path))

        spec_path.write_text(content, encoding="utf-8")
        logger.info("Saved spec.md", path=str(spec_path), chars=len(content))

    def get_session(self) -> ChatSession:
        """Return the current chat session for logging."""
        return self.session
