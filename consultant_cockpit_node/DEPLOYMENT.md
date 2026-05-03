# 顾问现场作战系统 · 部署指南

## 目录

1. [飞书开发者后台配置](#1-飞书开发者后台配置)
2. [本地开发环境](#2-本地开发环境)
3. [生产环境部署](#3-生产环境部署)
4. [飞书多维表格配置](#4-飞书多维表格配置)
5. [常见问题](#5-常见问题)

---

## 1. 飞书开发者后台配置

### 1.1 创建应用

1. 登录飞书开发者后台：https://open.feishu.cn/app
2. 点击「创建企业自建应用」
3. 填写应用名称，如「顾问作战系统」
4. 记录 `App ID` 和 `App Secret`

### 1.2 配置权限

在「权限管理」中申请以下权限：

| 权限名称 | 权限标识 | 用途 |
|----------|----------|------|
| 查看、评论、编辑和管理多维表格 | `bitable:app` | 读写客户档案 |
| 查看和下载云空间中的文件 | `drive:drive:readonly` | 读取文档模板 |

### 1.3 配置事件订阅（可选）

如需实时同步功能：

1. 在「事件订阅」中配置请求网址
2. 订阅以下事件：
   - `drive.file.bitable_record_changed_v1` - 多维表格记录变更
   - `drive.file.edit_v1` - 文档编辑

**本地开发**：使用 ngrok 暴露本地服务

```bash
ngrok http 8501
# 将 https://xxx.ngrok.io 填入请求网址
```

### 1.4 发布应用

1. 在「版本管理与发布」中创建版本
2. 提交审核
3. 审核通过后发布到企业

---

## 2. 本地开发环境

### 2.1 安装依赖

```bash
cd consultant_cockpit_node
npm install
```

### 2.2 配置环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# LLM 配置
OPENAI_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4

# 飞书配置
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_BITABLE_APP_TOKEN=xxx
FEISHU_BITABLE_TABLE_ID=tblxxx
FEISHU_BITABLE_CONSENSUS_TABLE_ID=tblxxx

# 服务配置
PORT=8501
LOG_LEVEL=debug
```

### 2.3 启动服务

```bash
npm start
```

或使用开发模式（自动重启）：

```bash
npm run dev
```

### 2.4 验证安装

```bash
# 健康检查
curl http://localhost:8501/api/health

# 运行测试
npm test
```

---

## 3. 生产环境部署

### 3.1 服务器要求

- **操作系统**: Ubuntu 20.04+ / CentOS 7+
- **内存**: 最低 1GB，推荐 2GB+
- **磁盘**: 最低 10GB
- **Node.js**: 18.x LTS

### 3.2 安装 Node.js

```bash
# Ubuntu
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

### 3.3 部署代码

```bash
# 克隆代码
git clone <repo-url> /opt/consultant-cockpit
cd /opt/consultant-cockpit/consultant_cockpit_node

# 安装生产依赖
npm install --production

# 创建必要目录
mkdir -p data logs
```

### 3.4 配置环境变量

```bash
# 创建环境变量文件
cat > .env << EOF
OPENAI_API_KEY=sk-xxx
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_BITABLE_APP_TOKEN=xxx
FEISHU_BITABLE_TABLE_ID=tblxxx
PORT=8501
LOG_LEVEL=info
EOF

# 设置权限
chmod 600 .env
```

### 3.5 使用 PM2 管理

```bash
# 安装 PM2
sudo npm install -g pm2

# 启动服务
pm2 start server.js --name consultant-cockpit

# 设置开机自启
pm2 startup
pm2 save
```

### 3.6 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8501;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 3.7 HTTPS 配置（推荐）

使用 Let's Encrypt：

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

---

## 4. 飞书多维表格配置

### 4.1 创建多维表格

1. 在飞书云文档中创建「多维表格」
2. 记录 URL 中的 `app_token`（如 `https://feishu.cn/base/xxx` 中的 `xxx`）

### 4.2 客户档案表结构

创建名为「客户档案」的数据表，包含以下字段：

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| 客户公司名 | 文本 | 必填，唯一标识 |
| 产品线 | 文本 | |
| 客户群体 | 文本 | |
| 收入结构 | 文本 | |
| 毛利结构 | 文本 | |
| 交付情况 | 文本 | |
| 资源分布 | 文本 | |
| 战略目标 | 文本 | |
| 显性诉求 | 文本 | |
| 当前追问 | 文本 | 可选 |
| 诊断进度 | 文本 | 格式 "50%" |

### 4.3 诊断共识表结构（可选）

创建名为「诊断共识」的数据表：

| 字段名 | 字段类型 | 说明 |
|--------|----------|------|
| 会话ID | 文本 | 关联会话 |
| 类型 | 单选 | fact / consensus |
| 阶段 | 单选 | 战略梳理 / 商业模式 / 行业演示 |
| 内容 | 文本 | |
| 来源 | 单选 | manual / ai_suggested / candidate_selected |
| 状态 | 单选 | recorded / confirmed / superseded |
| 创建时间 | 日期 | |

### 4.4 获取 Table ID

在多维表格 URL 中：
```
https://feishu.cn/base/appToken?table=tableId
```

- `appToken` → `FEISHU_BITABLE_APP_TOKEN`
- `tableId` → `FEISHU_BITABLE_TABLE_ID`

---

## 5. 常见问题

### 5.1 飞书 API 返回 429 错误

**原因**：请求频率超限

**解决方案**：
1. 系统已内置重试机制
2. 检查 `logs/feishu_local_cache.json` 中是否有未同步数据
3. 使用 `/api/fallback/retry` 接口手动重试

### 5.2 LLM 响应超时

**原因**：网络问题或 API 负载高

**解决方案**：
1. 检查网络连接
2. 增加 `LLM_TIMEOUT_SECONDS` 环境变量
3. 系统会自动降级为模板响应

### 5.3 会话数据丢失

**原因**：服务异常退出

**解决方案**：
1. 检查 `data/sessions/` 目录是否存在
2. 服务重启后会自动恢复最近会话
3. 定期备份 `data/` 目录

### 5.4 WebSocket 连接断开

**原因**：网络不稳定或代理配置问题

**解决方案**：
1. 检查 Nginx 配置是否支持 WebSocket
2. 确保配置了 `proxy_set_header Upgrade` 和 `Connection`
3. 前端会自动重连

### 5.5 Word 文档中文乱码

**原因**：系统缺少中文字体

**解决方案**：
1. Windows：确保安装了微软雅黑
2. Linux：安装字体包
   ```bash
   sudo apt install fonts-wqy-microhei fonts-wqy-zenhei
   ```

---

## 附录：环境变量完整列表

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `OPENAI_API_KEY` | 是 | - | OpenAI API Key |
| `LLM_BASE_URL` | 否 | `https://api.openai.com/v1` | LLM API 地址 |
| `LLM_MODEL` | 否 | `gpt-4` | 模型名称 |
| `LLM_TIMEOUT_SECONDS` | 否 | `10` | LLM 超时时间（秒） |
| `FEISHU_APP_ID` | 是 | - | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 是 | - | 飞书应用密钥 |
| `FEISHU_BITABLE_APP_TOKEN` | 是 | - | 多维表格 Token |
| `FEISHU_BITABLE_TABLE_ID` | 是 | - | 客户档案表 ID |
| `FEISHU_BITABLE_CONSENSUS_TABLE_ID` | 否 | - | 诊断共识表 ID |
| `PORT` | 否 | `8501` | 服务端口 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `NODE_ENV` | 否 | `development` | 运行环境 |
