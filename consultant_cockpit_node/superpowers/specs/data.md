# 数据规范

> **最后更新**: 2026-05-05
> **代码位置**: `consultant_cockpit_node/src/types.js` + `src/config/fields.js` + `src/utils/fieldMapping.js`

---

## 一、核心数据类型

### 1.1 共识链记录 (ConsensusRecord)

```javascript
{
  id: string,                    // 格式：record_0、record_0_corr_1
  timestamp: string,             // ISO 8601
  type: ConsensusType,           // 'fact' | 'consensus'
  stage: Stage,                  // '战略梳理' | '商业模式' | '行业演示'
  content: string,               // 记录内容
  source: RecordSource,          // 'manual' | 'candidate_selected' | 'ai_suggested' | 'manual_correction'
  evidence_sku: string[],        // 关联 SKU ID 列表
  status: RecordStatus,          // 'recorded' | 'pending_client_confirm' | 'confirmed' | 'superseded'
  confidence: ConfidenceLevel|null, // 'high' | 'medium' | 'low'（仅 ai_suggested）
  replaces: string|null,         // 替代的原记录 ID
  superseded_by: string|null,    // 被哪条记录替代
  feishu_record_id: string|null, // 飞书记录 ID
  recommendation: string|null,   // 建议方向（仅 consensus 类型）
  target_field: string|null,     // 目标客户档案字段（产品线/客户群体/收入结构/毛利结构/交付情况/资源分布/战略目标/显性诉求/隐性痛点）
}
```

### 1.2 客户档案 (ClientProfileFields)

```javascript
{
  客户公司名: string,    // 用于筛选，不计入完整度
  产品线: string,        // 计入完整度
  客户群体: string,
  收入结构: string,
  毛利结构: string,
  交付情况: string,
  资源分布: string,
  战略目标: string,
  显性诉求: string,
  隐性痛点: string,      // PRD 定义但飞书表暂无此字段
  当前追问: string,      // 动态字段
  诊断进度: number,      // 动态字段（0-100）
}
```

### 1.3 其他类型

| 类型名 | 值域 | 说明 |
|--------|------|------|
| `ConsensusType` | `'fact' \| 'consensus'` | PRD 4.3 节定义 |
| `Stage` | `'战略梳理' \| '商业模式' \| '行业演示'` | 三个阶段 |
| `RecordSource` | `'manual' \| 'candidate_selected' \| 'ai_suggested' \| 'manual_correction'` | 来源 |
| `RecordStatus` | `'recorded' \| 'pending_client_confirm' \| 'confirmed' \| 'superseded'` | 状态 |
| `ConfidenceLevel` | `'high' \| 'medium' \| 'low'` | 置信度 |
| `RiskLevel` | `'稳健' \| '平衡' \| '激进'` | 候选方案风险等级 |
| `SkuConfidence` | `'🟢' \| '🟡' \| '🔴'` | SKU 可信度标签 |
| `BattleCardMode` | `'hypothesis' \| 'info_building'` | 作战卡模式 |

---

## 二、字段映射规则

### 2.1 诊断共识表字段映射

**飞书表 ID**: `tblfZDyYjK`（环境变量 `FEISHU_BITABLE_CONSENSUS_TABLE_ID`）

| # | 飞书字段名 | field_id | 飞书类型 | 代码字段名 | PRD 可见性 |
|---|-----------|----------|---------|-----------|-----------|
| 1 | 记录ID | fldt1SGX6u | 自动编号 | id | 内部 |
| 2 | 时间戳 | fldLbkq9WL | 文本 | timestamp | → 确认时间 |
| 3 | 类型 | fldFHZB1nv | 单选 | type | 内部 |
| 4 | 阶段 | fld5nagQ3S | 单选 | stage | 内部 |
| 5 | 内容 | fldt3G5vcE | 多行文本 | content | → 发现内容 |
| 6 | 来源 | fldz0rHGbl | 单选 | source | 内部 |
| 7 | 关联SKU | fld7weLW44 | 多行文本 | evidence_sku | 内部 |
| 8 | 状态 | fldFVZKCPs | 单选 | status | 内部 |
| 9 | 置信度 | fld0lg3Pej | 单选 | confidence | 内部 |
| 10 | 替代记录 | fldk0C1onN | 文本 | replaces | 内部 |
| 11 | 被替代 | fldfbPEPjE | 文本 | superseded_by | 内部 |
| 12 | 建议方向 | fldXfkJp5p | 文本 | recommendation | 客户可见 |

### 2.2 客户档案表字段映射

**飞书表 ID**: `tbli9vrIAMgLfbvP`（环境变量 `FEISHU_BITABLE_PROFILE_TABLE_ID`）

