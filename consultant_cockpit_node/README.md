# 顾问现场作战系统 · Node.js 版

> 会前 15 分钟快速准备，会中实时共识记录，会后自动生成备忘录

## 功能特性

- **共识链管理**: 实时记录事实与判断，支持修正追溯
- **候选方案生成**: 基于三约束检查，自动生成稳健/平衡/激进三种方案
- **知识召回**: 关键词匹配召回 SKU 弹药，支持限流去重
- **备忘录生成**: 三层架构（提取→组装→润色），自动生成 Word 文档
- **作战卡生成**: 双模式自动切换（验证假设版/信息建立版）
- **飞书集成**: 多维表格读写，实时同步
- **降级处理**: 飞书 API 失败本地缓存，LLM 超时模板降级

## 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

## 安装

```bash
cd consultant_cockpit_node
npm install
```

## 配置

复制 `.env.example` 为 `.env`，填写真实值：

```bash
cp .env.example .env
```

### 环境变量说明

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `OPENAI_API_KEY` | OpenAI API Key | 是 |
| `LLM_BASE_URL` | LLM API 地址 | 否（默认 OpenAI） |
| `LLM_MODEL` | 模型名称 | 否（默认 gpt-4） |
| `FEISHU_APP_ID` | 飞书应用 ID | 是 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 是 |
| `FEISHU_BITABLE_APP_TOKEN` | 多维表格 App Token | 是 |
| `FEISHU_BITABLE_TABLE_ID` | 客户档案表 ID | 是 |
| `FEISHU_BITABLE_CONSENSUS_TABLE_ID` | 诊断共识表 ID | 否 |
| `PORT` | 服务端口 | 否（默认 8501） |
| `LOG_LEVEL` | 日志级别 | 否（默认 info） |

## 启动

```bash
npm start
# 或
./start.bat  # Windows
./start.sh   # Linux/Mac
```

访问 http://localhost:8501

## API 接口

### 健康检查

```
GET /api/health
```

### 会话管理

```
POST /api/sessions              # 创建会话
GET  /api/sessions              # 列出所有会话（按修改时间排序）
GET  /api/sessions/:sessionId   # 获取会话状态
GET  /api/sessions/:sessionId/export   # 导出会话
POST /api/sessions/:sessionId/import   # 导入会话
```

### 会话持久化

- 会话自动保存到 `data/sessions/` 目录
- 共识链变更时自动触发保存
- 页面刷新后自动恢复最近的会话
- 支持从下拉框选择历史会话切换
- 服务重启后会话数据不丢失

### 记录操作

```
POST /api/sessions/:sessionId/records                    # 添加记录
POST /api/sessions/:sessionId/records/:recordId/confirm  # 确认记录
POST /api/sessions/:sessionId/records/:recordId/correct  # 修正记录
GET  /api/sessions/:sessionId/facts                      # 获取已确认事实
```

### 候选方案

```
GET /api/sessions/:sessionId/candidates  # 获取候选方案
```

### 知识召回

```
POST /api/sessions/:sessionId/recall  # 手动召回
```

### 文档生成

```
POST /api/sessions/:sessionId/memo         # 生成备忘录
POST /api/sessions/:sessionId/battle-card  # 生成作战卡
```

## 项目结构

```
consultant_cockpit_node/
├── server.js                    # Fastify 主入口
├── package.json                 # 依赖声明
├── .env.example                 # 环境变量模板
│
├── src/
│   ├── core/                    # 核心业务逻辑
│   │   ├── consensusChain.js    # 共识链管理
│   │   ├── candidateGen.js      # 候选生成器
│   │   ├── knowledgeRetriever.js# 知识召回器
│   │   ├── memoGenerator.js     # 备忘录生成
│   │   ├── battleCardGen.js     # 作战卡生成
│   │   ├── fallbackHandler.js   # 降级处理器
│   │   └── sessionManager.js    # 会话管理
│   │
│   ├── integrations/            # 外部集成
│   │   ├── feishuClient.js      # 飞书客户端
│   │   └── feishuSync.js        # 飞书同步
│   │
│   └── utils/                   # 工具模块
│       ├── llmClient.js         # LLM 客户端
│       ├── config.js            # 配置管理
│       └── logger.js            # 日志封装
│
├── public/                      # 前端静态资源
│   └── index.html               # 主页面
│
├── tests/                       # 测试
│   ├── golden_cases.json        # 金标准测试集
│   └── golden_test_runner.js    # 测试执行器
│
├── data/                        # 会话持久化
└── logs/                        # 运行时日志
```

