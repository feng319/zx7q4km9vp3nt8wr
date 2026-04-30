"""Relational knowledge extractor - read-and-update mode."""

import json
from pathlib import Path
from typing import Any

import structlog

from chunks2skus.config import settings
from chunks2skus.schemas.sku import (
    Glossary,
    GlossaryEntry,
    LabelNode,
    LabelTree,
    Relationship,
    RelationType,
    Relationships,
    SKUHeader,
    SKUType,
)
from chunks2skus.utils.llm_client import call_llm_json

from .base import BaseExtractor

logger = structlog.get_logger(__name__)


# [DEPRECATED] Old full-output prompt — kept for rollback reference only
# RELATIONAL_PROMPT replaced by RELATIONAL_INCREMENTAL_PROMPT (v1.0)

# Incremental prompt — only extract NEW knowledge, output deltas
RELATIONAL_INCREMENTAL_PROMPT = {
    "en": '''You are maintaining a domain knowledge base, extracting INCREMENTAL knowledge from a new document chunk.

EXISTING LABEL HIERARCHY:
{label_tree}

EXISTING TERMS (names only, {glossary_count} total):
{term_list}

ALIAS MAPPING (abbreviation/alternative → standard term):
{alias_map}

EXISTING RELATIONSHIPS relevant to this content:
{relevant_relations}

NEW CHUNK CONTENT:
{content}

TASK:
Extract ONLY new knowledge from this chunk. For existing terms, only re-output if there is new information to add.

Output ONLY valid JSON:
{{
  "new_labels": [
    {{"name": "New Category", "parent_path": "Parent > Subcategory"}}
  ],
  "new_glossary": [
    {{
      "term": "New Term",
      "definition": "Clear definition of the term",
      "labels": ["Category", "Subcategory"],
      "aliases": ["Abbreviation", "Alternative Name"],
      "related_terms": ["OtherTerm1", "OtherTerm2"]
    }}
  ],
  "updated_glossary": [
    {{
      "term": "Existing Term",
      "definition": "More complete definition",
      "new_aliases": ["New Alias"],
      "new_related_terms": []
    }}
  ],
  "new_relationships": [
    {{
      "subject": "Concept A",
      "predicate": "causes",
      "object": "Concept B",
      "confidence": 4
    }}
  ]
}}

Valid predicates: "is-a", "has-a", "part-of", "causes", "caused-by", "requires", "enables", "contradicts", "related-to", "depends-on", "regulates", "implements", "example-of", "certifies", "superset-of"

- certifies: certification/accreditation relationship (e.g., "Green Certificate certifies Green Power")
- superset-of: containment/superset relationship, from larger concept to smaller (e.g., "Renewable Energy superset-of Virtual Power Plant" — Renewable Energy contains VPP as a subcategory)
- is-a: ONLY for "X is an instance of Y" (individual → type), NOT for type-to-type subsumption — use superset-of for type subsumption
  Wrong: "光储直柔微电网 is-a 交直流微电网" (should be superset-of)
  Correct: "广德城市级虚拟电厂 is-a 虚拟电厂项目"
- example-of: instance-to-type relationship, direction is instance → type (e.g., "GCL Virtual Power Plant example-of Load-type VPP"). Note: subject must be a specific instance, object must be an abstract category; direction is NOT reversible
- Prefer precise predicates (certifies, superset-of, example-of) over related-to when applicable
- superset-of direction: from larger concept → smaller concept (A superset-of B means A contains B)

Guidelines:
- new_labels: only NEW categories. Use parent_path to specify where to attach (e.g., "Finance > Risk"). Use empty parent_path for top-level.
- When adding a child to an existing parent node:
  1. First check the classification dimension used by existing siblings
  2. If the new child fits the same dimension, add it directly
  3. If the new child belongs to a different dimension, create a new subtree
  Example: If "Virtual Power Plant" already has "Grid-type/Selling-type/Generation-type" (by function), and you want to add "City-scale" (by scale), create "Virtual Power Plant > By Scale > City-scale"
- new_glossary: only terms NOT in the existing term list above
- updated_glossary: EXISTING terms that need better definitions or new aliases
- new_relationships: only relationships clearly stated in this chunk
- confidence: integer 1-5 (1=speculative, 5=explicitly stated). Omit if unsure.
- Keep definitions concise but complete
- Glossary definition rules:
  - Definitions must be generic, applicable in any context where the term is used
  - Do NOT include specific company names, project names, or place names in definitions
  - If the document only provides a company-specific usage, abstract it into a general definition
    ❌ "GCL can act as the EPC contractor for heavy truck battery swap stations"
    ✅ "A party that takes overall responsibility for the design, procurement, and construction of an engineering project"
- For aliases: include abbreviations (e.g., "G-SIB" for "Global Systemically Important Banks")
- For relationships: only extract clearly stated relationships, not speculative ones
- If nothing new is found in a section, output an empty array
''',

    "zh": '''你正在维护一个领域知识库，从新文档片段中提取增量知识。

现有分类体系：
{label_tree}

现有术语列表（仅术语名，共{glossary_count}条）：
{term_list}

术语别名映射（缩写/别名 → 标准术语）：
{alias_map}

与当前内容相关的已有关系：
{relevant_relations}

新文档片段内容：
{content}

任务：
仅提取本片段中的新知识。对于已有术语，仅在有新信息需要补充时才重新输出。

仅输出合法JSON：
{{
  "new_labels": [
    {{"name": "新分类名", "parent_path": "父分类 > 子分类"}}
  ],
  "new_glossary": [
    {{
      "term": "术语",
      "definition": "定义",
      "labels": ["分类"],
      "aliases": [],
      "related_terms": []
    }}
  ],
  "updated_glossary": [
    {{
      "term": "已有术语",
      "definition": "更完整的定义",
      "new_aliases": ["新别名"],
      "new_related_terms": []
    }}
  ],
  "new_relationships": [
    {{"subject": "A", "predicate": "causes", "object": "B", "confidence": 4}}
  ]
}}

合法谓词： "is-a", "has-a", "part-of", "causes", "caused-by", "requires", "enables", "contradicts", "related-to", "depends-on", "regulates", "implements", "example-of", "certifies", "superset-of"

- certifies：认证关系（如"绿证 certifies 绿电"）
- superset-of：包含/超集关系，从大概念指向小概念（如"新能源发电 superset-of 虚拟电厂"——新能源发电包含虚拟电厂这一子类）
- is-a：仅用于"X 是 Y 的一个实例"（个体与类型），不用于类型与类型之间的归属——类型归属用 superset-of
  错误示例：光储直柔微电网 is-a 交直流微电网（应用 superset-of）
  正确示例：广德城市级虚拟电厂 is-a 虚拟电厂项目
- example-of：实例归属关系，方向为 实例 → 类型（如"协鑫虚拟电厂 example-of 负荷型虚拟电厂"）。注意：主语必须是具体实例，宾语必须是抽象类别，方向不可反转
- 优先使用精确谓词（certifies、superset-of、example-of），仅在确实无法归类时使用 related-to
- superset-of 方向：从大概念 → 小概念（A superset-of B 表示 A 包含 B）

注意事项：
- new_labels: 仅新增的分类，用 parent_path 指定挂在哪个父节点下（如"金融 > 风险"），空字符串表示顶层
- 当向已有父节点添加子类时：
  1. 先检查该父节点现有子类使用的分类维度
  2. 如果新子类与现有子类在同一维度，直接添加
  3. 如果新子类属于不同维度，创建新的子树
  示例：虚拟电厂下已有"电网系/售电型/发电类型"（按功能分类），如果要添加"城市级"（按规模分类），应创建"虚拟电厂 > 按规模 > 城市级"
- new_glossary: 仅本片段中新出现的术语（不在上方术语列表中的）
- updated_glossary: 已有术语的补充信息（更完整的定义、新别名等）
- new_relationships: 仅本片段中明确陈述的关系
- confidence: 整数1-5（1=推测性，5=明确陈述）。不确定时可省略。
- 定义应简洁但完整
- glossary 定义规则：
  - 定义必须是该术语的通用含义，适用于任何使用该术语的场景
  - 禁止在定义中出现具体企业名、项目名、地名
  - 如果文档中只有该术语的特定企业用法，用该用法归纳出通用定义，而非直接引用原文
    ❌ "国海绿能可作为重卡换电站项目的EPC总包方"
    ✅ "对工程项目的设计、采购、施工全过程进行总承包的方"
- 别名：包括缩写（如"全球系统重要性银行"的缩写"G-SIB"）
- 关系：仅提取明确陈述的关系，不做推测
- 如果某部分没有新内容，输出空数组
''',
}


