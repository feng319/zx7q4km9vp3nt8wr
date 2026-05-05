# 运维文档

> **最后更新**: 2026-05-05

---

## 一、环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

---

## 二、安装与启动

### 2.1 安装依赖

```bash
cd consultant_cockpit_node
npm install
```

### 2.2 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填写真实值
```

### 2.3 启动服务

```bash
npm start
# 或
./start.bat  # Windows
./start.sh   # Linux/Mac
```

访问 http://localhost:8501

---

## 三、环境变量配置

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API Key | 是 | - |
| `LLM_BASE_URL` | LLM API 地址 | 否 | https://api.openai.com/v1 |
| `LLM_MODEL` | 模型名称 | 否 | gpt-4o-mini |
| `FEISHU_APP_ID` | 飞书应用 ID | 是 | - |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 是 | - |
| `FEISHU_BITABLE_APP_TOKEN` | 多维表格 App Token | 是 | - |
| `FEISHU_BITABLE_TABLE_ID` | 客户档案表 ID | 是 | - |
| `FEISHU_BITABLE_CONSENSUS_TABLE_ID` | 诊断共识表 ID | 否 | - |
| `PORT` | 服务端口 | 否 | 8501 |
| `LOG_LEVEL` | 日志级别 | 否 | info |
| `SESSION_STORAGE_DIR` | 会话存储目录 | 否 | ./data/sessions |
| `SESSION_AUTO_SAVE_INTERVAL` | 自动保存间隔(ms) | 否 | 60000 |
| `KNOWLEDGE_BASE_PATH` | 知识库路径 | 否 | ../新能源/输出 |
| `KEYWORDS_DICT_PATH` | 关键词字典路径 | 否 | config/keywords.json |

---

## 四、飞书配置

### 4.1 应用权限

确保飞书应用已开通以下权限：
- `bitable:app` - 多维表格读写
- `drive:drive` - 文件操作（用于事件订阅）

### 4.2 事件订阅

1. 开发者后台 → 事件与回调 → 订阅方式 → 使用长连接接收事件
2. 添加事件：
   - `drive.file.bitable_record_changed_v1`
   - `drive.file.edit_v1`
3. 调用订阅 API：
   ```
   POST drive/v1/files/:file_token/subscribe?file_type=bitable
   ```

### 4.3 多维表格配置

确保多维表格包含以下数据表：
- **客户档案表**: 9 静态字段 + 2 动态字段
- **诊断共识表**: 12 字段（内部使用）

---

## 五、测试

### 5.1 运行测试

```bash
# 运行所有测试
npm test

# 运行金标准测试
node --test tests/golden_test_runner.js

# 运行单个测试文件
node --test tests/consensusChain.test.js
```

### 5.2 测试覆盖率

目标: >= 80%

---

## 六、常见问题排查

### 6.1 飞书连接失败

**症状**: `/api/feishu-status` 返回 `connected: false`

**排查步骤**:
1. 检查 `.env` 中的飞书配置是否正确
2. 确认飞书应用已开通 `bitable:app` 权限
3. 检查多维表格 App Token 和 Table ID 是否匹配

### 6.2 LLM 调用超时

**症状**: 候选生成或备忘录生成超时

**排查步骤**:
1. 检查网络连接
2. 调整 `LLM_TIMEOUT_SECONDS` 环境变量（默认 10 秒）
3. 检查 API Key 是否有效

### 6.3 Word 中文乱码

**症状**: 生成的 Word 文档中文显示异常

**解决方案**: 确认系统安装了微软雅黑字体

### 6.4 会话丢失

**症状**: 页面刷新后会话数据丢失

**排查步骤**:
1. 检查 `data/sessions/` 目录是否存在
2. 检查 `SESSION_STORAGE_DIR` 配置是否正确
3. 查看服务日志是否有保存失败记录

### 6.5 演示模式意外退出

**症状**: Streamlit 全量重渲染后演示模式被重置

**解决方案**: 已在 Node.js 版本中修复，`demo_mode` 状态持久化到会话

---

## 七、日志

### 7.1 日志级别

- `error`: 错误信息
- `warn`: 警告信息
- `info`: 一般信息（默认）
- `debug`: 调试信息

### 7.2 日志位置

- 控制台输出（pino-pretty 格式化）
- 可配置输出到文件

---

## 八、备份与恢复

### 8.1 会话备份

会话数据存储在 `data/sessions/` 目录，可直接复制备份。

### 8.2 恢复会话

将备份的会话文件复制回 `data/sessions/` 目录，重启服务即可恢复。

---

## 九、性能调优

### 9.1 候选预计算

- 预计算间隔: 30 秒
- 单次会议预计算上限: 20 次
- 缓存过期: 共识链变更/阶段切换/SKU 变化

### 9.2 飞书 API 限流

- 写入类接口: 1 次/秒
- 批量写入延迟: 500ms（保守值）
- 429 重试: 读取 `x-ogw-ratelimit-reset` 等待后重试

---

## 十、安全注意事项

1. **API Key 保护**: `.env` 文件不入 git
2. **会话数据**: 包含客户信息，注意访问控制
3. **飞书权限**: 最小权限原则，只开通必要权限