| # | 飞书字段名 | field_id | 飞书类型 | 代码字段名 | PRD 可见性 |
|---|-----------|----------|---------|-----------|-----------|
| 1 | ID | fldNbOHV2L | 自动编号 | - | 内部 |
| 2 | 客户公司名 | fldSMirg0Q | 文本 | 客户公司名 | 客户可见 |
| 3-10 | (9个静态字段) | ... | 文本 | (对应字段名) | 客户可见 |
| 11 | 当前追问 | fldbU5arYa | 文本 | 当前追问 | 客户可见 |
| 12 | 诊断进度 | fldSCl5WAg | 数字 | 诊断进度 | 客户可见 |

---

## 三、状态流转规则

### 3.1 类型映射 (type)

```
代码 → 飞书                    飞书 → 代码
─────────────────────────────────────────────────
fact      →  事实              事实      →  fact
consensus →  共识              共识      →  consensus
```

**规则**: PRD 4.3 节只定义 `fact` 和 `consensus`，`case` 和 `insight` 已移除。

### 3.2 状态映射 (status)

```
代码 → 飞书                         飞书 → 代码
──────────────────────────────────────────────────────
recorded            →  已记录        已记录 → recorded
pending_client_confirm → 待确认      待确认 → pending_client_confirm
confirmed           →  已确认        已确认 → confirmed
superseded          →  已过时        已过时 → superseded
```

**规则**: 1:1 双向映射，已移除 `active` 状态。

### 3.3 状态流转图

```
                    ┌─────────────────────────────────────┐
                    │                                     ▼
              recorded ──────────────────────→ pending_client_confirm ──→ confirmed
                  │                                   │                    │
                  │                                   │                    │
                  └───────────────────────────────────┘                    ↓
                     （手动 /确认 直接确认）                          superseded
```

**两条确认路径**:
1. **手动记录路径**: `/记` → `recorded` → `/确认` → `confirmed`
2. **候选选中路径**: 候选选中 → `pending_client_confirm` → `/确认` → `confirmed`

**状态转换触发**:
- `recorded` → `pending_client_confirm`: `setCandidateRecordPending()` 候选选中时调用
- `recorded` → `confirmed`: `/确认` 指令直接确认
- `pending_client_confirm` → `confirmed`: `/确认` 指令
- `confirmed` → `superseded`: `/改` 指令修正，原记录标记为 superseded

**注意**: 新记录默认状态为 `recorded`（2026-05-05 重构变更）。

---

## 四、完整度计算规则

### 4.1 计算字段（9 个，PRD 6.2 节）

```
产品线、客户群体、收入结构、毛利结构、交付情况、资源分布、显性诉求、隐性痛点、战略目标
```

**注意**: "客户公司名"用于筛选，不计入完整度。

### 4.2 计算方式

- 9 个字段等权重，每个字段非空即计 11%
- 字段非空判定: 内容长度 >= 5 个字符
- 统一使用 `src/config/fields.js` 中的 `calcCompleteness()` 函数

### 4.3 阈值逻辑

| 完整度 | 模式 | 说明 |
|--------|------|------|
| >= 60% | 验证假设版 | 深挖已知信息 |
| < 60% | 信息建立版 | 系统性追问 |

---

## 五、客户视图转换

### 5.1 PRD 4.4 节客户视图（3 列）

| 内部字段 | 客户视图列名 |
|---------|-------------|
| content | 发现内容 |
| timestamp | 确认时间 |
| recommendation | 建议方向 |

### 5.2 转换函数

| 函数 | 位置 | 说明 |
|------|------|------|
| `toCustomerView()` | `fields.js:206` | 单条记录转换 |
| `toCustomerViewBatch()` | `fields.js:219` | 批量转换 |
| `filterCustomerFields()` | `fields.js:229` | 过滤客户可见字段 |

---

## 六、SKU 字段处理

### 6.1 序列化规则

- 代码 → 飞书: SKU 数组用 `\n` 换行分隔写入
- 飞书 → 代码: 按 `\n` 分割还原为数组

```javascript
// skuArrayToFeishu(['sku_001', 'sku_002']) → 'sku_001\nsku_002'
// skuStringToArray('sku_001\nsku_002') → ['sku_001', 'sku_002']
```

### 6.2 富文本处理

- 飞书返回格式: `[{text: '储能', type: 'text'}]`
- 提取规则: 拼接所有 text 段，而非只取第一段

```javascript
// extractRichTextValue([{text:'储能',type:'text'}, {text:'系统',type:'text'}])
// → '储能系统'
```

---

## 七、字段维护指南

**统一维护入口**: 所有字段定义在 `src/config/fields.js` 管理。

### 新增字段步骤

1. 添加到 `COMPLETENESS_FIELDS`（如需计入完整度）
2. 添加到 `PROFILE_FIELDS`（如属客户档案字段）
3. 如需飞书映射，添加到 `CONSENSUS_FIELDS`
4. 在飞书多维表格中创建对应字段

### 引用方式

```javascript
const {
  COMPLETENESS_FIELDS,
  PROFILE_FIELDS,
  calcCompleteness,
  typeToFeishu,
  statusToFeishu,
} = require('../config/fields');
```