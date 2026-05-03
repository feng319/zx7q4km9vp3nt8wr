# 飞书多维表格字段映射分析报告

**生成日期**: 2026-05-04
**目的**: 梳理飞书多维表格、代码和前端之间的字段对应关系，识别遗漏和潜在问题

---

## 一、表格结构概览

### 1. 诊断共识表 (tblfZDyYjK)
**环境变量**: `FEISHU_BITABLE_CONSENSUS_TABLE_ID`

| 飞书字段名 | field_id | 类型 | 代码字段 | 前端使用 |
|-----------|----------|------|---------|---------|
| 记录ID | fldt1SGX6u | 1(文本) | `id` | ✓ |
| 时间戳 | fldLbkq9WL | 1(文本) | `timestamp` | - |
| 类型 | fldFHZB1nv | 3(单选) | `type` | ✓ |
| 阶段 | fld5nagQ3S | 3(单选) | `stage` | ✓ |
| 内容 | fldt3G5vcE | 1(文本) | `content` | ✓ |
| 来源 | fldz0rHGbl | 1(文本) | `source` | - |
| 关联SKU | fld7weLW44 | 1(文本) | `evidence_sku` | - |
| 状态 | fldFVZKCPs | 3(单选) | `status` | ✓ |
| 置信度 | fld0lg3Pej | 3(单选) | `confidence` | - |
| 替代记录 | fldk0C1onN | 1(文本) | `replaces` | - |
| 被替代 | fldfbPEPjE | 1(文本) | `superseded_by` | - |
| 建议方向 | fldXfkJp5p | 1(文本) | `recommendation` | - |

### 2. 客户档案表 (tbli9vrIAMgLfbvP)
**环境变量**: `FEISHU_BITABLE_PROFILE_TABLE_ID`

| 飞书字段名 | field_id | 类型 | 代码字段 | 前端使用 |
|-----------|----------|------|---------|---------|
| ID | fldNbOHV2L | 1005(自动编号) | - | - |
| 客户公司名 | fldSMirg0Q | 1(文本) | `客户公司名` | ✓(company) |
| 显性诉求 | flddrDkmYx | 1(文本) | `显性诉求` | ✓ |
| 产品线 | fldcpGsA0i | 1(文本) | `产品线` | ✓ |
| 客户群体 | fldgbcctGn | 1(文本) | `客户群体` | ✓ |
| 收入结构 | fldRsdz5k7 | 1(文本) | `收入结构` | ✓ |
| 毛利结构 | fldqdZ29m2 | 1(文本) | `毛利结构` | ✓ |
| 交付情况 | fldFd96pt1 | 1(文本) | `交付情况` | ✓ |
| 资源分布 | fld6ZJQ69C | 1(文本) | `资源分布` | ✓ |
| 战略目标 | fld7HElqu6 | 1(文本) | `战略目标` | ✓ |
| 完整度 | fldh9UIUjB | 20(进度条) | ❌缺失 | - |
| 当前追问 | fldbU5arYa | 1(文本) | `当前追问` | - |
| 诊断进度 | fldSCl5WAg | 2(数字) | `诊断进度` | - |

---

## 二、字段映射详细分析

### 诊断共识表映射

#### 代码 → 飞书 (`_recordToFields`)

```javascript
// feishuClient.js:462-494
代码字段          → 飞书字段        → 值转换
─────────────────────────────────────────────
id               → 记录ID          → 直接映射
timestamp        → 时间戳          → 直接映射
type             → 类型            → 'fact'→'事实', 'consensus'→'共识', 'case'→'案例', 'insight'→'洞察'
stage            → 阶段            → 直接映射
content          → 内容            → 直接映射
source           → 来源            → 直接映射
evidence_sku     → 关联SKU         → 数组join('\n')
status           → 状态            → 'recorded'→'待确认', 'pending_client_confirm'→'待确认', 'confirmed'→'已确认', 'active'→'已确认', 'superseded'→'已过时'
confidence       → 置信度          → 直接映射
replaces         → 替代记录        → 直接映射
superseded_by    → 被替代          → 直接映射
recommendation   → 建议方向        → 直接映射
```

