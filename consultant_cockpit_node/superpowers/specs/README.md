# 顾问现场作战系统 · 文档索引

> **最后更新**: 2026-05-05

本目录包含顾问现场作战系统的完整文档，按类型分类。

---

## 文档结构

```
consultant_cockpit_node/superpowers/specs/
├── README.md                 # 本索引文件
├── design.md                 # 产品设计规范（完整版）
├── api.md                    # API 接口规范（REST + WebSocket + 飞书）
├── data.md                   # 数据规范（类型定义、字段映射、状态流转）
├── architecture.md           # 技术架构（模块职责、依赖关系）
├── operations.md             # 运维文档（部署、配置、排查）
├── changelog.md              # 变更记录
└── 2026-05-02-consultant-field-cockpit-design.md  # 原始设计文档
```

---

## 快速查阅

| 需求 | 文档 |
|------|------|
| 了解产品定位 | [design.md](design.md) 第 1 节 |
| 共识链记录规则 | [design.md](design.md) 第 4 节 |
| 候选生成三约束 | [design.md](design.md) 第 3 节 |
| 知识召回限流 | [design.md](design.md) 第 2 节 |
| 演示模式设计 | [design.md](design.md) 第 5 节 |
| 作战卡双模式 | [design.md](design.md) 第 6 节 |
| 备忘录三层架构 | [design.md](design.md) 第 7 节 |
| REST API 端点 | [api.md](api.md) |
| WebSocket 事件 | [api.md](api.md) |
| 飞书 API 调用 | [api.md](api.md) |
| 数据类型定义 | [data.md](data.md) |
| 字段映射规则 | [data.md](data.md) |
| 状态流转图 | [data.md](data.md) |
| 模块职责划分 | [architecture.md](architecture.md) |
| 部署步骤 | [operations.md](operations.md) |
| 环境变量配置 | [operations.md](operations.md) |
| 问题排查 | [operations.md](operations.md) |
| 变更历史 | [changelog.md](changelog.md) |

---

## 外部引用

以下文档会被代码或配置文件引用：

| 文档 | 被引用位置 |
|------|-----------|
| [data.md](data.md) | `src/config/fields.js` 注释 |
| [api.md](api.md) | `server.js` 注释 |
| [operations.md](operations.md) | `.env.example` 注释 |