# 已知问题清单 (KNOWN_ISSUES)

> 顾问现场作战系统 Node.js 版本
> 最后更新: 2026-05-04

## 🔴 高优先级

### 1. 飞书 API 限流处理

**问题描述**: 飞书 API 存在 429 限流，高频操作可能触发限制。

**影响范围**: `feishuClient.js` 所有 API 调用

**临时解决方案**:
- 已实现 `_withRetry()` 方法处理 429 响应
- 失败时自动降级到本地缓存

**计划修复**: 增加请求队列和智能限流控制

---

### 2. LLM 超时处理

**问题描述**: LLM 调用可能因网络问题超时。

**影响范围**: `llmClient.js`, `memoGenerator.js`, `candidateGen.js`

**临时解决方案**:
- 已实现 10 秒默认超时
- 超时后降级到模板生成

**计划修复**: 增加重试机制和超时配置项

---

## 🟡 中优先级

### 3. WebSocket 重连机制

**问题描述**: WebSocket 断开后自动重连，但可能丢失中间消息。

**影响范围**: `public/js/app.js`

**临时解决方案**:
- 重连后自动刷新会话状态
- 3 秒重连间隔

**计划修复**: 实现消息队列和断点续传

---

### 4. 会话持久化性能

**问题描述**: 大量记录时保存可能阻塞主线程。

**影响范围**: `sessionManager.js`

**解决方案**:
- 使用异步写入
- 共识链变更时自动触发保存
- 页面刷新后自动恢复最近会话（包括 SKU 备弹）
- 优雅关闭时保存所有会话

**状态**: ✅ 已修复

---

### 5. 候选生成缓存一致性

**问题描述**: 共识链变更后缓存失效，但预计算可能未完成。

**影响范围**: `candidateGen.js`

**临时解决方案**:
- 缓存失效后立即触发预计算
- 提供手动刷新按钮

**计划修复**: 实现更智能的缓存预热策略

---

## 🟢 低优先级

### 6. 前端状态管理

**问题描述**: 前端使用简单对象管理状态，复杂场景可能难以维护。

**影响范围**: `public/js/app.js`

**临时解决方案**: 无

**计划修复**: 考虑引入轻量级状态管理库

---

### 7. 移动端适配

**问题描述**: 部分界面在移动端显示不佳。

**影响范围**: `public/css/style.css`

**临时解决方案**:
- 已实现基础响应式布局
- 768px 断点

**计划修复**: 完善移动端交互体验

---

### 8. Word 文档中文字体

**问题描述**: 部分系统可能缺少微软雅黑字体。

**影响范围**: `memoGenerator.js`, `battleCardGen.js`

**临时解决方案**:
- 使用系统默认字体作为后备
- 已测试 Windows/macOS

**计划修复**: 增加字体配置选项

---

## 📋 已修复问题

### ✅ 4 批次重构：状态流转与前端交互 (2026-05-05)

**重构背景**: 解决设计文档与代码实现的 9 个冲突点

**Batch 1: 后端数据结构**
- `consensusChain.js`: 新记录默认状态改为 `recorded`（原为 `pending_client_confirm`）
- `consensusChain.js`: 新增 `setCandidateRecordPending()` 方法，候选选中时调用
- `consensusChain.js`: `confirmRecord()` 支持两种状态来源（`recorded` 和 `pending_client_confirm`）
- `consensusChain.js`: `_syncToFeishu()` 使用 `enqueue` 重试队列，失败不阻塞
- `fallbackHandler.js`: 新增 `enqueue()` 方法和 `_retryQueue` 重试队列
- `types.js`: 新增 `target_field` 和 `DiagnosisHypothesis` 类型定义

**Batch 2: 前端交互**
- `app.js`: 新增 `renderSwitchButton()` 函数，最后阶段隐藏切换按钮
- `app.js`: `executeStageSwitchCommand()` 添加阶段锁定逻辑
  - 有未确认候选时禁止切换
  - 有待确认记录时弹出警告确认

**Batch 3: API 接口**
- `app.js`: 新增 `extractTargetField()` 函数，自动识别客户档案字段前缀
- `app.js`: `executeRecordCommand()` 传递 `target_field` 到后端
- 客户档案 9 字段：产品线、客户群体、收入结构、毛利结构、交付情况、资源分布、战略目标、显性诉求、隐性痛点

**Batch 4: 清理旧命令**
- 分析结果：当前命令与设计文档一致，无需清理
- 保留命令：`/记`、`/确认`、`/改`、`/切`、`/候选`、`/案例`、`/框架`、`/对比`、`/总结`

**测试验证**: 68 测试全部通过（consensusChain.test.js 50 + frontend-logic.test.js 18）

---

### ✅ `/改` 指令与修改按钮 (2026-05-04)

**问题**:
1. `/改` 指令输入后提示"未知指令"
2. 修改后原记录状态未变更，仍显示"已确认"
3. CSS 缺少 `pending_client_confirm` 状态样式

**修复**:
- `app.js`: 添加 `/改` 指令解析和 `executeCorrectCommand()` 函数
- `app.js`: 添加 `window.correctRecord()` 全局函数支持修改按钮
- `app.js`: 在 `renderConsensusChain()` 中添加"修改"按钮（黄色样式）
- `server.js`: 修复 `correctRecord` 调用，正确传递 `content` 字符串
- `server.js`: 添加 `typeof` 检查防止 `content.includes` 报错
- `style.css`: 添加 `.status-tag.pending_client_confirm` 样式（黄色背景）
- `style.css`: 添加 `.btn-inline-correct` 样式（黄色边框）

**验证**: 后端逻辑正确，原记录状态变为 `superseded`，新记录状态为 `confirmed`

---

### ✅ 会话持久化与自动恢复 (2026-05-03)

**问题**: 页面刷新后会话丢失，无法恢复之前的共识链记录和备弹 SKU。

**修复**:
- 添加 `GET /api/sessions` 端点列出所有会话
- 修改 `getOrCreateSession` 为异步函数，从磁盘恢复会话数据
- 添加共识链变更时的自动保存
- 前端添加 `autoLoadRecentSession()` 自动加载最近会话
- 恢复会话时自动调用 `loadInitialSkus()` 加载备弹
- 添加会话选择下拉框，支持切换历史会话

---

### ✅ Python 版本 record_id Bug (Day 0)

**问题**: `getClientProfile()` 返回 `record_id=null`，导致 upsert 创建重复记录。

**修复**: Node.js 版本正确返回 `record_id`。

---

### ✅ Streamlit 演示模式退出问题 (Day 6)

**问题**: Streamlit 版本添加记录后退出演示模式。

**修复**: Node.js 版本演示模式状态独立于记录操作。

---

## 🔧 调试建议

1. **启用详细日志**:
   ```bash
   LOG_LEVEL=debug npm start
   ```

2. **查看飞书同步状态**:
   ```bash
   curl http://localhost:8501/api/health
   ```

3. **检查降级报告**:
   ```bash
   curl http://localhost:8501/api/fallback/report
   ```

4. **手动重试本地缓存**:
   ```bash
   curl -X POST http://localhost:8501/api/fallback/retry
   ```

---

## 📞 反馈渠道

如发现新问题，请通过以下方式反馈：

1. 提交 Issue 到项目仓库
2. 联系开发团队
3. 更新本文档并提交 PR
