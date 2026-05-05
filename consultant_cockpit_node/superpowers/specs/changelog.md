# 变更记录

> **最后更新**: 2026-05-05

---

## 2026-05-05 文档结构重组

### 变更内容

将分散的文档整理为统一的二级结构：

```
docs/superpowers/
├── README.md           # 文档索引
├── design.md           # 产品设计规范（完整版）
├── api.md              # API 接口规范
├── data.md             # 数据规范
├── architecture.md     # 技术架构
├── operations.md       # 运维文档
└── changelog.md        # 变更记录（本文件）
```

### 文档迁移

| 原位置 | 新位置 |
|--------|--------|
| `docs/superpowers/specs/2026-05-02-consultant-field-cockpit-design.md` | `docs/superpowers/design.md` |
| `docs/superpowers/plans/*` | `consultant_cockpit_node/superpowers/plans/` |
| `consultant_cockpit_node/docs/FIELD_MAPPING_*.md` | 内容合并到 `docs/superpowers/data.md` |

### 从代码提取的规则

| 规则 | 原位置 | 新文档 |
|------|--------|--------|
| 字段定义 | `src/config/fields.js` | `data.md` |
| 类型定义 | `src/types.js` | `data.md` |
| API 端点 | `server.js` | `api.md` |
| 模块职责 | 各模块文件 | `architecture.md` |
| 环境变量 | `src/utils/config.js` | `operations.md` |

---

## 2026-05-04 字段映射修复

### 已修复问题

| 问题 | 优先级 | 状态 |
|------|--------|------|
| 类型/状态反向映射缺失 | P0 | ✅ 已修复 |
| getClientProfile filter 匹配逻辑错误 | P0 | ✅ 已修复 |
| 完整度计算不一致（8 vs 9 字段） | P0 | ✅ 已修复 |
| 状态映射多对一不可逆 | P0 | ✅ 已修复 |
| 类型字段多余 case/insight | P1 | ✅ 已修复 |
| recommendation 写入校验缺失 | P1 | ✅ 已修复 |
| 富文本多段拼接 | P2 | ✅ 已修复 |
| 客户档案"完整度"字段冗余 | P0 | ✅ 已修复 |
| 诊断共识表 12 列 vs PRD 3 列 | P0 | ✅ 已修复 |
| 阶段状态前后端不同步 | P0 | ✅ 已修复 |
| 429 限流处理缺失 | P1 | ✅ 已修复 |

### 新增功能

- 创建统一字段配置模块 `src/config/fields.js`
- 新增客户视图转换函数 `toCustomerView()` / `toCustomerViewBatch()`
- 新增 429 限流重试机制 `_withRateLimitRetry()`

---

## 2026-05-03 Node.js 架构迁移

### 变更内容

从 Python + Streamlit 迁移到 Node.js + Fastify：

| 组件 | Python 版本 | Node.js 版本 |
|------|-------------|--------------|
| Web 框架 | Streamlit | Fastify |
| 状态管理 | session_state | EventEmitter + Map |
| API 设计 | Streamlit 组件 | RESTful API + WebSocket |
| 飞书集成 | lark-cli + requests | @larksuiteoapi/node-sdk |
| ID 生成 | 自增 ID | crypto.randomUUID() |

### 测试验收

- 单元测试: 147 个，通过率 99.3%
- Golden 测试: 25 个，通过率 100%
- 验收自动化测试: 34 个，通过率 100%

---

## 2026-05-02 初始设计锁定

- 完成产品设计文档 v1.0
- 确定双层架构设计
- 确定三天 Sprint 实施计划