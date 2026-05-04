# 飞书多维表格字段映射分析报告

**生成日期**: 2026-05-04
**最后更新**: 2026-05-04
**目的**: 梳理飞书多维表格、代码和前端之间的字段对应关系，识别遗漏和潜在问题

---

## 问题修复总览

### 已修复问题

| 问题 | 优先级 | 状态 | 修复日期 |
|------|--------|------|----------|
| 类型/状态反向映射缺失 | 🔴高 | ✅已修复 | 2026-05-04 |
| getClientProfile filter 匹配逻辑错误 | 🔴高 | ✅已修复 | 2026-05-04 |
| _extractProfileData 字段提取不完整 | 🟡中 | ✅已修复 | 2026-05-04 |
| 创建统一字段映射模块 | 🟡中 | ✅已完成 | 2026-05-04 |
| 完整度计算不一致（8 vs 9 字段） | 🔴P0 | ✅已修复 | 2026-05-04 |
| 状态映射多对一不可逆 | 🔴P0 | ✅已修复 | 2026-05-04 |
| 类型字段多余 case/insight | 🟡P1 | ✅已修复 | 2026-05-04 |
| recommendation 写入校验缺失 | 🟡P1 | ✅已修复 | 2026-05-04 |
| 富文本多段拼接 | 🟢P2 | ✅已修复 | 2026-05-04 |
| 客户档案"完整度"字段冗余 | 🔴P0 | ✅已修复 | 2026-05-04 |
| 诊断共识表 12 列 vs PRD 3 列 | 🔴P0 | ✅已修复 | 2026-05-04 |

### 已修复问题（P1）

| # | 问题 | 优先级 | 状态 | 修复日期 |
|---|------|--------|------|----------|
| 1 | 429 限流处理缺失 | 🟡P1 | ✅已修复 | 2026-05-04 |
| 2 | 共识链持久化集成待确认 | 🟡P1 | ✅已确认 | 2026-05-04 |

**修复说明**：
- **429 限流**：在 `feishuClient.js` 添加 `_withRateLimitRetry` 包装器，支持指数退避重试（最多 3 次），读取 `x-ogw-ratelimit-reset` 响应头
- **持久化集成**：`SessionManager` 已在 `server.js` 中集成，共识链变更时自动保存，会话创建时自动恢复

**注意**: 所有 P0 和 P1 问题已修复完成，可进行演练。

---

## 一、PRD 与实现对比

### 1.1 诊断共识表设计偏差 ✅ 已修复

| 对比项 | PRD 4.4 定义 | 当前实现 | 偏差程度 |
|-------|-------------|---------|---------|
| 表名 | 「诊断共识」表 | 诊断共识表 | ✅ 一致 |
| 列数 | **3 列** | **12 列（内部）** | ⚠️ 已提供客户视图方法 |
| 列名 | 发现内容、确认时间、建议方向 | 记录ID、时间戳、类型、阶段、内容、来源、关联SKU、状态、置信度、替代记录、被替代、建议方向 | ⚠️ 已提供转换函数 |
| 用途 | **客户视图**（干净专业） | **内部调试视图**（暴露所有字段） | ⚠️ 已提供客户视图 API |

**修复方案**（已实施）：
- 保留当前 12 字段表作为内部存储
- 新增 `toCustomerView()` / `toCustomerViewBatch()` 转换函数（fields.js）
- 新增 `listConsensusRecordsForCustomer()` 方法（feishuClient.js）
- 客户投屏场景使用新方法，只显示 3 列：发现内容、确认时间、建议方向

### 1.2 客户档案表字段对比 ✅ 已修复

| PRD 定义 | 当前实现 | 状态 |
|---------|---------|------|
| 9 静态字段 | 9 静态字段 | ✅ 一致 |
| 2 动态字段（当前追问、诊断进度） | 2 动态字段 | ✅ 一致 |
| - | ~~完整度~~（已移除飞书字段） | ✅ 正确 |

**修复说明**：
- 移除了飞书字段"完整度"的映射，因为完整度应**实时计算**而非存储
- **双模式切换功能正常**：`calcCompleteness()` 实时计算 8 个字段的填充率
- PRD 6.2 节的完整度判断逻辑在 `battleCardGen.js:184` 实现，不受影响

---

## 二、表格结构概览

### 2.1 诊断共识表 (tblfZDyYjK)
**环境变量**: `FEISHU_BITABLE_CONSENSUS_TABLE_ID`

