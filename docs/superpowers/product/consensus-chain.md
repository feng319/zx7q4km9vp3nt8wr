# 共识链记录设计

> **来源**: 设计文档第 4 节
> **最后更新**: 2026-05-05

---

## 4.1 记录触发:D策略

**核心判断**:共识链是会后备忘录的唯一数据源,它的完整性直接决定备忘录能不能当天发给客户。

### 共识链记录的两类内容

**第一类:事实确认**(客户产品线5条、主要客户群是工商业、收入80%来自EPC)
- 特征:散落在会议全程、随时出现、没有固定时机
- 记录方式:顾问手动`/记`为主

**第二类:判断确认**(客户认可"产品线过于分散是核心问题"、客户选择了"聚焦储能主航道"的候选方向)
- 特征:有明确的确认时刻、通常在候选选中之后、是成交的直接依据
- 记录方式:候选选中自动进入

### 修改已记录内容的处理

- 对已记录条目的修改不覆盖原记录
- 新增一条`source=manual_correction`、`replaces=cc_xxx`的记录
- 原记录保留但标记为`superseded`
- 备忘录生成时能追溯"这条判断是被修正过的"

---

## 4.2 三条记录路径

### 路径一:候选选中自动进入(最高优先级)

- 顾问用数字键选中某个候选方案时,该候选**立即自动写入共识链**
- 状态标记为`pending_client_confirm`(待客户确认)
- 同时做三件事:
  1. 共识链新增一条`type=consensus`的记录
  2. 飞书多维表格对应字段实时更新
  3. 四栏状态板的"待确认假设"区出现这条判断
- 顾问之后敲`/确认`,状态从`pending_client_confirm`变为`confirmed`

### 路径二:顾问手动`/记`补充(中优先级)

- 格式:`/记 <任意自然语言>`
- 系统自动判断`type`(包含"客户认可"/"我们决定"等词的判定为`consensus`,其余默认为`fact`)
- **Type判断失败时的兜底**:系统在侧边栏绿色闪动后,在共识链区域用灰色小字追加一行"这条记录被归类为fact,如需改为consensus请敲`/改类`"
- 响应:侧边栏共识链区域**闪一下绿色**(0.3秒)表示已记录
- 快捷键绑定:`Ctrl+Enter`(或`Cmd+Enter`)

### 路径三:AI提示"建议记录X"(最低优先级)

- **不弹确认窗口,只在备弹区角落显示一行灰色小字**
- 旁边有一个`+`按钮,顾问需要时点一下,不需要时忽略
- **只在以下条件同时满足时才启动**:
  1. 会议已进行20分钟以上
  2. 过去5分钟内共识链没有新增任何记录
  3. 对话中出现了明显的"客户陈述事实"模式

---

## 4.3 共识链数据结构

```javascript
{
  "id": "cc_001",
  "timestamp": "14:23:05",
  "type": "fact" | "consensus",
  "stage": "战略梳理" | "商业模式" | "行业演示",
  "content": "客户产品线5条:工商业储能/户用光伏/VPP/EPC/设备",
  "source": "manual" | "candidate_selected" | "ai_suggested" | "manual_correction",
  "evidence_sku": ["sku_037", "sku_012"],  // 仅consensus类有
  "status": "recorded" | "pending_client_confirm" | "confirmed" | "superseded",
  "confidence": "high" | "medium" | "low",  // 仅ai_suggested有
  "replaces": "cc_xxx",  // 仅manual_correction有
  "superseded_by": "cc_xxx",  // 被替代时填入
  "feishu_record_id": "rec_xxx"  // 飞书多维表格对应记录ID
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `source` | 记录这条共识是怎么来的。备忘录生成时,`source=candidate_selected`的条目优先级最高 |
| `status` | 区分"已记录"和"已确认"。备忘录的"诊断结论"章节只用`status=confirmed`的条目 |
| `confidence` | 仅`source=ai_suggested`的记录有此字段。`confidence=low`的AI建议记录不进入备忘录正文,只进入附录 |
| `feishu_record_id` | 飞书同步的锚点 |

### 阶段(stage)字段赋值逻辑

- 阶段切换由顾问手动触发,敲`/切 商业模式`或`/切 行业演示`
- 系统不自动判断阶段切换
- 当前阶段保存在会话状态中
- 每条共识链记录写入时,自动从当前阶段读取

---

## 4.4 飞书侧显示设计

### 两张数据表

**第一张"客户档案"**:9字段client_profile,会议中实时填充,客户可以直接修改

**第二张"诊断共识"**:
- 每条`status=confirmed`的共识链记录显示为一行
- 列名:"发现内容"、"确认时间"、"建议方向"
- `status=pending`的记录**不显示给客户**
- "建议方向"列数据来源:`type=consensus`的记录有`recommendation`字段

**隐藏机制**:客户看到的飞书表格里只有"我们已经达成共识的内容",干净、专业、有说服力。

---

## 4.5 备忘录自动生成的映射逻辑

| 共识链内容 | 备忘录章节 |
|---|---|
| `type=fact` + `status=confirmed` | 二、关键发现 |
| `type=consensus` + `status=confirmed` + `source=candidate_selected` | 三、初步建议方向(标注"系统生成") |
| `type=consensus` + `status=confirmed` + `source=manual` | 三、初步建议方向(标注"顾问判断") |
| `type=consensus` + `status=pending_client_confirm` | 四、需要进一步访谈的内容 |
| `type=fact` + `source=ai_suggested` + `status=recorded` + `confidence=high/medium` | 四、需要进一步访谈的内容(标注"待核实") |
| `type=fact` + `source=ai_suggested` + `confidence=low` | 附录(不进正文) |
| client_profile的"显性诉求"字段 | 一、问题重构(原始诉求) |
| 共识链中最早的`type=consensus` + `status=confirmed` | 一、问题重构(诊断后核心问题) |

**关键原则**:这个映射是备忘录生成器的核心逻辑,不需要LLM做任何"创作",只是把结构化数据填入模板。
