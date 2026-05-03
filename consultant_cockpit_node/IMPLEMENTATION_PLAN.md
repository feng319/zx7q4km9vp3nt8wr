# 顾问现场作战系统 · Node.js 改造实施计划

> **文档版本**：v1.0
> **创建日期**：2026-05-03
> **基于**：项目计划 v1.3
> **预计工期**：7 天（多人并行）或 10 天（单人开发）

---

## 一、项目结构

```
consultant_cockpit_node/
├── server.js                    # Fastify 主入口
├── package.json
├── .env.example
├── .env                         # 真实配置（不入 git）
├── start.bat                    # Windows 一键启动
│
├── src/
│   ├── core/                    # 核心业务逻辑
│   │   ├── consensusChain.js    # 共识链管理
│   │   ├── candidateGen.js      # 候选生成器
│   │   ├── knowledgeRetriever.js # 知识召回
│   │   ├── memoGenerator.js     # 备忘录生成
│   │   ├── battleCardGen.js     # 作战卡生成
│   │   ├── fallbackHandler.js   # 降级处理器
│   │   └── sessionPersistence.js # 会话持久化
│   │
│   ├── integrations/            # 外部集成
│   │   ├── feishuClient.js      # 飞书 SDK 封装
│   │   ├── feishuSync.js        # WebSocket 同步
│   │   └── llmClient.js         # LLM 客户端
│   │
│   └── utils/                   # 工具函数
│       ├── config.js            # 配置常量
│       └── logger.js            # 日志封装
│
├── public/                      # 前端静态资源
│   ├── index.html
│   ├── css/
│   │   ├── main.css             # 主样式
│   │   └── demo-mode.css        # 演示模式样式
│   └── js/
│       ├── app.js               # 主应用
│       ├── websocket.js         # WebSocket 客户端
│       ├── consensus-chain.js   # 共识链组件
│       ├── candidate-card.js    # 候选卡组件
│       └── demo-mode.js         # 演示模式切换
│
├── tests/                       # 测试文件
│   ├── golden_cases.json        # 金标准测试集
│   ├── golden_test_runner.js    # 测试运行器
│   └── *.test.js                # 单元测试
│
├── logs/                        # 运行时日志
│   └── app.jsonl
│
└── data/                        # 会话持久化
    └── session_YYYY-MM-DD.json
```

---

## 二、Day 0 前置任务清单

### 2.1 飞书后台配置（阻塞性前置）

**责任人**：开发者
**完成时间**：改造启动前 3 天提交审批

- [ ] 登录飞书开发者后台
- [ ] 创建企业自建应用（或使用现有应用）
- [ ] 开启事件订阅
- [ ] 添加事件：
  - `drive.file.bitable_record_changed_v1`
  - `drive.file.edit_v1`
- [ ] 申请权限：
  - `bitable:app` 或 `drive:drive`
- [ ] 获取凭证：
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
- [ ] 配置 IP 白名单（如需要）

### 2.2 Python 版本 record_id Bug 修复

**责任人**：开发者
**完成时间**：Day 0 当天

**Bug 位置**：`consultant_cockpit/src/integrations/feishu_client.py:78-87`

**修复步骤**：
1. 运行 `lark-cli base +record-list` 确认返回格式
2. 检查 `record_id` 字段位置
3. 修改 `get_client_profile()` 方法
4. 编写单元测试验证修复
5. 提交 commit 并打 tag `python-v1.0-final`

### 2.3 金标准测试集设计

**责任人**：开发者设计，产品方审核
**完成时间**：Day 0 完成 20 个场景，Day 1 上午 12:00 前审核签字

**场景覆盖**：
- 共识链状态机分支（5 个）
- 候选生成三约束触发（4 个）
- 完整度计算边界值（3 个）
- 飞书读写场景（3 个）
- Word 生成场景（3 个）
- 降级处理场景（2 个）

### 2.4 Word 中文字体验证

**责任人**：开发者
**完成时间**：Day 0 当天

**验证脚本**：`tests/test_chinese_font.js`

**验证要点**：
- 中文字体名称映射
- Word 打开后字体显示
- PDF 导出后字体正常

---

## 三、Day 1 业务逻辑迁移

### 3.1 后端轨道

**目标**：完成 4 个核心模块

#### 3.1.1 consensusChain.js

**源文件**：`consultant_cockpit/src/core/consensus_chain.py`

