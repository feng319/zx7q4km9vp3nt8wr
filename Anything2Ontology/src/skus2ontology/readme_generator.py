"""Step 3: Generate README.md for the ontology."""

from pathlib import Path

import structlog

from skus2ontology.config import settings
from skus2ontology.schemas.ontology import OntologyManifest

logger = structlog.get_logger(__name__)

README_TEMPLATE = {
    "en": """# Ontology

## Quick Start

1. **Read `spec.md`** — what to build
2. **Use `mapping.md`** — navigate SKUs by feature
3. **Check `eureka.md`** — creative ideas and cross-cutting insights

## Structure

```
ontology/
├── spec.md                      # App specification
├── mapping.md                   # SKU router — find the right knowledge
├── eureka.md                    # Creative insights and feature ideas
├── chunk_to_sku.json            # Chunk → SKU candidate mapping
├── chunks_index.json            # Chunk metadata index
├── ontology_manifest.json       # Assembly metadata
├── chat_log.json                # Chatbot conversation log
└── skus/
    ├── factual/                 # Facts, definitions, data (header.md + content)
    ├── procedural/              # Skills and workflows (header.md + SKILL.md)
    ├── relational/              # Label tree + glossary
    ├── postprocessing/          # Bucketing, dedup, confidence reports
    └── skus_index.json          # Master index of all SKUs
```

## SKU Types

| Type | Description | Files |
|------|-------------|-------|
| **Factual** | Facts, definitions, data points, statistics | `header.md` + `content.md` or `content.json` |
| **Procedural** | Workflows, skills, step-by-step processes | `header.md` + `SKILL.md` |
| **Relational** | Category hierarchy and glossary | `label_tree.json` + `glossary.json` |

## Stats

{stats_section}

## How to Use

1. Start with `spec.md` to understand what the app should do
2. Use `mapping.md` to find relevant SKUs for each feature
3. Read SKU `header.md` files for quick summaries before loading full content
4. Reference `eureka.md` for creative ideas that connect multiple knowledge areas

## spec.md Reference Format

`spec.md` contains three types of references:

1. **Direct SKU refs**: `skus/factual/sku_001`, `skus/procedural/skill_001` — read the corresponding path directly.
2. **Chunk refs**: `[chunk: xxx_chunk_xxx]` — look up `chunk_to_sku.json` for candidate SKUs under that chunk, then read the matching candidates' `path`.
3. **Unresolved anchors**: `【锚点：description】` — no exact SKU match exists in the knowledge base. Treat as a knowledge gap or external resource need.

## Agent Query Protocol

When reading `spec.md`, follow these rules for each reference type:

| Reference Type | Action |
|----------------|--------|
| `[skus/factual/sku_xxx]` or `[skus/procedural/skill_xxx]` | **Direct read** → `read_file` the corresponding `header.md` + content |
| `[chunk: xxx_chunk_xxx]` | **Chunk lookup** → Step 1: open `chunk_to_sku.json`, find the chunk key → Step 2: scan ALL entries' `keywords` and `name` fields to find semantically matching ones → Step 3: read the matched entries (`rank` is a tiebreaker only, not semantic relevance) → Step 4: if no keywords match, read rank 1-3 as fallback |
| `【锚点：insight title】` (unresolved anchor) | **Eureka bridge** → Step 1: search `eureka.md` for the insight title → Step 2: extract chunk identifier(s) from `[...]` brackets → Step 3: open `chunk_to_sku.json`, find the chunk key(s) → Step 4: use keywords/name to filter, then read the top 3 entries per chunk → Step 5: merge and deduplicate by sku_id |
| Topic-level query (no specific reference) | **Mapping** → find the relevant section in `mapping.md`, then read listed SKU files |
| View tag hierarchy, glossary, relations | **Relational** → read files in `skus/relational/` (label_tree.json, glossary.json) |

> **Key rules:**
> - `rank` reflects type priority (factual → procedural → relational) then ID order — it does NOT indicate semantic relevance to your query.
> - Always scan ALL entries' `keywords` and `name` fields first to find semantically matching ones, then read only those.
> - Use `rank` only as a tiebreaker when multiple entries seem equally relevant.
> - When multiple chunks are referenced, merge their candidate lists and deduplicate by `sku_id` before reading.
""",

    "zh": """# 本体

## 快速开始

1. **阅读 `spec.md`** — 了解要构建什么
2. **使用 `mapping.md`** — 按功能导航SKU
3. **查看 `eureka.md`** — 创意和跨领域洞察

## 目录结构

```
ontology/
├── spec.md                      # 应用规格说明
├── mapping.md                   # SKU路由 — 找到正确的知识
├── eureka.md                    # 创意洞察和功能构想
├── chunk_to_sku.json            # chunk 到 SKU 的候选映射
├── chunks_index.json            # chunk 元数据索引
├── ontology_manifest.json       # 组装元数据
├── chat_log.json                # 对话记录
└── skus/
    ├── factual/                 # 事实、定义、数据（header.md + content）
    ├── procedural/              # 技能和工作流（header.md + SKILL.md）
    ├── relational/              # 标签树 + 术语表
    ├── postprocessing/          # 分桶、去重、置信度报告
    └── skus_index.json          # 所有SKU的主索引
```

## SKU 类型

| 类型 | 描述 | 文件 |
|------|------|------|
| **事实型** | 事实、定义、数据点、统计 | `header.md` + `content.md` 或 `content.json` |
| **程序型** | 工作流、技能、分步流程 | `header.md` + `SKILL.md` |
| **关系型** | 分类层级和术语表 | `label_tree.json` + `glossary.json` |

## 统计

{stats_section}

## 使用方法

1. 从 `spec.md` 开始，了解应用的功能目标
2. 使用 `mapping.md` 为每个功能找到相关SKU
3. 阅读SKU的 `header.md` 了解摘要，再按需加载完整内容
4. 参考 `eureka.md` 获取连接多个知识领域的创意

## spec.md 引用格式

`spec.md` 中可能出现三类引用：

1. **直接 SKU 引用**：`skus/factual/sku_001`、`skus/procedural/skill_001` — 直接读取对应路径
2. **chunk 引用**：`[chunk: 商业模式与资本运营_chunk_001]` — 先查 `chunk_to_sku.json` 中对应 chunk 的候选 SKU，再读取候选项的 `path`
3. **残留锚点**：`【锚点：描述】` — 当前知识库暂无精确 SKU 对应，应作为待补知识或外部资源需求处理

## Agent 查询协议

阅读 `spec.md` 时，遇到不同引用类型按以下规则处理：

| 引用类型 | 操作步骤 |
|----------|----------|
| `[skus/factual/sku_xxx]` 或 `[skus/procedural/skill_xxx]` | **直接读取** → `read_file` 对应的 `header.md` + content |
| `[chunk: xxx_chunk_xxx]` | **Chunk 查询** → 步骤1：打开 `chunk_to_sku.json`，找到 chunk 键 → 步骤2：扫描所有条目的 `keywords` 和 `name`，找出语义匹配的条目 → 步骤3：读取匹配的条目（`rank` 仅作同等相关时的参考，不代表语义相关度）→ 步骤4：如无 keywords 匹配，退回读取 rank 1-3 兜底 |
| `【锚点：洞察标题】`（未替换的残留锚点） | **Eureka 桥接** → 步骤1：在 `eureka.md` 中搜索洞察标题 → 步骤2：从方括号 `[...]` 中提取 chunk 标识 → 步骤3：打开 `chunk_to_sku.json`，找到 chunk 键 → 步骤4：用 keywords/name 筛选，每个 chunk 读取前3条 → 步骤5：合并后按 sku_id 去重 |
| 主题级查询（无具体引用） | **Mapping** → 在 `mapping.md` 中找到相关分组，读取列出的 SKU 文件 |
| 查看标签树、术语表和关系型知识 | **关系型** → 读取 `skus/relational/` 下的 label_tree.json、glossary.json |

> **关键规则：**
> - `rank` 反映类型优先级（factual → procedural → relational）和 ID 顺序，**不代表与查询的语义相关度**。
> - 先扫描所有条目的 `keywords` 和 `name` 字段，找出语义匹配的条目，只读取匹配的那些。
> - `rank` 仅在多条记录语义相关性相同时作为优先级参考。
> - 多个 chunk 引用时，先合并候选列表再按 `sku_id` 去重后读取。
""",
}