## 测试

```bash
# 运行所有测试
npm test

# 运行金标准测试
node --test tests/golden_test_runner.js

# 运行单元测试
node --test tests/consensusChain.test.js
node --test tests/candidateGen.test.js
# ... 其他测试文件
```

### 测试覆盖

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

## 常见问题

### 1. 飞书连接失败

检查 `.env` 中的飞书配置是否正确：
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BITABLE_APP_TOKEN`

确保飞书应用已开通 `bitable:app` 权限。

### 2. LLM 调用超时

检查网络连接，或调整 `LLM_TIMEOUT_SECONDS` 环境变量（默认 10 秒）。

### 3. Word 中文乱码

确认系统安装了微软雅黑字体。生成的 Word 文档使用 `docx` npm 包，字体设置为微软雅黑。

### 4. 会话丢失

会话自动保存在 `data/sessions/` 目录。页面刷新后会自动恢复最近的会话（包括共识链记录和备弹 SKU）。服务重启后数据不丢失。

### 5. 切换历史会话

页面顶部提供会话选择下拉框，可切换到任意历史会话。下拉框显示格式：`会话ID前8位 (记录数) 更新时间`。

## 技术栈

- **运行时**: Node.js 18+
- **Web 框架**: Fastify 4.x
- **WebSocket**: @fastify/websocket
- **LLM**: OpenAI SDK + p-limit 并发控制
- **飞书**: @larksuiteoapi/node-sdk
- **Word 生成**: docx
- **日志**: pino
- **测试**: Node.js 内置测试框架

## 从 Python 版本迁移

本项目是从 Python + Streamlit 版本迁移到 Node.js + Fastify。主要变更：

1. **ID 生成**: 使用 `crypto.randomUUID()` 替代自增 ID
2. **状态管理**: 使用 EventEmitter 模式替代 Streamlit session_state
3. **API 设计**: RESTful API + WebSocket 替代 Streamlit 组件
4. **飞书集成**: 使用官方 Node.js SDK

---

## 文档目录

### 设计规范（superpowers/specs/）

| 文档 | 说明 |
|------|------|
| [README.md](superpowers/specs/README.md) | 文档索引 |
| [design.md](superpowers/specs/design.md) | 产品设计规范（完整版） |
| [api.md](superpowers/specs/api.md) | API 接口规范 |
| [data.md](superpowers/specs/data.md) | 数据规范（类型、字段、状态） |
| [architecture.md](superpowers/specs/architecture.md) | 技术架构 |
| [operations.md](superpowers/specs/operations.md) | 运维文档 |
| [changelog.md](superpowers/specs/changelog.md) | 变更记录 |
| [2026-05-02-consultant-field-cockpit-design.md](superpowers/specs/2026-05-02-consultant-field-cockpit-design.md) | 完整设计文档 v1.4（原始版） |

### 实施计划（superpowers/plans/）

| 文档 | 说明 |
|------|------|
| [2026-05-03-consultant-field-cockpit-implementation.md](superpowers/plans/2026-05-03-consultant-field-cockpit-implementation.md) | Node.js 开发执行手册 |
| [演练执行文档-Node版.md](superpowers/plans/演练执行文档-Node版.md) | 演练执行文档 |
| [设计冲突修复记录.md](superpowers/plans/设计冲突修复记录.md) | PRD 与实现对齐修复 |
| [验收测试报告_2026-05-03.md](superpowers/plans/验收测试报告_2026-05-03.md) | 验收测试报告 |

---

## 许可证

MIT