| # | 飞书字段名 | field_id | 类型 | 代码字段 | PRD 可见性 |
|---|-----------|----------|------|---------|-----------|
| 1 | 记录ID | fldt1SGX6u | 1(文本) | `id` | ❌ 内部 |
| 2 | 时间戳 | fldLbkq9WL | 1(文本) | `timestamp` | → 确认时间 |
| 3 | 类型 | fldFHZB1nv | 3(单选) | `type` | ❌ 内部 |
| 4 | 阶段 | fld5nagQ3S | 3(单选) | `stage` | ❌ 内部 |
| 5 | 内容 | fldt3G5vcE | 1(文本) | `content` | → 发现内容 |
| 6 | 来源 | fldz0rHGbl | 1(文本) | `source` | ❌ 内部 |
| 7 | 关联SKU | fld7weLW44 | 1(文本) | `evidence_sku` | ❌ 内部 |
| 8 | 状态 | fldFVZKCPs | 3(单选) | `status` | ❌ 内部 |
| 9 | 置信度 | fld0lg3Pej | 3(单选) | `confidence` | ❌ 内部 |
| 10 | 替代记录 | fldk0C1onN | 1(文本) | `replaces` | ❌ 内部 |
| 11 | 被替代 | fldfbPEPjE | 1(文本) | `superseded_by` | ❌ 内部 |
| 12 | 建议方向 | fldXfkJp5p | 1(文本) | `recommendation` | ✅ 客户可见 |

### 2.2 客户档案表 (tbli9vrIAMgLfbvP)
**环境变量**: `FEISHU_BITABLE_PROFILE_TABLE_ID`

| # | 飞书字段名 | field_id | 类型 | 代码字段 | PRD 可见性 |
|---|-----------|----------|------|---------|-----------|
| 1 | ID | fldNbOHV2L | 1005(自动编号) | - | ❌ 内部 |
| 2 | 客户公司名 | fldSMirg0Q | 1(文本) | `客户公司名` | ✅ 客户可见 |
| 3 | 产品线 | fldcpGsA0i | 1(文本) | `产品线` | ✅ 客户可见 |
| 4 | 客户群体 | fldgbcctGn | 1(文本) | `客户群体` | ✅ 客户可见 |
| 5 | 收入结构 | fldRsdz5k7 | 1(文本) | `收入结构` | ✅ 客户可见 |
| 6 | 毛利结构 | fldqdZ29m2 | 1(文本) | `毛利结构` | ✅ 客户可见 |
| 7 | 交付情况 | fldFd96pt1 | 1(文本) | `交付情况` | ✅ 客户可见 |
| 8 | 资源分布 | fld6ZJQ69C | 1(文本) | `资源分布` | ✅ 客户可见 |
| 9 | 战略目标 | fld7HElqu6 | 1(文本) | `战略目标` | ✅ 客户可见 |
| 10 | 显性诉求 | flddrDkmYx | 1(文本) | `显性诉求` | ✅ 客户可见 |
| 11 | 当前追问 | fldbU5arYa | 1(文本) | `当前追问` | ✅ 客户可见 |
| 12 | 诊断进度 | fldSCl5WAg | 2(数字) | `诊断进度` | ✅ 客户可见 |
| 13 | 完整度 | fldh9UIUjB | 20(进度条) | `完整度` | ⚠️ PRD 未定义 |

---

## 三、字段映射详细分析

### 3.1 类型字段映射 (type)

```
代码 → 飞书                    飞书 → 代码
─────────────────────────────────────────────────
fact      →  事实              事实      →  fact
consensus →  共识              共识      →  consensus
case      →  案例 ⚠️ PRD未定义  案例      →  case
insight   →  洞察 ⚠️ PRD未定义  洞察      →  insight
```

**问题**: PRD 4.3 节定义 `type` 只有 `fact` 和 `consensus` 两个值，`case` 和 `insight` 是额外扩展

### 3.2 状态字段映射 (status) ⚠️ P0

```
代码 → 飞书                         飞书 → 代码
──────────────────────────────────────────────────────
recorded            →  待确认        待确认 → pending_client_confirm
pending_client_confirm → 待确认 ❌   已确认 → confirmed
confirmed           →  已确认        已过时 → superseded
active              →  已确认 ⚠️ PRD未定义
superseded          →  已过时
```

**问题**:
1. `recorded` 和 `pending_client_confirm` 都映射到"待确认"，反向不可逆
2. `active` 状态 PRD 未定义
3. 反向映射丢失 `recorded` 状态语义

---

## 四、完整度计算 ✅ 已统一

### 4.1 统一字段配置模块

所有完整度计算现已统一使用 `src/config/fields.js` 中的 `calcCompleteness()` 函数：

| 位置 | 使用方式 | 字段数量 |
|-----|---------|---------|
| `fields.js:123-137` | `calcCompleteness()` 定义 | **9 字段** |
| `memoGenerator.js:277` | 调用 `calcCompleteness()` | ✅ 统一 |
| `battleCardGen.js:210` | 调用 `calcCompleteness()` | ✅ 统一 |
| `server.js` | 调用 `getCompletenessFieldNames()` | ✅ 统一 |

### 4.2 完整度计算字段（PRD 6.2 节：9 个字段）

```
产品线、客户群体、收入结构、毛利结构、交付情况、资源分布、显性诉求、隐性痛点、战略目标
```

**注意**: "客户公司名"用于筛选，不计入完整度。