#### 飞书 → 代码 (`_fieldsToRecord`)

```javascript
// feishuClient.js:503-519
飞书字段          → 代码字段        → 值转换
─────────────────────────────────────────────
记录ID           → id              → 直接映射
时间戳           → timestamp       → 直接映射
类型             → type            → 直接映射（⚠️ 未反向转换中文→英文）
阶段             → stage           → 直接映射
内容             → content         → 直接映射
来源             → source          → 直接映射
关联SKU          → evidence_sku    → split('\n')→数组
状态             → status          → 直接映射（⚠️ 未反向转换中文→英文）
置信度           → confidence      → 直接映射
替代记录         → replaces        → 直接映射
被替代           → superseded_by   → 直接映射
建议方向         → recommendation  → 直接映射
```

### 客户档案表映射

#### 代码 → 飞书 (`_profileToFields`)

```javascript
// feishuClient.js:528-543
代码字段          → 飞书字段
─────────────────────────────
客户公司名       → 客户公司名
产品线           → 产品线
客户群体         → 客户群体
收入结构         → 收入结构
毛利结构         → 毛利结构
交付情况         → 交付情况
资源分布         → 资源分布
战略目标         → 战略目标
显性诉求         → 显性诉求
当前追问         → 当前追问
诊断进度         → 诊断进度
```

#### 飞书 → 代码 (`_fieldsToProfile`)

```javascript
// feishuClient.js:552-572
飞书字段          → 代码字段        → 特殊处理
─────────────────────────────────────────────
客户公司名       → 客户公司名      → 处理富文本[{text, type}]
产品线           → 产品线          → 处理富文本
客户群体         → 客户群体        → 处理富文本
收入结构         → 收入结构        → 处理富文本
毛利结构         → 毛利结构        → 处理富文本
交付情况         → 交付情况        → 处理富文本
资源分布         → 资源分布        → 处理富文本
战略目标         → 战略目标        → 处理富文本
显性诉求         → 显性诉求        → 处理富文本
当前追问         → 当前追问        → 处理富文本
诊断进度         → 诊断进度        → 处理富文本
```

---

## 三、发现的问题

### 🔴 高优先级问题

#### 1. 类型/状态字段双向映射不完整

**问题**: `_fieldsToRecord` 未将飞书中文值反向转换为代码英文值

```javascript
// 当前代码（feishuClient.js:508）
if (fields['类型']) record.type = fields['类型'];  // 返回 '事实' 而非 'fact'

// 当前代码（feishuClient.js:513）
if (fields['状态']) record.status = fields['状态'];  // 返回 '已确认' 而非 'confirmed'
```

**影响**:
- 从飞书读取的记录，type/status 是中文值
- 前端代码使用英文值判断（如 `r.type === 'fact'`）
- 导致前端过滤/显示逻辑失效

**修复建议**:
```javascript
// 类型反向映射
const typeReverseMap = {
  '事实': 'fact',
  '共识': 'consensus',
  '案例': 'case',
  '洞察': 'insight',
};

// 状态反向映射
const statusReverseMap = {
  '待确认': 'pending_client_confirm',
  '已确认': 'confirmed',
  '已过时': 'superseded',
};
```

#### 2. 客户档案表缺少 `完整度` 字段映射

**问题**: 飞书表格有 `完整度` 字段（类型20=进度条），但代码未映射

**影响**:
- 无法读取/更新客户档案完整度
- 前端无法显示档案完整度百分比

**修复建议**: 在 `_profileToFields` 和 `_fieldsToProfile` 中添加 `完整度` 字段

#### 3. `getClientProfile` filter 匹配逻辑错误

**问题**: 当前代码使用 `===` 比较富文本数组

```javascript
// feishuClient.js:285
const matchedRecord = records.find(r => r.fields?.['客户公司名'] === company);
// r.fields['客户公司名'] 是 [{text: '...', type: 'text'}] 格式
// company 是字符串，永远不匹配
```

**修复建议**:
```javascript
const matchedRecord = records.find(r => {
  const fieldValue = r.fields?.['客户公司名'];
  if (Array.isArray(fieldValue) && fieldValue[0]?.text) {
    return fieldValue[0].text === company;
  }
  return fieldValue === company;
});
```

