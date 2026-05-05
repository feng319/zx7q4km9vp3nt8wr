# API 接口规范

> **最后更新**: 2026-05-05
> **代码位置**: `consultant_cockpit_node/server.js`

---

## 一、REST API 端点

### 1.1 健康检查

```
GET /api/health
```

**响应**:
```json
{
  "status": "ok",
  "timestamp": "2026-05-05T10:00:00.000Z",
  "sessions": 1
}
```

### 1.2 飞书连接状态

```
GET /api/feishu-status
```

**响应**:
```json
{
  "connected": true,
  "message": "已连接",
  "bitable_accessible": true,
  "sync_mode": "websocket",
  "sync_latency": "< 1秒"
}
```

### 1.3 会话管理

```
POST /api/sessions              # 创建会话
GET  /api/sessions              # 列出所有会话（按修改时间排序）
GET  /api/sessions/:sessionId   # 获取会话状态
PATCH /api/sessions/:sessionId/company  # 更新公司名
PATCH /api/sessions/:sessionId/stage    # 更新当前阶段
GET  /api/sessions/:sessionId/export    # 导出会话
POST /api/sessions/:sessionId/import    # 导入会话
```

**创建会话请求**:
```json
{
  "company": "示例公司"
}
```

**会话状态响应**:
```json
{
  "session_id": "uuid",
  "records": [],
  "record_count": 0,
  "completeness": 0,
  "fields_status": {},
  "current_stage": "战略梳理",
  "confirmed_facts": 0,
  "confirmed_consensus": 0,
  "pending_consensus": 0,
  "company": "示例公司"
}
```

### 1.4 记录操作

```
POST /api/sessions/:sessionId/records                    # 添加记录
POST /api/sessions/:sessionId/records/:recordId/confirm  # 确认记录
POST /api/sessions/:sessionId/records/:recordId/correct  # 修正记录
GET  /api/sessions/:sessionId/facts                      # 获取已确认事实
POST /api/sessions/:sessionId/confirm                    # 智能确认（无ID时确认最新pending）
```

**添加记录请求**:
```json
{
  "type": "fact",
  "content": "客户产品线5条",
  "source": "manual",
  "evidence_sku": []
}
```

### 1.5 候选方案

```
GET /api/sessions/:sessionId/candidates  # 获取候选方案
```

**响应**:
```json
{
  "success": true,
  "candidates": [
    {
      "id": "A",
      "title": "聚焦储能主航道",
      "description": "...",
      "risk_level": "稳健",
      "evidence_skus": ["sku_001"]
    }
  ],
  "cache_status": {
    "is_valid": true,
    "age_seconds": 30
  },
  "cache_hit": true
}
```

### 1.6 知识召回

```
POST /api/sessions/:sessionId/recall
```

**请求**:
```json
{
  "keywords": ["虚拟电厂", "储能"],
  "top_k": 5
}
```

### 1.7 文档生成

```
POST /api/sessions/:sessionId/memo         # 生成备忘录
POST /api/sessions/:sessionId/battle-card  # 生成作战卡
```

**作战卡请求**:
```json
{
  "company": "示例公司",
  "consultant": "顾问姓名"
}
```

### 1.8 演示模式

```
GET  /api/demo-mode   # 获取演示模式状态
POST /api/demo-mode   # 设置演示模式
```

**请求**:
```json
{
  "level": 2
}
```

**级别说明**:
- 0: 关闭
- 1: 隐藏敏感信息
- 2: 替换技术术语
- 3: 保留（完全演示模式）

### 1.9 降级报告

```
GET  /api/fallback/report  # 获取降级报告
POST /api/fallback/retry   # 重试本地缓存
```

---

## 二、WebSocket 事件

### 2.1 连接

```
WS /ws/:sessionId
```

### 2.2 服务端 → 客户端事件

| 事件类型 | 说明 | 数据结构 |
|---------|------|---------|
| `init` | 初始化连接 | `{ session_id, records }` |
| `record_added` | 记录已添加 | `{ type: 'add', record }` |
| `record_confirmed` | 记录已确认 | `{ type: 'confirm', record }` |
| `record_corrected` | 记录已修正 | `{ type: 'correct', record }` |
| `candidates_ready` | 候选预计算完成 | `{ candidates }` |
| `profile_changed` | 客户档案变更 | `{ table_type, company, record_id, change_type, record }` |
| `feishu_record_changed` | 飞书记录变更 | `{ table_type, company, record_id, change_type, record }` |

### 2.3 客户端 → 服务端

客户端发送的 JSON 消息会被记录到日志，暂无特定处理逻辑。

---

## 三、飞书 API 调用规范

### 3.1 限流规则

| 接口类型 | QPS 限制 | QPM 限制 | 处理方式 |
|---------|---------|---------|---------|
| 写入类接口 | 1次/秒 | 60次/分钟 | 读取 `x-ogw-ratelimit-reset` 响应头等待重试 |
| 读取类接口 | 10-20次/秒 | - | 正常调用 |

### 3.2 429 处理逻辑

1. 触发后读取响应头 `x-ogw-ratelimit-reset`
2. 等待对应秒数后重试（禁止立即重试）
3. 批量写入使用 `lark-cli --page-delay 500ms`
4. 实测稳定后可降至 200ms

### 3.3 自定义机器人限制

- 限制: 100次/分钟、5次/秒
- 避开 10:00/17:30 整点半点时段
- 不支持提频

### 3.4 SDK 使用

```javascript
// 使用 @larksuiteoapi/node-sdk
const client = new Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
});

// 多维表格操作
await client.bitable.appTableRecord.create({
  path: {
    app_token: bitableToken,
    table_id: tableId,
  },
  params: { records: [record] },
});
```

---

## 四、错误码

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

**错误响应格式**:
```json
{
  "success": false,
  "error": "错误信息"
}
```