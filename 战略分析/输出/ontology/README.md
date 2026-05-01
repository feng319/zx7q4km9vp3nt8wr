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

- **事实型SKU**: 129
- **程序型SKU**: 46
- **关系型知识**: 是
- **复制文件总数**: 357

## 使用方法

1. 从 `spec.md` 开始，了解应用的功能目标
2. 使用 `mapping.md` 为每个功能找到相关SKU
3. 阅读SKU的 `header.md` 了解摘要，再按需加载完整内容
4. 参考 `eureka.md` 获取连接多个知识领域的创意

## Agent 查询协议

| 需求 | 去哪找 |
|------|--------|
| 理解产品方向和业务逻辑 | `spec.md` |
| 通过 spec 引用跳转到具体 SKU | `spec.md` 中的 `skus/factual/sku_xxx` |
| 查找某个主题下的全量 SKU | `mapping.md` 对应分组 |
| 全库搜索或枚举所有 SKU | `skus/skus_index.json` |

> **注：** `spec.md` 中残留的【锚点：描述】标记表示该知识点暂无精确 SKU 对应，可通过 `mapping.md` 按主题查找相关 SKU。