### 🟡 中优先级问题

#### 4. `_extractProfileData` 字段提取不完整

**问题**: `consensusChain.js:316-319` 只提取 8 个字段，缺少 `当前追问` 和 `诊断进度`

```javascript
const fieldNames = [
  '产品线', '客户群体', '收入结构', '毛利结构',
  '交付情况', '资源分布', '战略目标', '显性诉求'
];
// 缺少: '当前追问', '诊断进度'
```

#### 5. 前端 `inferType` 逻辑与飞书选项不一致

**问题**: 前端只能推断 `fact` 或 `consensus`，但飞书表格有 4 个选项

```javascript
// app.js:351
function inferType(content) {
  const consensusKeywords = ['判断', '共识', '建议', '应该', '需要'];
  return consensusKeywords.some(kw => content.includes(kw)) ? 'consensus' : 'fact';
}
// 缺少: 'case'(案例), 'insight'(洞察) 的推断逻辑
```

#### 6. `feishu_record_id` 字段未同步

**问题**: 代码定义了 `feishu_record_id` 字段（types.js:29），但 `_recordToFields` 未映射

**影响**: 无法追踪本地记录与飞书记录的关联关系

### 🟢 低优先级问题

#### 7. 时间戳格式不一致

**问题**: 代码使用 ISO 8601 格式，飞书字段类型是文本，可能存在格式差异

#### 8. `evidence_sku` 数组处理

**问题**: 使用 `\n` 分隔，如果 SKU 本身包含换行符会导致解析错误

---

## 四、字段遗漏汇总

### 诊断共识表

| 遗漏项 | 说明 |
|-------|------|
| `feishu_record_id` | 代码定义但未映射到飞书 |
| 类型反向映射 | 飞书中文→代码英文 |
| 状态反向映射 | 飞书中文→代码英文 |

### 客户档案表

| 遗漏项 | 说明 |
|-------|------|
| `完整度` | 飞书有但代码未映射 |
| `当前追问` | `_extractProfileData` 未提取 |
| `诊断进度` | `_extractProfileData` 未提取 |

---

## 五、修复优先级建议

1. **立即修复**: 类型/状态反向映射（影响核心功能）
2. **立即修复**: `getClientProfile` filter 匹配逻辑
3. **短期修复**: 添加 `完整度` 字段映射
4. **短期修复**: `_extractProfileData` 补充字段
5. **中期修复**: `feishu_record_id` 同步追踪
6. **中期修复**: 前端 `inferType` 扩展

---

## 六、建议的字段映射统一方案

### 创建统一的映射模块

```javascript
// src/utils/fieldMapping.js

// 诊断共识表映射
const CONSENSUS_TYPE_MAP = {
  // 代码 → 飞书
  toFeishu: {
    'fact': '事实',
    'consensus': '共识',
    'case': '案例',
    'insight': '洞察',
  },
  // 飞书 → 代码
  toCode: {
    '事实': 'fact',
    '共识': 'consensus',
    '案例': 'case',
    '洞察': 'insight',
  }
};

const CONSENSUS_STATUS_MAP = {
  toFeishu: {
    'recorded': '待确认',
    'pending_client_confirm': '待确认',
    'confirmed': '已确认',
    'active': '已确认',
    'superseded': '已过时',
  },
  toCode: {
    '待确认': 'pending_client_confirm',
    '已确认': 'confirmed',
    '已过时': 'superseded',
  }
};

// 客户档案表字段列表（完整）
const PROFILE_FIELDS = [
  '客户公司名', '产品线', '客户群体', '收入结构', '毛利结构',
  '交付情况', '资源分布', '战略目标', '显性诉求', '当前追问',
  '诊断进度', '完整度'
];

// 富文本提取工具
function extractRichTextValue(fieldValue) {
  if (Array.isArray(fieldValue) && fieldValue[0]?.text) {
    return fieldValue[0].text;
  }
  return fieldValue;
}
```

---

**报告完成**。建议按优先级逐步修复字段映射问题。