STATS_LABELS = {
    "en": {
        "factual": "Factual SKUs",
        "procedural": "Procedural SKUs",
        "relational": "Relational knowledge",
        "total_files": "Total files copied",
        "chunk_mapping": "Chunk→SKU mapping",
        "chunk_coverage": "Eureka chunk coverage",
        "yes": "Yes",
        "no": "No",
        "ok": "OK",
        "failed": "FAILED",
    },
    "zh": {
        "factual": "事实型SKU",
        "procedural": "程序型SKU",
        "relational": "关系型知识",
        "total_files": "复制文件总数",
        "chunk_mapping": "Chunk→SKU 映射",
        "chunk_coverage": "Eureka chunk 覆盖率",
        "yes": "是",
        "no": "否",
        "ok": "通过",
        "failed": "未通过",
    },
}


class ReadmeGenerator:
    """Generates README.md for the assembled ontology."""

    def __init__(self, ontology_dir: Path):
        self.ontology_dir = Path(ontology_dir).resolve()

    def write(self, manifest: OntologyManifest) -> None:
        """
        Generate and write README.md.

        Args:
            manifest: OntologyManifest with counts and status.
        """
        lang = settings.language
        labels = STATS_LABELS[lang]

        stats_lines = []
        stats_lines.append(f"- **{labels['factual']}**: {manifest.factual_count}")
        stats_lines.append(f"- **{labels['procedural']}**: {manifest.procedural_count}")
        rel_val = labels["yes"] if manifest.has_relational else labels["no"]
        stats_lines.append(f"- **{labels['relational']}**: {rel_val}")
        stats_lines.append(f"- **{labels['total_files']}**: {manifest.total_files_copied}")
        if manifest.has_chunk_mapping:
            chunk_map_val = labels["yes"]
            coverage_val = labels["ok"] if manifest.chunk_coverage_ok else labels["failed"]
            stats_lines.append(f"- **{labels['chunk_mapping']}**: {chunk_map_val}")
            stats_lines.append(f"- **{labels['chunk_coverage']}**: {coverage_val}")

        stats_section = "\n".join(stats_lines)
        content = README_TEMPLATE[lang].format(stats_section=stats_section)

        readme_path = self.ontology_dir / "README.md"
        readme_path.write_text(content, encoding="utf-8")

        manifest.has_readme = True
        logger.info("Generated README.md", path=str(readme_path))