**关键数据结构**：
```javascript
// @ts-check
/**
 * @typedef {Object} ConsensusRecord
 * @property {string} id
 * @property {string} timestamp
 * @property {'fact'|'consensus'} type
 * @property {'战略梳理'|'商业模式'|'行业演示'} stage
 * @property {string} content
 * @property {'manual'|'candidate_selected'|'ai_suggested'|'manual_correction'} source
 * @property {string[]} evidence_sku
 * @property {'recorded'|'pending_client_confirm'|'confirmed'|'superseded'} status
 * @property {'high'|'medium'|'low'} [confidence]
 * @property {string} [replaces]
 * @property {string} [superseded_by]
 * @property {string} [feishu_record_id]
 * @property {string} [recommendation]
 */
```

**关键方法**：
- `addRecord(record)` - 添加记录
- `confirmRecord(id)` - 确认记录
- `correctRecord(id, newContent)` - 修正记录（superseded 逻辑）
- `getConfirmedFacts()` - 获取已确认事实
- `getConfirmedConsensus()` - 获取已确认判断
- `getPendingConsensus()` - 获取待确认判断

**验收标准**：
- [ ] 单元测试通过
- [ ] 金标准测试集前 3 个场景通过

#### 3.1.2 candidateGen.js

**源文件**：`consultant_cockpit/src/core/candidate_generator.py`

**关键类**：
- `Candidate` - 候选方案数据结构
- `CandidateCache` - 线程安全缓存（Node.js 用 Map + 过期时间）
- `CandidateGenerator` - 候选生成器

**关键逻辑**：
- 三约束检查（≥3 条事实、≥1 个 pending、≥1 个 🟢/🟡 SKU）
- 差异度自检（风险等级各不相同）
- 预计算缓存（30 秒有效期）
- 手动修正时缓存作废

**验收标准**：
- [ ] 缓存命中响应 < 0.2 秒
- [ ] 金标准测试集场景 4-7 通过

#### 3.1.3 knowledgeRetriever.js

**源文件**：`consultant_cockpit/src/core/knowledge_retriever.py`

**关键逻辑**：
- 关键词匹配
- 限流去重（同一关键词 5 秒内不重复触发）
- 备弹区刷新间隔 30 秒
- 单次会议召回上限 50 次

**验收标准**：
- [ ] 限流逻辑正确
- [ ] 金标准测试集场景 8-10 通过

#### 3.1.4 llmClient.js

**源文件**：`consultant_cockpit/src/utils/llm_client.py`

**关键逻辑**：
- OpenAI SDK 封装
- `p-limit(3)` 全局并发限制
- 10 秒超时保护
- 退避重试

**验收标准**：
- [ ] 并发限制生效
- [ ] 超时触发降级

### 3.2 前端并行轨道（Day 1 下午启动）

**目标**：搭建前端骨架

#### 3.2.1 HTML 结构

```html
<!-- public/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>顾问作战系统</title>
    <link rel="stylesheet" href="css/main.css">
    <link rel="stylesheet" href="css/demo-mode.css">
</head>
<body>
    <div class="container">
        <aside class="left-panel">客户档案 + 阶段切换</aside>
        <main class="center-panel">共识链实时滚动</main>
        <aside class="right-panel">候选卡覆盖式弹出</aside>
    </div>
    <script src="js/websocket.js"></script>
    <script src="js/consensus-chain.js"></script>
    <script src="js/candidate-card.js"></script>
    <script src="js/demo-mode.js"></script>
    <script src="js/app.js"></script>
</body>
</html>
```

#### 3.2.2 CSS 三栏布局

```css
/* public/css/main.css */
.container {
    display: grid;
    grid-template-columns: 250px 1fr 300px;
    height: 100vh;
    gap: 1px;
    background: #e0e0e0;
}

.left-panel, .center-panel, .right-panel {
    background: #fff;
    overflow-y: auto;
}
```

#### 3.2.3 演示模式 CSS 切换

```css
/* public/css/demo-mode.css */
body.demo-mode .debug-info { display: none; }
body.demo-mode .token-count { display: none; }
body.demo-mode .sku-id { display: none; }

body.demo-mode .stage-name::before {
    content: attr(data-demo-text);
}
```

#### 3.2.4 WebSocket 客户端

```javascript
// public/js/websocket.js
class WSClient {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.handlers = new Map();
    }

    on(event, handler) {
        this.handlers.set(event, handler);
    }

    send(type, data) {
        this.ws.send(JSON.stringify({ type, data }));
    }
}
```

**验收标准**：
- [ ] 浏览器打开显示三栏布局
- [ ] 演示模式切换响应 < 0.1 秒
- [ ] WebSocket 连接成功

---

## 四、Day 2 飞书集成 + Word 生成

### 4.1 后端轨道

#### 4.1.1 feishuClient.js

**源文件**：`consultant_cockpit/src/integrations/feishu_client.py`