class RelationalExtractor(BaseExtractor):
    """
    Extracts relational knowledge from chunks.

    Operates in read-and-update mode:
    - Reads existing label_tree.json and glossary.json
    - Updates them with new knowledge from each chunk
    - Provides context for Meta extractor
    """

    extractor_name = "relational"
    sku_type = SKUType.RELATIONAL

    def __init__(self, output_dir: Path):
        super().__init__(output_dir)
        self.label_tree_path = self.type_dir / "label_tree.json"
        self.glossary_path = self.type_dir / "glossary.json"
        self.relationships_path = self.type_dir / "relationships.json"
        self.header_path = self.type_dir / "header.md"

        # Load or initialize data structures
        self.label_tree = self._load_label_tree()
        self.glossary = self._load_glossary()
        self.relationships = self._load_relationships()

        # Create header.md on first run
        if not self.header_path.exists():
            self._create_header()

    def _load_label_tree(self) -> LabelTree:
        """Load existing label tree or create empty one."""
        if self.label_tree_path.exists():
            try:
                data = json.loads(self.label_tree_path.read_text(encoding="utf-8"))
                return LabelTree.model_validate(data)
            except Exception as e:
                logger.warning("Failed to load label tree", error=str(e))
        return LabelTree()

    def _load_glossary(self) -> Glossary:
        """Load existing glossary or create empty one."""
        if self.glossary_path.exists():
            try:
                data = json.loads(self.glossary_path.read_text(encoding="utf-8"))
                return Glossary.model_validate(data)
            except Exception as e:
                logger.warning("Failed to load glossary", error=str(e))
        return Glossary()

    def _load_relationships(self) -> Relationships:
        """Load existing relationships or create empty collection."""
        if self.relationships_path.exists():
            try:
                data = json.loads(self.relationships_path.read_text(encoding="utf-8"))
                return Relationships.model_validate(data)
            except Exception as e:
                logger.warning("Failed to load relationships", error=str(e))
        return Relationships()

    def _create_header(self) -> None:
        """Create header.md for relational knowledge."""
        header = SKUHeader(
            name="relational-knowledge-base",
            classification=SKUType.RELATIONAL,
            character_count=0,  # Updated on save
            source_chunk="aggregated",
            description="Domain label hierarchy and terminology glossary",
        )
        self.header_path.write_text(header.to_markdown(), encoding="utf-8")

    def _save_data(self) -> None:
        """Save label tree, glossary, and relationships to disk."""
        # Save label tree
        self.label_tree_path.write_text(
            self.label_tree.model_dump_json(indent=2),
            encoding="utf-8",
        )

        # Save glossary
        self.glossary_path.write_text(
            self.glossary.model_dump_json(indent=2),
            encoding="utf-8",
        )

        # Save relationships
        self.relationships_path.write_text(
            self.relationships.model_dump_json(indent=2),
            encoding="utf-8",
        )

        # Update header with character count
        total_chars = self._get_total_chars()
        header = SKUHeader(
            name="relational-knowledge-base",
            classification=SKUType.RELATIONAL,
            character_count=total_chars,
            source_chunk="aggregated",
            description="Domain label hierarchy, terminology glossary, and typed relationships",
        )
        self.header_path.write_text(header.to_markdown(), encoding="utf-8")

    def extract(
        self,
        content: str,
        chunk_id: str,
        context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Update relational knowledge from content.

        Args:
            content: Chunk content to process
            chunk_id: Identifier of the source chunk
            context: Optional context from factual extractor

        Returns:
            List with single SKU info dict (the relational knowledge base)
        """
        logger.info("Extracting relational knowledge", chunk_id=chunk_id)

        # Prepare context using indented tree + term names + alias map + relevant relations
        label_summary = self._summarize_label_tree(max_chars=4000)

        glossary_count = len(self.glossary.entries)
        term_list = self._truncate_term_list(
            ", ".join(entry.term for entry in self.glossary.entries),
            max_chars=4000,
        )

        # Alias mapping and relevant relations for entity disambiguation
        alias_map = self._get_alias_map()
        relevant_relations = self._get_relevant_relations(content)

        # Monitor context size for prompt inflation detection
        label_nodes_count = sum(
            1 for _ in self._walk_tree(self.label_tree.roots)
        )
        logger.info(
            "Relational context size",
            label_tree_chars=len(label_summary),
            term_list_chars=len(term_list),
            alias_map_chars=len(alias_map),
            relevant_relations_chars=len(relevant_relations),
            glossary_count=glossary_count,
            label_nodes_count=label_nodes_count,
            chunk_id=chunk_id,
        )
        if len(label_summary) > 3000:
            logger.warning(
                "Label tree context growing large",
                label_tree_chars=len(label_summary),
                chunk_id=chunk_id,
            )
        if len(term_list) > 2000:
            logger.warning(
                "Term list context growing large",
                term_list_chars=len(term_list),
                chunk_id=chunk_id,
            )

        # Call LLM for incremental extraction
        prompt = RELATIONAL_INCREMENTAL_PROMPT[settings.language].format(
            label_tree=label_summary,
            term_list=term_list,
            glossary_count=glossary_count,
            alias_map=alias_map,
            relevant_relations=relevant_relations,
            content=content,
            chunk_id=chunk_id,
        )
        parsed = call_llm_json(prompt, max_tokens=128000)

        if not parsed:
            logger.warning("Failed to get relational extraction response", chunk_id=chunk_id)
            return []

        # --- Merge new labels ---
        if "new_labels" in parsed:
            new_label_count = 0
            for label_data in parsed["new_labels"]:
                name = label_data.get("name", "")
                parent_path_str = label_data.get("parent_path", "")

                if not name:
                    continue

                if parent_path_str:
                    # Parse parent_path "Parent > Sub" -> ["Parent", "Sub"]
                    parent_parts = [p.strip() for p in parent_path_str.split(">")]
                    path = parent_parts + [name]
                else:
                    path = [name]  # Top-level category

                self.label_tree.add_path(path)
                new_label_count += 1

            logger.info("Added new labels", count=new_label_count, chunk_id=chunk_id)

        # --- Merge new glossary entries ---
        if "new_glossary" in parsed:
            try:
                new_glossary = Glossary(
                    entries=[
                        GlossaryEntry(
                            term=e["term"],
                            definition=e["definition"],
                            labels=e.get("labels", []),
                            source_chunks=[chunk_id],
                            source_chunk=chunk_id,
                            aliases=e.get("aliases", []),
                            related_terms=e.get("related_terms", []),
                        )
                        for e in parsed["new_glossary"]
                    ]
                )
                self._merge_glossary(new_glossary)
                logger.info(
                    "Merged new glossary entries",
                    count=len(new_glossary.entries),
                    chunk_id=chunk_id,
                )
            except Exception as e:
                logger.warning("Failed to parse new glossary", error=str(e))

        # --- Merge updated glossary entries ---
        updated_count = 0
        fallback_count = 0
        if "updated_glossary" in parsed:
            for entry_data in parsed["updated_glossary"]:
                term = entry_data.get("term", "")
                existing = self.glossary.get_entry(term)

                if existing:
                    # Update definition (keep longer one)
                    new_def = entry_data.get("definition", "")
                    if new_def and len(new_def) > len(existing.definition):
                        existing.definition = new_def
                    # Merge new aliases
                    for alias in entry_data.get("new_aliases", []):
                        if alias and not any(
                            a.lower() == alias.lower() for a in existing.aliases
                        ):
                            existing.aliases.append(alias)
                    # Merge new related terms
                    for rt in entry_data.get("new_related_terms", []):
                        if rt not in existing.related_terms:
                            existing.related_terms.append(rt)
                    updated_count += 1
                else:
                    # Term not found — fall back to add_or_update
                    # This may create a near-duplicate entry, but is better
                    # than silently discarding the update. Dedup can handle later.
                    logger.debug(
                        "updated_glossary entry not found, treating as new",
                        term=term,
                        chunk_id=chunk_id,
                    )
                    try:
                        new_entry = GlossaryEntry(
                            term=term,
                            definition=entry_data.get("definition", ""),
                            labels=entry_data.get("labels", []),
                            source_chunks=[chunk_id],
                            source_chunk=chunk_id,
                            aliases=entry_data.get("new_aliases", []),
                            related_terms=entry_data.get("new_related_terms", []),
                        )
                        self.glossary.add_or_update(new_entry)
                        fallback_count += 1
                    except Exception as e:
                        logger.warning(
                            "Failed to add fallback glossary entry",
                            term=term,
                            error=str(e),
                        )

            logger.info(
                "Updated existing glossary entries",
                updated_count=updated_count,
                fallback_count=fallback_count,
                total_in_response=len(parsed.get("updated_glossary", [])),
                chunk_id=chunk_id,
            )

        # --- Merge relationships ---
        if "new_relationships" in parsed:
            try:
                for rel_data in parsed["new_relationships"]:
                    predicate_str = rel_data.get("predicate", "related-to")
                    try:
                        predicate = RelationType(predicate_str)
                    except ValueError:
                        logger.warning(
                            "Unknown predicate from LLM, falling back to related-to",
                            raw_predicate=predicate_str,
                            chunk_id=chunk_id,
                        )
                        predicate = RelationType.RELATED_TO
                    rel = Relationship(
                        subject=rel_data["subject"],
                        predicate=predicate,
                        object=rel_data["object"],
                        source_chunks=rel_data.get("source_chunks", [chunk_id]),
                    )
                    # Map confidence from 1-5 int to 0.2-1.0 float
                    confidence_raw = rel_data.get("confidence")
                    if confidence_raw and isinstance(confidence_raw, (int, float)):
                        rel.confidence = max(0.2, min(1.0, float(confidence_raw) / 5.0))
                    self.relationships.add(rel)
                logger.info(
                    "Merged new relationships",
                    count=len(parsed["new_relationships"]),
                    chunk_id=chunk_id,
                )
            except Exception as e:
                logger.warning("Failed to parse relationships", error=str(e))

        # Predicate distribution monitoring (v3.0 — triple detection)
        predicate_counts: dict[str, int] = {}
        for rel in self.relationships.entries:
            p = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
            predicate_counts[p] = predicate_counts.get(p, 0) + 1
        if predicate_counts:
            total_rels = len(self.relationships.entries)
            logger.info(
                "Relationship predicate distribution",
                total=total_rels,
                distribution=predicate_counts,
            )
            # 1. Absolute count over 20 — info level (not warning)
            overuse = {p: c for p, c in predicate_counts.items() if c > 20}
            if overuse:
                logger.info("Predicate count over 20", predicates=overuse)

            # 2. Ratio over 30% — warning level
            for pred, count in predicate_counts.items():
                if count / total_rels > 0.3:
                    logger.warning(
                        "Predicate ratio exceeds 30%",
                        predicate=pred,
                        count=count,
                        total=total_rels,
                        ratio=f"{count/total_rels:.1%}",
                    )

            # 3. Same object has >5 is-a children — warning level
            isa_by_object: dict[str, int] = {}
            for rel in self.relationships.entries:
                pred_val = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
                if pred_val == "is-a":
                    isa_by_object[rel.object] = isa_by_object.get(rel.object, 0) + 1
            for obj, count in isa_by_object.items():
                if count > 5:
                    logger.warning(
                        "Same object has >5 is-a children",
                        object=obj,
                        is_a_count=count,
                    )

        # Save updated data
        self._save_data()

        logger.info(
            "Relational extraction complete",
            chunk_id=chunk_id,
            labels=len(self.label_tree.roots),
            terms=len(self.glossary.entries),
            relationships=len(self.relationships.entries),
        )

        return [
            {
                "sku_id": "relational-knowledge-base",
                "name": "relational-knowledge-base",
                "classification": SKUType.RELATIONAL,
                "path": f"{self.sku_type.value}",
                "source_chunk": "aggregated",
                "character_count": self._get_total_chars(),
                "description": "Domain label hierarchy and terminology glossary",
            }
        ]

    # [DEPRECATED] _merge_label_tree and _merge_node removed in v2.0
    # Incremental mode uses label_tree.add_path() instead

    def _merge_glossary(self, new_glossary: Glossary) -> None:
        """Merge new glossary entries into existing glossary."""
        for entry in new_glossary.entries:
            self.glossary.add_or_update(entry)

    def _get_total_chars(self) -> int:
        """Get total character count of relational knowledge."""
        total = 0
        for path in [self.label_tree_path, self.glossary_path, self.relationships_path]:
            if path.exists():
                total += len(path.read_text(encoding="utf-8"))
        return total

    def _summarize_label_tree(self, max_chars: int = 4000) -> str:
        """Summarize label tree as indented text (v3.0).

        Outputs an indented tree that preserves hierarchy and sibling relationships
        while being more token-efficient than flat path lists.
        Truncates at subtree boundaries to avoid cutting nodes mid-way.
        """
        result_lines: list[str] = []
        total = 0

        def add_node(node: "LabelNode", indent: int) -> bool:
            """Add a node and its children. Returns False if truncated."""
            nonlocal total
            line = " " * indent + node.name
            if total + len(line) + 1 > max_chars:
                return False
            result_lines.append(line)
            total += len(line) + 1

            for child in node.children:
                if not add_node(child, indent + 2):
                    # Could not fit child — add truncation marker
                    remaining = _count_subtree(child)
                    suffix = " " * (indent + 2) + (
                        f"... 还有 {remaining} 个节点" if settings.language == "zh"
                        else f"... {remaining} more nodes"
                    )
                    if total + len(suffix) + 1 <= max_chars:
                        result_lines.append(suffix)
                        total += len(suffix) + 1
                    return False
            return True

        def _count_subtree(node: "LabelNode") -> int:
            """Count all nodes in a subtree."""
            count = 1
            for child in node.children:
                count += _count_subtree(child)
            return count

        for root in self.label_tree.roots:
            if not add_node(root, 0):
                break

        return "\n".join(result_lines)

    def _walk_tree(self, roots: list["LabelNode"]):
        """Yield all nodes in the tree for counting."""
        for root in roots:
            yield root
            yield from self._walk_tree(root.children)

    def _get_alias_map(self) -> str:
        """Generate alias → standard term mapping from glossary (v3.0)."""
        lines = []
        for entry in self.glossary.entries:
            if entry.aliases:
                aliases_str = ", ".join(entry.aliases)
                lines.append(f"{aliases_str} → {entry.term}")
        return "\n".join(lines) if lines else "(无别名)" if settings.language == "zh" else "(no aliases)"

    def _get_relevant_relations(self, content: str, max_relations: int = 40) -> str:
        """Get existing relationships relevant to current chunk content (v3.0).

        Uses substring matching for broader coverage — relationship subjects/objects
        may be compound expressions (e.g., "虚拟电厂运营模式" ≠ "虚拟电厂").
        """
        # Collect terms mentioned in content (including aliases)
        mentioned_terms: set[str] = set()
        for entry in self.glossary.entries:
            # Filter out single-character terms (e.g., "电") that cause false positives
            # in Chinese content. Harmless for English where terms are rarely single chars.
            if len(entry.term) >= 2 and entry.term in content:
                mentioned_terms.add(entry.term.lower())
            for alias in entry.aliases:
                if len(alias) >= 2 and alias in content:
                    mentioned_terms.add(entry.term.lower())
            for rt in entry.related_terms:
                if len(rt) >= 2 and rt in content:
                    mentioned_terms.add(rt.lower())

        # Filter relevant relationships using substring matching
        relevant = []
        for rel in self.relationships.entries:
            sub = rel.subject.lower()
            obj = rel.object.lower()
            if any(t in sub for t in mentioned_terms) or any(t in obj for t in mentioned_terms):
                pred = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
                relevant.append(f"- {rel.subject} {pred} {rel.object}")
            if len(relevant) >= max_relations:
                break

        return "\n".join(relevant) if relevant else "(无相关已有关系)" if settings.language == "zh" else "(no relevant relations)"

    def _truncate_term_list(self, term_list: str, max_chars: int = 4000) -> str:
        """Truncate term list at comma boundaries to keep terms complete."""
        if len(term_list) <= max_chars:
            return term_list
        # Find last comma within limit to avoid cutting a term name in half
        last_comma = term_list.rfind(", ", 0, max_chars)
        if last_comma == -1:
            return term_list[:max_chars] + ", ..."
        return term_list[:last_comma] + ", ..."

    def get_context_for_next(self) -> dict[str, Any]:
        """Provide label tree, glossary, and relationships to next extractors."""
        return {
            "label_tree": self.label_tree,
            "glossary": self.glossary,
            "relationships": self.relationships,
        }
