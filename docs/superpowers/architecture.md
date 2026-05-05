# 技术架构

> **最后更新**: 2026-05-05

---

## 一、技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Node.js | >= 18.0.0 | ES Module + 原生测试框架 |
| Web 框架 | Fastify | 4.x | 高性能 HTTP 服务器 |
| WebSocket | @fastify/websocket | - | 实时通信 |
| LLM | OpenAI SDK | - | + p-limit 并发控制 |
| 飞书 | @larksuiteoapi/node-sdk | - | 官方 Node.js SDK |
| Word 生成 | docx | - | 生成 .docx 文件 |
| 日志 | pino + pino-pretty | - | 高性能日志 |
| 测试 | Node.js 内置测试框架 | - | node --test |

---

## 二、模块职责划分

```
consultant_cockpit_node/
├── server.js                    # Fastify 主入口，API 路由定义
│
├── src/
│   ├── core/                    # 核心业务逻辑
│   │   ├── consensusChain.js    # 共识链管理（EventEmitter）
│   │   ├── candidateGen.js      # 候选生成器（含预计算缓存）
│   │   ├── knowledgeRetriever.js# 知识召回器（含限流）
│   │   ├── memoGenerator.js     # 备忘录生成（三层架构）
│   │   ├── battleCardGen.js     # 作战卡生成（双模式）
│   │   ├── fallbackHandler.js   # 降级处理器
│   │   └── sessionManager.js    # 会话持久化管理
│   │
│   ├── integrations/            # 外部集成
│   │   ├── feishuClient.js      # 飞书客户端（字段映射）
│   │   └── feishuSync.js        # 飞书实时同步（WebSocket/轮询）
│   │
│   ├── config/                  # 配置模块
│   │   └── fields.js            # 统一字段定义
│   │
│   └── utils/                   # 工具模块
│       ├── llmClient.js         # LLM 客户端（含超时控制）
│       ├── config.js            # 配置管理（环境变量）
│       ├── logger.js            # 日志封装
│       └── fieldMapping.js      # 字段映射工具（向后兼容）
│
├── public/                      # 前端静态资源
│   ├── index.html               # 主页面
│   ├── app.js                   # 前端逻辑
│   └── style.css                # 样式
│
├── tests/                       # 测试
│   ├── golden_cases.json        # 金标准测试集
│   └── *.test.js                # 单元测试
│
├── data/                        # 会话持久化存储
└── logs/                        # 运行时日志
```

---

## 三、核心模块说明

### 3.1 ConsensusChain（共识链）

**职责**: 管理共识链记录的增删改查，触发飞书同步

**事件**:
- `change`: 记录变更时触发
- `invalidate-cache`: 缓存需要失效时触发

**关键方法**:
| 方法 | 说明 |
|------|------|
| `addRecord(record, options)` | 添加记录，可选同步飞书 |
| `confirmRecord(id, company)` | 确认记录，同步到客户档案表 |
| `correctRecord(id, content, options)` | 修正记录，原记录标记 superseded |
| `getConfirmedFacts()` | 获取已确认事实 |
| `getConfirmedConsensus()` | 获取已确认共识 |
| `exportRecords()` | 导出记录数组 |
| `importRecords(records)` | 导入记录数组 |

### 3.2 CandidateGenerator（候选生成器）

**职责**: 基于三约束生成候选方案，支持预计算缓存

**三约束**:
1. 共识链 >= 3 条已确认事实
2. 至少 1 个待确认假设
3. 至少 1 个 🟢/🟡 SKU

**缓存过期触发**:
- 共识链变更（防抖 10 秒）
- 手动修正共识链（立即重算）
- 阶段切换（立即重算）
- SKU 变化（防抖 10 秒）

**关键方法**:
| 方法 | 说明 |
|------|------|
| `generateCandidates()` | 生成候选方案 |
| `getCachedCandidates()` | 获取缓存候选 |
| `checkConstraints(skus)` | 检查三约束 |
| `invalidateCache()` | 失效缓存 |
| `startBackgroundPrecompute()` | 启动后台预计算 |