### 4.3 阈值逻辑（PRD 6.2 节）

- 完整度 >= 60% → 验证假设版
- 完整度 < 60% → 信息建立版

---

## 五、其他问题

### 5.1 recommendation 写入校验缺失 (P1)

**问题**: `types.js:30` 注释说"仅 consensus 类型有"，但代码未强制校验

**风险**: `type=fact` 的记录如果携带 `recommendation`，会写入飞书"建议方向"列，客户看到会困惑

**修复建议**: `_recordToFields` 写入前，如果 `type !== 'consensus'`，强制清空 recommendation

### 5.2 429 限流处理缺失 (P1)

**问题**:
- `@larksuiteoapi/node-sdk` 是否原生支持 429 重试未验证
- 代码中没有读取 `x-ogw-ratelimit-reset` 响应头的逻辑
- 高频写入场景可能触发限流导致数据丢失

**修复建议**: 在 `feishuClient.js` 写入方法中添加 429 拦截和重试逻辑

### 5.3 富文本多段拼接 (P2)

**当前代码**:
```javascript
// feishuClient.js:580-581
if (Array.isArray(value) && value[0]?.text) {
  profile[name] = value[0].text;  // 只取第一个
}
```

**问题**: 飞书富文本可能返回多段，只取第一段会丢失后续内容

**修复建议**:
```javascript
profile[name] = value.map(v => v.text || '').join('');
```

---

## 六、已正确实现的功能 ✅

### 6.1 修正记录 stage 保护

```javascript
// consensusChain.js:146
stage: original.stage,  // ✅ 使用原记录的 stage
```

### 6.2 候选缓存失效监听

```javascript
// consensusChain.js:165-166
this.emit('invalidate-cache', { reason: 'record_corrected', originalId: recordId });

// candidateGen.js:129-132
this.consensusChain.on('invalidate-cache', () => {
  this.invalidateCache();
});
```

---

## 七、修复计划

### Phase 1: P0 问题 ✅ 已全部完成

| # | 问题 | 修复方案 | 状态 | 修复日期 |
|---|------|---------|------|----------|
| 1 | 诊断共识表设计偏差 | 新增客户视图转换函数和 API 方法 | ✅已完成 | 2026-05-04 |
| 2 | 状态映射多对一 | 飞书侧扩展到 4 个状态选项，建立 1:1 映射 | ✅已完成 | 2026-05-04 |
| 3 | 完整度计算不一致 | 创建 `src/config/fields.js` 统一字段列表 | ✅已完成 | 2026-05-04 |
| 4 | 完整度字段冗余 | 移除飞书字段映射，改为实时计算 | ✅已完成 | 2026-05-04 |

### Phase 2: P1 问题 ✅ 已全部完成

| # | 问题 | 修复方案 | 工时 | 状态 |
|---|------|---------|------|------|
| 5 | 类型字段多余值 | 移除 case/insight 映射，添加读取防御 | 1h | ✅已完成 |
| 6 | recommendation 校验 | 写入前检查 type，非 consensus 清空 | 0.5h | ✅已完成 |
| 7 | 429 限流处理 | 添加 `_withRateLimitRetry` 包装器，指数退避重试 | 1.5h | ✅已完成 |
| 8 | 持久化集成确认 | SessionManager 已集成，变更自动保存 | 1h | ✅已确认 |

### Phase 3: P2 问题 ✅ 已完成

| # | 问题 | 修复方案 | 工时 | 状态 |
|---|------|---------|------|------|
| 9 | 富文本多段拼接 | 改为拼接所有 text 段 | 0.5h | ✅已完成 |

---

## 八、统一字段映射模块

已创建 `src/config/fields.js`，包含：

- `COMPLETENESS_FIELDS` - 完整度计算字段（9 个，PRD 6.2 节）
- `PROFILE_FIELDS` - 客户档案字段（10 静态 + 2 动态 = 12 个）
- `CONSENSUS_TYPE_MAP` - 类型双向映射（fact/consensus）
- `CONSENSUS_STATUS_MAP` - 状态双向映射（4 个状态，1:1 映射）
- `CONSENSUS_FIELDS` - 诊断共识表字段列表（12 列，含 internal 标记）
- `CUSTOMER_VIEW_FIELDS` - 客户视图字段（3 列，PRD 4.4 节）
- `calcCompleteness()` - 完整度计算函数
- `toCustomerView()` - 单条记录转换为客户视图
- `toCustomerViewBatch()` - 批量转换为客户视图
- `filterCustomerFields()` - 过滤客户可见字段
- `typeToFeishu()` / `typeToCode()` - 类型转换
- `statusToFeishu()` / `statusToCode()` - 状态转换
- `isValidType()` - 类型校验

向后兼容模块 `src/utils/fieldMapping.js` 保留，从 fields.js 重新导出。

---

**报告完成**。所有 P0、P1、P2 问题已全部修复，可进行演练。
