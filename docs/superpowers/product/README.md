# 产品设计规范

> **最后更新**: 2026-05-05

本文档目录包含顾问现场作战系统的产品设计规范，按功能模块拆分便于查阅。

---

## 文档索引

### 核心设计

| 文档 | 说明 | 适用场景 |
|------|------|----------|
| [overview.md](overview.md) | 产品定位、核心场景、双层架构 | 了解系统整体设计 |
| [consensus-chain.md](consensus-chain.md) | 共识链记录设计 | 理解记录结构、状态流转 |
| [candidate-generator.md](candidate-generator.md) | 候选生成器设计 | 理解三约束、预计算机制 |
| [knowledge-retriever.md](knowledge-retriever.md) | 知识召回设计 | 理解召回策略、限流规则 |
| [demo-mode.md](demo-mode.md) | 演示模式设计 | 理解三级敏感度分区 |
| [battle-card.md](battle-card.md) | 作战卡设计 | 理解双模式、追问树 |
| [memo-generator.md](memo-generator.md) | 备忘录设计 | 理解三层架构、章节映射 |

### 操作规范

| 文档 | 说明 |
|------|------|
| [session-sop.md](session-sop.md) | 会议操作规范 |

---

## 快速导航

### 按角色查阅

**产品经理**：从 [overview.md](overview.md) 开始，了解产品定位和核心场景

**开发工程师**：
- 接口开发 → `docs/api/`
- 数据结构 → `docs/data/`
- 架构设计 → `docs/architecture/`

**测试工程师**：`docs/operations/` 运维文档中的测试验收标准

### 按任务查阅

| 任务 | 推荐文档 |
|------|---------|
| 新增共识链字段 | [consensus-chain.md](consensus-chain.md) + `docs/data/fields.md` |
| 修改候选生成逻辑 | [candidate-generator.md](candidate-generator.md) |
| 调整飞书同步 | `docs/api/feishu-api.md` |
| 排查线上问题 | `docs/operations/troubleshooting.md` |
