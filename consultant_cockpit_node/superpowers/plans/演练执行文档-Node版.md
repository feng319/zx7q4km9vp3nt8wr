# 演练执行文档 - Node.js 版

> 顾问现场作战系统验收检查清单
> 版本: 1.0.0
> 最后更新: 2026-05-03

---

## 一、环境准备检查

### 1.1 系统要求

- [ ] Node.js >= 18.0.0
- [ ] npm >= 9.0.0
- [ ] 磁盘空间 >= 500MB

### 1.2 依赖安装

```bash
cd consultant_cockpit_node
npm install
```

- [ ] 依赖安装无报错
- [ ] node_modules 目录存在

### 1.3 环境变量配置

复制 `.env.example` 为 `.env` 并填写：

```bash
cp .env.example .env
```

- [ ] `OPENAI_API_KEY` 已配置（或使用 Mock）
- [ ] `FEISHU_APP_ID` 已配置（或使用 Mock）
- [ ] `FEISHU_APP_SECRET` 已配置（或使用 Mock）
- [ ] `PORT` 已配置（默认 8501）

---

## 二、启动验证

### 2.1 启动服务

```bash
npm start
# 或
node server.js
```

- [ ] 服务启动成功，无报错
- [ ] 控制台显示 "Server listening on http://localhost:8501"

### 2.2 健康检查

```bash
curl http://localhost:8501/api/health
```

预期响应：
```json
{
  "status": "ok",
  "timestamp": "2026-05-03T...",
  "sessions": 0
}
```

- [ ] 健康检查返回 `status: "ok"`

### 2.3 前端访问

打开浏览器访问 http://localhost:8501

- [ ] 页面正常加载
- [ ] 样式正确显示
- [ ] 无 JavaScript 错误

---

## 三、功能模块验证

### 3.1 共识链模块 (ConsensusChain)

**测试步骤**:

1. 点击 "新建会话" 按钮
2. 输入 `/记 <内容>` 添加事实记录
3. 输入 `/记 <内容>` 添加第二条记录
4. 输入 `/确认` 确认最新一条待确认记录
5. 或点击记录行内"确认"按钮确认指定记录

**状态流转（PRD 4.2）**:

```
/记 创建 → pending_client_confirm（UI 显示"待确认"）
    ↓
/确认 或 点击确认按钮 → confirmed（UI 显示"已确认"，同步飞书）
```

**验收标准**:

- [ ] 会话创建成功，显示会话 ID
- [ ] `/记` 添加记录成功，状态为 `pending_client_confirm`，UI 显示"待确认"
- [ ] 共识链区域出现绿色闪动反馈（0.3 秒）
- [ ] 左栏完整度进度条数字上升
- [ ] 每条"待确认"记录行内右侧显示"确认"按钮（不影响行高）
- [ ] `/确认` 确认最新一条 `pending_client_confirm` 记录
- [ ] 候选选中后 `/确认` 优先确认选中的候选记录
- [ ] 确认后状态变为 `confirmed`，UI 显示"已确认"
- [ ] 仅 `confirmed` 记录同步到飞书"诊断共识"表，`pending_client_confirm` 不同步
- [ ] 点击 "修正" 后可以修改内容

**智能确认逻辑**:

`/确认` 按以下优先级确认记录：
1. 如果有选中的候选记录 → 确认该候选记录
2. 否则 → 确认最新一条 `pending_client_confirm` 状态的记录

**API 测试**:

```bash
# 创建会话
curl -X POST http://localhost:8501/api/sessions

# 添加记录（替换 SESSION_ID）
curl -X POST http://localhost:8501/api/sessions/SESSION_ID/records \
  -H "Content-Type: application/json" \
  -d '{"type":"fact","content":"测试内容","stage":"战略梳理"}'

# 智能确认（无 body → 确认最新 pending 记录）
curl -X POST http://localhost:8501/api/sessions/SESSION_ID/confirm \
  -H "Content-Type: application/json" \
  -d '{}'

# 智能确认（指定 record_id）
curl -X POST http://localhost:8501/api/sessions/SESSION_ID/confirm \
  -H "Content-Type: application/json" \
  -d '{"record_id":"record_xxx"}'

# 确认记录（旧接口，指定 ID）
curl -X POST http://localhost:8501/api/sessions/SESSION_ID/records/RECORD_ID/confirm

# 获取会话状态（含完整度、字段状态、记录列表）
curl http://localhost:8501/api/sessions/SESSION_ID
```

---

### 3.2 候选生成模块 (CandidateGenerator)

**测试步骤**:

1. 添加至少 3 条已确认事实
2. 添加至少 1 条待确认判断
3. 点击 "生成候选方案"

**验收标准**:

- [ ] 三约束检查生效（事实不足时提示）
- [ ] 候选方案生成成功
- [ ] 显示 3 个候选（稳健/平衡/激进）
- [ ] 缓存状态正确显示

**API 测试**:

```bash
# 获取候选方案
curl http://localhost:8501/api/sessions/SESSION_ID/candidates
```

---

### 3.3 知识召回模块 (KnowledgeRetriever)

**测试步骤**:

1. 在 "知识召回" 面板输入关键词
2. 多个关键词用逗号分隔
3. 点击 "召回" 按钮

**验收标准**:

