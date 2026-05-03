# 飞书字段映射速查表

**更新日期**: 2026-05-04

---

## 一、诊断共识表 (tblfZDyYjK)

### 字段完整对应关系

| # | 飞书字段名 | field_id | 飞书类型 | 代码字段名 | 代码类型 | 映射说明 |
|---|-----------|----------|---------|-----------|---------|---------|
| 1 | 记录ID | fldt1SGX6u | 自动编号 | id | string | 直接映射 |
| 2 | 时间戳 | fldLbkq9WL | 文本 | timestamp | string | ISO 8601 格式 |
| 3 | 类型 | fldFHZB1nv | 单选 | type | string | ⚠️ 需转换（见下表） |
| 4 | 阶段 | fld5nagQ3S | 单选 | stage | string | 直接映射 |
| 5 | 内容 | fldt3G5vcE | 多行文本 | content | string | 直接映射 |
| 6 | 来源 | fldz0rHGbl | 单选 | source | string | 直接映射 |
| 7 | 关联SKU | fld7weLW44 | 多行文本 | evidence_sku | string[] | ⚠️ 换行分隔↔数组 |
| 8 | 状态 | fldFVZKCPs | 单选 | status | string | ⚠️ 需转换（见下表） |
| 9 | 置信度 | fld0lg3Pej | 单选 | confidence | string | 直接映射 |
| 10 | 替代记录 | fldk0C1onN | 文本 | replaces | string | 直接映射 |
| 11 | 被替代 | fldfbPEPjE | 文本 | superseded_by | string | 直接映射 |
| 12 | 建议方向 | fldXfkJp5p | 文本 | recommendation | string | 直接映射 |

### 类型字段映射 (type)

```
代码 → 飞书          飞书 → 代码
─────────────────────────────────
fact      →  事实    事实      →  fact
consensus →  共识    共识      →  consensus
case      →  案例    案例      →  case
insight   →  洞察    洞察      →  insight
```

### 状态字段映射 (status)

```
代码 → 飞书                    飞书 → 代码
─────────────────────────────────────────────
recorded            →  待确认   待确认 → pending_client_confirm
pending_client_confirm → 待确认   已确认 → confirmed
confirmed           →  已确认   已过时 → superseded
active              →  已确认
superseded          →  已过时
```

---

## 二、客户档案表 (tblRZGlsQX)

### 字段完整对应关系

| # | 飞书字段名 | field_id | 飞书类型 | 代码字段名 | 代码类型 | 映射说明 |
|---|-----------|----------|---------|-----------|---------|---------|
| 1 | 客户公司名 | fldSMirg0Q | 文本 | 客户公司名 | string | 直接映射 |
| 2 | 产品线 | fldcpGsA0i | 文本 | 产品线 | string | ⚠️ 富文本需提取 |
| 3 | 客户群体 | fldgbcctGn | 文本 | 客户群体 | string | ⚠️ 富文本需提取 |
| 4 | 收入结构 | fldRsdz5k7 | 文本 | 收入结构 | string | ⚠️ 富文本需提取 |
| 5 | 毛利结构 | fldqdZ29m2 | 文本 | 毛利结构 | string | ⚠️ 富文本需提取 |
| 6 | 交付情况 | fldFd96pt1 | 文本 | 交付情况 | string | ⚠️ 富文本需提取 |
| 7 | 资源分布 | fld6ZJQ69C | 文本 | 资源分布 | string | ⚠️ 富文本需提取 |
| 8 | 战略目标 | fld7HElqu6 | 文本 | 战略目标 | string | ⚠️ 富文本需提取 |
| 9 | 显性诉求 | flddrDkmYx | 文本 | 显性诉求 | string | ⚠️ 富文本需提取 |
| 10 | 当前追问 | fldbU5arYa | 文本 | 当前追问 | string | ⚠️ 富文本需提取 |
| 11 | 诊断进度 | fldSCl5WAg | 数字 | 诊断进度 | number | 直接映射 |
| 12 | 完整度 | fldh9UIUjB | 进度条 | 完整度 | number | ✅ 已添加映射 |

### 富文本格式说明

飞书返回格式：
```json
[{ "text": "实际内容", "type": "text" }]
```

代码提取方式：
```javascript
if (Array.isArray(value) && value[0]?.text) {
  profile[name] = value[0].text;
}
```

---

## 三、字段流向图

```
┌─────────────────────────────────────────────────────────────────┐
│                        诊断共识表                                │
├─────────────────────────────────────────────────────────────────┤
│  写入流向 (代码 → 飞书)                                          │
│  ┌──────────┐    _recordToFields()    ┌──────────────┐         │
│  │ 代码对象  │ ──────────────────────→ │ 飞书字段     │         │
│  │ type: 'fact' │                     │ 类型: '事实' │         │
│  │ status: 'confirmed' │              │ 状态: '已确认'│         │
│  └──────────┘                        └──────────────┘         │
│                                                                  │
│  读取流向 (飞书 → 代码)                                          │
│  ┌──────────────┐    _fieldsToRecord()    ┌──────────┐        │
│  │ 飞书字段     │ ───────────────────────→ │ 代码对象  │        │
│  │ 类型: '事实' │                         │ type: 'fact' │     │
│  │ 状态: '已确认'│                        │ status: 'confirmed' │
│  └──────────────┘                         └──────────┘        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        客户档案表                                │
├─────────────────────────────────────────────────────────────────┤
│  写入流向 (代码 → 飞书)                                          │
│  ┌──────────┐    _profileToFields()    ┌──────────────┐        │
│  │ 代码对象  │ ──────────────────────→ │ 飞书字段     │        │
│  │ 完整度: 75 │                        │ 完整度: 75   │        │
│  └──────────┘                        └──────────────┘        │
│                                                                  │
│  读取流向 (飞书 → 代码)                                          │
│  ┌──────────────┐    _fieldsToProfile()    ┌──────────┐       │
│  │ 飞书字段     │ ────────────────────────→ │ 代码对象  │       │
│  │ 产品线: [{text:'储能',type:'text'}] │    │ 产品线: '储能' │   │
│  │ 完整度: 75   │                          │ 完整度: 75 │      │
│  └──────────────┘                          └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、代码文件对照

| 功能 | 文件路径 | 关键方法 |
|-----|---------|---------|
| 飞书API客户端 | `src/integrations/feishuClient.js` | `_recordToFields`, `_fieldsToRecord`, `_profileToFields`, `_fieldsToProfile` |
| 共识链管理 | `src/core/consensusChain.js` | `_extractProfileData` |
| 类型定义 | `src/types.js` | `ConsensusRecord`, `ClientProfileFields` |
| 统一映射模块 | `src/utils/fieldMapping.js` | `typeToFeishu`, `typeToCode`, `statusToFeishu`, `statusToCode` |

---

## 五、修复状态

| 问题 | 状态 | 说明 |
|-----|------|-----|
| 类型/状态反向映射 | ✅ 已修复 | `_fieldsToRecord` 添加了 `typeReverseMap`/`statusReverseMap` |
| 完整度字段映射 | ✅ 已修复 | `_profileToFields`/`_fieldsToProfile` 已支持 |
| 富文本格式处理 | ✅ 已修复 | `_fieldsToProfile` 自动提取 `value[0].text` |
| Filter 匹配逻辑 | ✅ 已修复 | `getClientProfile` 改用 `search` API |
| _extractProfileData | ✅ 已修复 | 补充了 `当前追问`、`诊断进度` 提取 |
| 统一映射模块 | ✅ 已创建 | `src/utils/fieldMapping.js` |