**关键变更**：从 `lark-cli` 子进程改为 `@larksuiteoapi/node-sdk`

```javascript
// @ts-check
const lark = require('@larksuiteoapi/node-sdk');

const client = new lark.Client({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    appType: lark.AppType.SelfBuild,
});
```

**关键方法**：
- `getClientProfile(company)` - 获取客户档案
- `upsertRecord(company, fields)` - 新增/更新记录
- `syncConsensusRecord(record)` - 同步共识记录
- `calcCompleteness(record)` - 计算完整度

**429 处理逻辑**：
```javascript
async function withRetry(fn, maxRetries = 3) {
    try {
        return await fn();
    } catch (error) {
        if (error.code === 429) {
            const reset = error.headers?.['x-ogw-ratelimit-reset'];
            if (reset) {
                await sleep(parseInt(reset) * 1000);
                return withRetry(fn, maxRetries - 1);
            }
        }
        throw error;
    }
}
```

**验收标准**：
- [ ] 读写飞书多维表格成功
- [ ] 429 错误正确处理
- [ ] `record_id` 正确提取（不复现 Python Bug）

#### 4.1.2 feishuSync.js

**源文件**：`consultant_cockpit/src/integrations/feishu_sync.py`

**关键逻辑**：
- WebSocket 长连接订阅 `drive.file.bitable_record_changed_v1`
- 30 秒轮询降级
- 写入指纹集合防止"自写自感知"

```javascript
// WebSocket 订阅
client.bitable.recordChanged.subscribe({
    path: { app_token: appToken, table_id: tableId },
    handler: (event) => {
        if (!this.writeFingerprints.has(event.record_id)) {
            this.onRecordChange(event);
        }
    }
});
```

**验收标准**：
- [ ] WebSocket 连接成功
- [ ] 字段变更 1 秒内推送前端
- [ ] 断开后自动降级轮询

#### 4.1.3 memoGenerator.js

**源文件**：`consultant_cockpit/src/core/memo_generator.py`

**三层架构**：
1. 数据提取（确定性规则）
2. 结构组装（模板 + 规则）
3. AI 润色（LLM，带超时保护）

**Word 生成**：
```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

const doc = new Document({
    styles: {
        default: { document: { run: { font: '微软雅黑', size: 20 } } }
    },
    sections: [{
        children: [
            new Paragraph({ text: '客户初步诊断备忘录', heading: HeadingLevel.TITLE }),
            // ...
        ]
    }]
});
```

**验收标准**：
- [ ] 生成 Word 文件中文字体正常
- [ ] 生成总时间 < 30 秒
- [ ] 润色失败时降级为要点列表

#### 4.1.4 battleCardGen.js

**源文件**：`consultant_cockpit/src/core/battle_card_generator.py`

**双模式**：
- 完整度 ≥ 60%：验证假设版
- 完整度 < 60%：信息建立版

**验收标准**：
- [ ] 模式自动切换正确
- [ ] SKU < 6 条时抛出 `InsufficientSkuError`
- [ ] Word 生成所有区块有内容

### 4.2 前端并行轨道

**目标**：前端与后端联调

- [ ] 候选生成 API 联调
- [ ] 共识链 WebSocket 推送联调
- [ ] 演示模式切换联调

---

## 五、Day 3 HTTP 服务 + WebSocket + 持久化

### 5.1 server.js 主入口

```javascript
// @ts-check
const fastify = require('fastify')({
    logger: {
        level: process.env.LOG_LEVEL || 'info',
        file: 'logs/app.jsonl'
    }
});

// 注册插件
await fastify.register(require('@fastify/websocket'));
await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public')
});

// 路由
fastify.post('/api/consensus/add', {
    schema: {
        body: {
            type: 'object',
            required: ['content', 'type', 'stage'],
            properties: {
                content: { type: 'string' },
                type: { enum: ['fact', 'consensus'] },
                stage: { enum: ['战略梳理', '商业模式', '行业演示'] }
            }
        }
    }
}, async (request, reply) => {
    // ...
});

// 全局错误处理
fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    const fallback = fallbackHandler.handle(error);
    reply.code(500).send(fallback);
});
```

### 5.2 sessionPersistence.js

**关键逻辑**：
- 共识链变更时写入 `data/session_<日期>.json`
- 启动时自动恢复最近一次会话

```javascript
// @ts-check
const fs = require('fs');
const path = require('path');

class SessionPersistence {
    constructor() {
        this.sessionDir = 'data';
    }

    save(records) {
        const filename = `session_${new Date().toISOString().split('T')[0]}.json`;
        fs.writeFileSync(
            path.join(this.sessionDir, filename),
            JSON.stringify(records, null, 2)
        );
    }

    loadLatest() {
        const files = fs.readdirSync(this.sessionDir)
            .filter(f => f.startsWith('session_'))
            .sort()
            .reverse();
        if (files.length === 0) return null;
        return JSON.parse(fs.readFileSync(path.join(this.sessionDir, files[0])));
    }
}
```

