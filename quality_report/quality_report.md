---

## 总览对比

| 指标 | 商业模式资本 | 战略分析 | 新能源 |
|------|------------|---------|--------|
| SKUs | 960 | 175 | 364 |
| Chunks | 58 | 7 | 27 |
| Chunk 覆盖率 | 100.0% | 100.0% | 100.0% |
| Spec 大小 | 13482 chars | 6087 chars | 12295 chars |
| 剩余锚点 | 0 | 0 | 0 |
| Spec SKU 引用 | 104 | 52 | 105 |
| Eureka Chunk 引用 | 42 | 3 | 22 |
| Phase 1 确认 | NO | NO | NO |
| README 质量 | NO | YES | YES |

# 知识库质量分析报告

分析时间: 2026-05-01


---
## 商业模式资本

### Stage 3: SKU 分布

| 分类 | 数量 | 平均大小 | 最小 | 最大 |
|------|------|---------|------|------|
| factual | 616 | 957B | 140B | 7641B |
| procedural | 344 | 0B | 0B | 0B |
| relational | 0 | 0B | 0B | 0B |
| **总计** | **960** | | | |

### Stage 3: Chunk 覆盖率

- 总 chunks: 58
- 有 SKU 映射: 58
- 空映射: 0
- 覆盖率: **100.0%** [PASS]

### Stage 3: Eureka.md

- 大小: 16728 chars
- Chunk 引用: 131 total, 42 unique
- 章节数: 141
- 前缀漂移: 0 [PASS]
### Stage 3: SKU 重复检测

- 总 SKU: 962
- 重复名称: 4 [FAIL]
- 重复 ID: 0 [FAIL]
- 空名称: 0
- 空描述: 0

### Stage 3/4: Mapping.md

- 大小: 49322 chars
- 章节数: 25
- SKU 条目: 944

### Stage 3/4: README.md

- 大小: 2197 chars
- 残留锚点提及: 0 [PASS]
- [chunk:] 协议链路: 有 [PASS]
- 引用类型正确（两类）: 是 [PASS]
- ⚠ 统计不一致:
  - 事实型: README=0, 实际=616
  - 程序型: README=0, 实际=344
- **结论: FAIL**

### Stage 4: Spec.md

- 大小: 13482 chars
- 章节结构: H1=1, H2=3, H3=5
- 剩余锚点: 0 (unique: 0) [PASS]
- Chunk 引用: 51 (unique: 39)
- SKU 引用: 143 (unique: 104)
- SKU 覆盖率: 10.8% (spec引用 / ontology总SKU)

#### Spec 污染检查

| 检查项 | 结果 | 数量 |
|--------|------|------|
| Fix 1/2: [chunk: xxx]] extra closing bracket | PASS | 0 |
| Fix 2/6: 【锚点：[chunk: ...]...】 compound anchor | PASS | 0 |
| Fix 2/6: 【锚点：skus/...】 compound anchor | PASS | 0 |
| Fix 3: SKU-SKU zero-width concatenation | PASS | 0 |
| Fix 3: SKU-chunk zero-width concatenation | PASS | 0 |
| Fix 3: chunk-SKU zero-width concatenation | PASS | 0 |
| Fix 4: space-separated SKU refs on same line | PASS | 0 |
| Fix 5: sku_xxx-yyy unexpanded range | PASS | 0 |
| Extra: 【chunk: xxx】 Chinese bracket residue | PASS | 0 |
| Extra: 【skus/...】 Chinese bracket residue | PASS | 0 |
| Extra: SKU ref followed by 、(should be newline-separated) | PASS | 0 |
| Info: remaining unresolved anchors | PASS | 0 |

- **结论: PASS**

### Stage 4: Chat Log

- 开始时间: 2026-04-30T23:19:24
- 轮次: 5/5
- 用户确认: False
- 消息数: 14 (user=6, assistant=7)

---
## 战略分析

### Stage 3: SKU 分布

| 分类 | 数量 | 平均大小 | 最小 | 最大 |
|------|------|---------|------|------|
| factual | 129 | 597B | 124B | 2696B |
| procedural | 46 | 0B | 0B | 0B |
| relational | 0 | 0B | 0B | 0B |
| **总计** | **175** | | | |

### Stage 3: Chunk 覆盖率

- 总 chunks: 7
- 有 SKU 映射: 7
- 空映射: 0
- 覆盖率: **100.0%** [PASS]

### Stage 3: Eureka.md

- 大小: 1781 chars
- Chunk 引用: 14 total, 3 unique
- 章节数: 14
- 前缀漂移: 0 [PASS]
### Stage 3: SKU 重复检测

- 总 SKU: 177
- 重复名称: 0 [PASS]
- 重复 ID: 0 [PASS]
- 空名称: 0
- 空描述: 0

### Stage 3/4: Mapping.md

- 大小: 9125 chars
- 章节数: 21
- SKU 条目: 175

### Stage 3/4: README.md