### 3.3 KnowledgeRetriever（知识召回器）

**职责**: 关键词匹配召回 SKU，支持限流

**限流规则**:
- 同一关键词 5 秒内不重复触发
- 备弹区最短刷新间隔 30 秒
- 单次会议召回上限 50 次

**关键方法**:
| 方法 | 说明 |
|------|------|
| `recallByKeywords(keywords, top_k)` | 按关键词召回 |
| `getFreshSkus()` | 获取新鲜 SKU（3 分钟内） |

### 3.4 MemoGenerator（备忘录生成器）

**职责**: 三层架构生成备忘录

**三层架构**:
1. **数据提取层**: 确定性规则，零 AI
2. **结构组装层**: 模板 + 规则，零 AI
3. **语言润色层**: AI，严格约束

**关键方法**:
| 方法 | 说明 |
|------|------|
| `generateStructure()` | 生成结构化内容 |
| `generateWord(outputPath)` | 生成 Word 文档 |

### 3.5 BattleCardGenerator（作战卡生成器）

**职责**: 双模式生成会前作战卡

**双模式**:
- 完整度 >= 60%: 验证假设版
- 完整度 < 60%: 信息建立版

**关键方法**:
| 方法 | 说明 |
|------|------|
| `generate(company, consultant)` | 生成作战卡 |
| `renderToWord(battleCard)` | 渲染为 Word |

### 3.6 FeishuClient（飞书客户端）

**职责**: 飞书多维表格读写，字段映射

**关键方法**:
| 方法 | 说明 |
|------|------|
| `getClientProfile(company)` | 获取客户档案 |
| `updateClientProfile(company, fields)` | 更新客户档案 |
| `createConsensusRecord(record)` | 创建共识记录 |
| `listConsensusRecords()` | 列出共识记录 |
| `listConsensusRecordsForCustomer()` | 客户视图（3 列） |

### 3.7 SessionManager（会话管理器）

**职责**: 会话持久化到文件系统

**关键方法**:
| 方法 | 说明 |
|------|------|
| `saveSession(sessionId, records, metadata)` | 保存会话 |
| `loadSession(sessionId)` | 加载会话 |
| `listSessions()` | 列出所有会话 |

---

## 四、依赖关系图

```
server.js
    ├── ConsensusChain
    │       └── FeishuClient
    ├── CandidateGenerator
    │       ├── ConsensusChain
    │       ├── KnowledgeRetriever
    │       ├── LLMClient
    │       └── FallbackHandler
    ├── KnowledgeRetriever
    ├── MemoGenerator
    │       ├── ConsensusChain
    │       ├── LLMClient
    │       └── FallbackHandler
    ├── BattleCardGenerator
    │       ├── FeishuClient
    │       ├── LLMClient
    │       └── KnowledgeRetriever
    ├── FeishuSync
    │       └── FeishuClient
    └── SessionManager
```

---

## 五、降级处理方案

| 风险 | 降级方案 | 实现位置 |
|------|---------|---------|
| 飞书 API 失败 | 本地缓存，会议后手动同步 | `fallbackHandler.js` |
| LLM 响应超时 | 模板降级，跳过润色 | `fallbackHandler.js` |
| 知识召回不准 | 手动 `/搜` 指令补充 | UI 层 |
| 429 限流 | 读取响应头等待重试 | `feishuClient.js` |

---

## 六、测试覆盖

| 模块 | 测试数 | 状态 |
|------|--------|------|
| ConsensusChain | 34 | ✅ |
| CandidateCache | 3 | ✅ |
| CandidateGenerator | 6 | ✅ |
| KnowledgeRetriever | 8 | ✅ |
| MemoGenerator | 6 | ✅ |
| BattleCardGenerator | 5 | ✅ |
| FallbackHandler | 6 | ✅ |
| SessionManager | 19 | ✅ |
| Server Integration | 15 | ✅ |
| Golden Cases | 25 | ✅ |
| **总计** | **147** | **✅** |