### 5.3 fallbackHandler.js

**源文件**：`consultant_cockpit/src/core/fallback_handler.py`

**降级场景**：
- 飞书 API 失败 → 本地缓存
- LLM 超时 → 模板内容
- 知识库召回失败 → 手动搜索提示

**验收标准**：
- [ ] 飞书失败时写入本地缓存
- [ ] LLM 超时返回降级模板
- [ ] 服务崩溃后能恢复会话

---

## 六、Day 4 演练验证

### 6.1 验收检查清单

按文档第十八节 12 个模块逐项验证：

- [ ] 18.1 共识链模块（7 项）
- [ ] 18.2 候选生成模块（9 项）
- [ ] 18.3 知识召回模块（5 项）
- [ ] 18.4 飞书集成模块（11 项）
- [ ] 18.5 备忘录生成模块（11 项）
- [ ] 18.6 作战卡模块（9 项）
- [ ] 18.7 演示模式（7 项）
- [ ] 18.8 降级处理（5 项）
- [ ] 18.9 持久化（4 项）
- [ ] 18.10 性能基准（5 项）
- [ ] 18.11 与 Python 版本一致性（3 项）
- [ ] 18.12 环境与部署（5 项）

### 6.2 金标准测试集运行

```bash
npm run test:golden
```

**验收标准**：
- [ ] 20 个场景全部通过
- [ ] 确定性逻辑 byte-level 一致
- [ ] LLM 涉及逻辑使用 mock 输出一致

---

## 七、Day 5-6 Buffer 与交付

### 7.1 遗留问题处理

- [ ] 修复 Day 1-4 发现的 bug
- [ ] 回归测试
- [ ] 文档完善

### 7.2 交付物清单

```
代码部分：
□ server.js
□ src/（10 个文件）
□ public/（前端骨架）
□ tests/
□ package.json

配置部分：
□ .env.example
□ start.bat

文档部分：
□ README.md
□ DEPLOYMENT.md
□ CHANGELOG.md
□ KNOWN_ISSUES.md
```

---

## 八、风险缓解措施

| 风险 | 触发条件 | 缓解措施 |
|-----|---------|---------|
| 飞书后台审批延迟 | Day 0 未通过 | 推迟改造启动，优先使用 mock 数据开发 |
| Word 中文字体异常 | Day 1 下午验证失败 | 回退到 Python 子进程混合方案 |
| WebSocket 不稳定 | 频繁断开 | 30 秒轮询降级 |
| 金标准测试集质量差 | Day 1 审核不通过 | 开发者重新设计，延长 Day 1 工期 |
| 前端工作量超预期 | Day 2 未完成 | 延长至 Day 3，压缩 buffer |

---

## 九、决策记录

| 决策点 | 决策结果 | 决策时间 |
|-------|---------|---------|
| Web 框架 | Fastify | v1.3 |
| 实施语言 | JavaScript + JSDoc | v1.3 |
| TypeScript 迁移 | Node.js 稳定后独立任务 | v1.3 |
| 前端工作量 | 2 天 | 本次评估 |
| 单人开发工期 | 10 天 | 本次评估 |

---

## 十、附录：文件迁移对照表

| Python 文件 | Node.js 文件 | 迁移复杂度 | 优先级 |
|------------|-------------|-----------|-------|
| `consensus_chain.py` | `consensusChain.js` | 简单 | P0 |
| `candidate_generator.py` | `candidateGen.js` | 中等 | P0 |
| `knowledge_retriever.py` | `knowledgeRetriever.js` | 简单 | P0 |
| `llm_client.py` | `llmClient.js` | 简单 | P0 |
| `fallback_handler.py` | `fallbackHandler.js` | 简单 | P1 |
| `feishu_client.py` | `feishuClient.js` | 中等 | P1 |
| `feishu_sync.py` | `feishuSync.js` | 中等 | P1 |
| `memo_generator.py` | `memoGenerator.js` | 中等 | P1 |
| `battle_card_generator.py` | `battleCardGen.js` | 中等 | P1 |
| - | `sessionPersistence.js` | 简单 | P1 |
| - | `server.js` | 中等 | P1 |
| - | `public/*` | 中等 | P1 |

---

**文档结束**

下一步行动：
1. 确认飞书后台配置责任人
2. 启动 Day 0 前置任务
3. 修复 Python 版本 record_id Bug
4. 设计金标准测试集