- 大小: 2146 chars
- 残留锚点提及: 0 [PASS]
- [chunk:] 协议链路: 有 [PASS]
- 引用类型正确（两类）: 是 [PASS]
- 统计一致性: [PASS]
- **结论: PASS**

### Stage 4: Spec.md

- 大小: 6087 chars
- 章节结构: H1=1, H2=6, H3=13
- 剩余锚点: 0 (unique: 0) [PASS]
- Chunk 引用: 12 (unique: 2)
- SKU 引用: 55 (unique: 52)
- SKU 覆盖率: 29.7% (spec引用 / ontology总SKU)

#### Spec 污染检查

| 检查项 | 结果 | 数量 |
|--------|------|------|
| Fix 1/2: [chunk: xxx]] extra closing bracket | PASS | 0 |
| Fix 2/6: 【锚点：[chunk: ...]...】 compound anchor | PASS | 0 |
| Fix 2/6: 【锚点：skus/...】 compound anchor | PASS | 0 |
| Fix 3: SKU-SKU zero-width concatenation | PASS | 0 |
| Fix 3: SKU-chunk zero-width concatenation | PASS | 0 |
| Fix 3: chunk-SKU zero-width concatenation | PASS | 0 |
| Fix 4: space-separated SKU refs on same line | PASS | 0 |
| Fix 5: sku_xxx-yyy unexpanded range | PASS | 0 |
| Extra: 【chunk: xxx】 Chinese bracket residue | PASS | 0 |
| Extra: 【skus/...】 Chinese bracket residue | PASS | 0 |
| Extra: SKU ref followed by 、(should be newline-separated) | PASS | 0 |
| Info: remaining unresolved anchors | PASS | 0 |

- **结论: PASS**

### Stage 4: Chat Log

- 开始时间: 2026-04-30T22:48:24
- 轮次: 0/5
- 用户确认: False
- 消息数: 0 (user=0, assistant=0)

---
## 新能源

### Stage 3: SKU 分布

| 分类 | 数量 | 平均大小 | 最小 | 最大 |
|------|------|---------|------|------|
| factual | 271 | 653B | 146B | 2255B |
| procedural | 93 | 0B | 0B | 0B |
| relational | 0 | 0B | 0B | 0B |
| **总计** | **364** | | | |

### Stage 3: Chunk 覆盖率

- 总 chunks: 27
- 有 SKU 映射: 27
- 空映射: 0
- 覆盖率: **100.0%** [PASS]

### Stage 3: Eureka.md

- 大小: 9512 chars
- Chunk 引用: 33 total, 22 unique
- 章节数: 33
- 前缀漂移: 0 [PASS]
### Stage 3: SKU 重复检测

- 总 SKU: 366
- 重复名称: 0 [PASS]
- 重复 ID: 0 [PASS]
- 空名称: 0
- 空描述: 0

### Stage 3/4: Mapping.md

- 大小: 24026 chars
- 章节数: 18
- SKU 条目: 364

### Stage 3/4: README.md

- 大小: 2251 chars
- 残留锚点提及: 0 [PASS]
- [chunk:] 协议链路: 有 [PASS]
- 引用类型正确（两类）: 是 [PASS]
- 统计一致性: [PASS]
- **结论: PASS**

### Stage 4: Spec.md

- 大小: 12295 chars
- 章节结构: H1=1, H2=5, H3=5
- 剩余锚点: 0 (unique: 0) [PASS]
- Chunk 引用: 25 (unique: 21)
- SKU 引用: 122 (unique: 105)
- SKU 覆盖率: 28.8% (spec引用 / ontology总SKU)

#### Spec 污染检查

| 检查项 | 结果 | 数量 |
|--------|------|------|
| Fix 1/2: [chunk: xxx]] extra closing bracket | PASS | 0 |
| Fix 2/6: 【锚点：[chunk: ...]...】 compound anchor | PASS | 0 |
| Fix 2/6: 【锚点：skus/...】 compound anchor | PASS | 0 |
| Fix 3: SKU-SKU zero-width concatenation | PASS | 0 |
| Fix 3: SKU-chunk zero-width concatenation | PASS | 0 |
| Fix 3: chunk-SKU zero-width concatenation | PASS | 0 |
| Fix 4: space-separated SKU refs on same line | PASS | 0 |
| Fix 5: sku_xxx-yyy unexpanded range | PASS | 0 |
| Extra: 【chunk: xxx】 Chinese bracket residue | PASS | 0 |
| Extra: 【skus/...】 Chinese bracket residue | PASS | 0 |
| Extra: SKU ref followed by 、(should be newline-separated) | PASS | 0 |
| Info: remaining unresolved anchors | PASS | 0 |

- **结论: PASS**

### Stage 4: Chat Log

- 开始时间: 2026-05-01T08:21:09
- 轮次: 5/5
- 用户确认: False
- 消息数: 14 (user=6, assistant=7)