- [ ] 召回成功，显示 SKU 列表
- [ ] SKU 显示置信度（🟢/🟡/🔴）
- [ ] 限流生效（5 秒内重复召回被阻止）

**API 测试**:

```bash
# 召回知识
curl -X POST http://localhost:8501/api/sessions/SESSION_ID/recall \
  -H "Content-Type: application/json" \
  -d '{"keywords":["战略","增长"]}'
```

---

### 3.4 演示模式 (Demo Mode)

**测试步骤**:

1. 按 F11 键切换演示模式
2. 或按 Ctrl+Shift+D 切换
3. 观察右上角状态徽章
4. 按 Alt+1/2/3 快速切换级别

**验收标准**:

- [ ] F11 快捷键生效
- [ ] Ctrl+Shift+D 快捷键生效
- [ ] 右上角显示状态徽章
- [ ] 三级敏感度正确应用
  - [ ] Level 1: 敏感内容隐藏
  - [ ] Level 2: 敏感内容替换
  - [ ] Level 3: 仅隐藏核心敏感信息
- [ ] 添加记录后不退出演示模式
- [ ] 刷新页面后状态保持

**API 测试**:

```bash
# 获取演示模式状态
curl http://localhost:8501/api/demo-mode

# 设置演示模式
curl -X POST http://localhost:8501/api/demo-mode \
  -H "Content-Type: application/json" \
  -d '{"level":2}'
```

---

### 3.5 文档生成模块

**测试步骤**:

1. 确保会话有足够记录
2. 点击 "生成备忘录"
3. 点击 "生成作战卡"
4. 输入客户公司名称

**验收标准**:

- [ ] 备忘录生成成功
- [ ] 作战卡生成成功
- [ ] Word 文档可正常打开
- [ ] 中文显示正常

---

### 3.6 会话导入导出

**测试步骤**:

1. 点击 "导出会话"
2. 保存 JSON 文件
3. 刷新页面
4. 点击 "导入会话"
5. 选择导出的文件

**验收标准**:

- [ ] 导出成功，下载 JSON 文件
- [ ] 导入成功，记录恢复

---

## 四、WebSocket 验证

### 4.1 连接测试

打开浏览器开发者工具，查看 Network > WS 标签：

- [ ] WebSocket 连接成功
- [ ] 收到 `init` 消息

### 4.2 实时更新测试

1. 打开两个浏览器标签页
2. 在第一个标签页添加记录
3. 观察第二个标签页

- [ ] 第二个标签页自动更新记录列表

---

## 五、降级处理验证

### 5.1 飞书降级

**模拟飞书不可用**:

1. 移除 `.env` 中的飞书配置
2. 重启服务
3. 添加记录

- [ ] 使用 Mock 模式运行
- [ ] 记录正常添加

### 5.2 LLM 降级

**模拟 LLM 超时**:

1. 设置 `LLM_TIMEOUT_SECONDS=1`
2. 生成候选方案

- [ ] 超时后降级到模板生成
- [ ] 不影响基本功能

---

## 六、性能基准测试

### 6.1 响应时间

| 操作 | 目标 | 实测 |
|------|------|------|
| 健康检查 | < 50ms | [ ] |
| 添加记录 | < 100ms | [ ] |
| 获取候选（缓存） | < 200ms | [ ] |
| 演示模式切换 | < 100ms | [ ] |

### 6.2 并发测试

```bash
# 使用 ab 或 wrk 进行压力测试
ab -n 100 -c 10 http://localhost:8501/api/health
```

- [ ] 100 请求全部成功
- [ ] 平均响应时间 < 100ms

---

## 七、测试套件验证

### 7.1 单元测试

```bash
npm test
```

- [ ] 所有测试通过
- [ ] 测试数量: 147+

### 7.2 金标准测试

```bash
node tests/golden_test_runner.js
```

- [ ] 所有金标准测试通过
- [ ] 测试数量: 25

---

## 八、部署验证

### 8.1 PM2 部署

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs consultant-cockpit
```

- [ ] PM2 启动成功
- [ ] 进程状态为 "online"
- [ ] 日志正常输出

### 8.2 优雅关闭

```bash
pm2 stop consultant-cockpit
```

- [ ] 会话自动保存
- [ ] 无报错信息

---

## 九、验收签字

| 检查项 | 状态 | 检查人 | 日期 |
|--------|------|--------|------|
| 环境准备 | [ ] | | |
| 启动验证 | [ ] | | |
| 共识链模块 | [ ] | | |
| 候选生成模块 | [ ] | | |
| 知识召回模块 | [ ] | | |
| 演示模式 | [ ] | | |
| 文档生成 | [ ] | | |
| WebSocket | [ ] | | |
| 降级处理 | [ ] | | |
| 性能基准 | [ ] | | |
| 测试套件 | [ ] | | |
| 部署验证 | [ ] | | |

**总体验收结果**: [ ] 通过 / [ ] 不通过

**签字**: _________________ **日期**: _________________

---

## 附录：常见问题排查

### A. 端口被占用

```bash
# Windows
netstat -ano | findstr :8501
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :8501
kill -9 <PID>
```

### B. 依赖安装失败

```bash
# 清除缓存重试
npm cache clean --force
rm -rf node_modules
npm install
```

### C. 飞书连接失败

1. 检查网络连接
2. 验证 App ID 和 Secret
3. 检查权限配置
4. 使用 Mock 模式继续开发
