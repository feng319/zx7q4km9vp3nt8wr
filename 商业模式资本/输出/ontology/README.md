# 本体

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

- **事实型SKU**: 616
- **程序型SKU**: 344
- **关系型知识**: 否
- **SKU 总数**: 960

## 使用方法

1. 从 `spec.md` 开始，了解应用的功能目标
2. 使用 `mapping.md` 为每个功能找到相关SKU
3. 阅读SKU的 `header.md` 了解摘要，再按需加载完整内容
4. 参考 `eureka.md` 获取连接多个知识领域的创意

## spec.md 引用格式

`spec.md` 中可能出现两类引用：

1. **直接 SKU 引用**：`skus/factual/sku_001`、`skus/procedural/skill_001` — 直接读取对应路径
2. **chunk 引用**：`[chunk: 商业模式与资本运营_chunk_001]` — 先查 `chunk_to_sku.json` 中对应 chunk 的候选 SKU，再读取候选项的 `path`

## Agent 查询协议

阅读 `spec.md` 时，遇到不同引用类型按以下规则处理：

| 引用类型 | 操作步骤 |
|----------|----------|
| `skus/factual/sku_xxx` 或 `skus/procedural/skill_xxx` | **直接读取** → `read_file` 对应的 `header.md` + content |
| `[chunk: xxx_chunk_xxx]` | **Chunk 查询** → 步骤1：打开 `chunk_to_sku.json`，找到 chunk 键 → 步骤2：扫描所有条目的 `keywords` 和 `name`，找出语义匹配的条目 → 步骤3：读取匹配的条目（`rank` 仅作同等相关时的参考，不代表语义相关度）→ 步骤4：如无 keywords 匹配，退回读取 rank 1-3 兜底 |
| 主题级查询（无具体引用） | **Mapping** → 在 `mapping.md` 中找到相关分组，读取列出的 SKU 文件 |
| 查看标签树、术语表和关系型知识 | **关系型** → 读取 `skus/relational/` 下的 label_tree.json、glossary.json |

> **关键规则：**
> - `rank` 反映类型优先级（factual → procedural → relational）和 ID 顺序，**不代表与查询的语义相关度**。
> - 先扫描所有条目的 `keywords` 和 `name` 字段，找出语义匹配的条目，只读取匹配的那些。
> - `rank` 仅在多条记录语义相关性相同时作为优先级参考。
> - 多个 chunk 引用时，先合并候选列表再按 `sku_id` 去重后读取。
