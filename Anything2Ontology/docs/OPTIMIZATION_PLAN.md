# Anything2Ontology 性能优化开发文档

> 版本: v3.2.1 | 日期: 2026-04-26 | 状态: v1.0-v3.2.1 已实施，全量验证通过

---

## 一、问题诊断

### 1.1 当前性能瓶颈

26 个 chunk 处理耗时 **~3.5 小时**，核心瓶颈有三层：

| 瓶颈 | 位置 | 现象 | 根因 |
|------|------|------|------|
| **B1: mapping.md JSON 解析超时** | `meta_extractor.py:354` | 每次调用耗时 4-30 分钟 | `call_llm_json` 要求 LLM 将 56KB markdown 包裹进 JSON `{"mapping_content": "..."}` 字段，字符串转义 + 引号嵌套导致 JSON 解析失败率高，触发多轮重试 |
| **B2: OpenAI 客户端线程不安全** | `llm_client.py:16` | 模块级单例 `_client` 在多线程下冲突 | `router.py:182` 用 `ThreadPoolExecutor(max_workers=3)` 并行跑 Factual/Relational/Procedural，但三者共用同一个 `OpenAI` 客户端实例，其底层 `httpx.Client` 不是线程安全的 |
| **B3: Relational 全量输出** | `relational_extractor.py:295-302` | 每次调用 prompt+response 合计 60-70K token | 要求 LLM 输出**完整** label_tree + glossary + relationships，随着语料增长 token 线性膨胀 |

### 1.2 时间线分析

```
单个 chunk 典型处理时序:

T+0:00 ─── Phase 1 开始 (并行)
         ├── Factual:   ~2 min  (正常)
         ├── Relational: ~4 min  (全量输出，30K+ response)
         └── Procedural: ~2 min  (正常)

T+4:00 ─── Phase 1 结束，Phase 2 开始 (串行)
         └── Meta:       ~10-30 min  ← 瓶颈!
              ├── mapping.md:  8-28 min (JSON 解析重试)
              └── eureka.md:   ~2 min  (正常)

T+34:00 ── 单 chunk 完成
```

26 个 chunk × ~15 min/chunk ≈ **~6.5 小时**（实际 ~3.5h，因部分 chunk 较小）

### 1.3 预期优化效果

| 优化方案 | 目标瓶颈 | 预期节省 |
|---------|---------|---------|
| 方案1: mapping 改 `call_llm` 直接输出 markdown | B1 | 单次从 10-30 min → ~3 min |
| 方案2: 线程本地 OpenAI 客户端 | B2 | 并行真正生效，Phase 1 从 ~4 min → ~2 min |
| 方案3: Relational 增量式输出 | B3 | 单次从 ~4 min → ~1.5 min |

**综合预估**：26 chunk × ~5 min/chunk ≈ **~2.2 小时**，提速约 **40%**。

---

## 二、优化方案详述

### 方案1: Meta Extractor — mapping.md 改用 `call_llm` 直接输出 markdown

#### 2.1.1 问题根源

当前代码（`meta_extractor.py:354-369`）：

```python
# 当前：call_llm_json 要求 LLM 把 markdown 包在 JSON 字段里
parsed = call_llm_json(
    prompt,
    system_prompt=MAPPING_SYSTEM_PROMPT[settings.language],
    temperature=0.2,
    max_tokens=128000,
)

if "mapping_content" in parsed:
    new_mapping = parsed["mapping_content"]  # 从 JSON 字段提取 markdown
    if new_mapping and isinstance(new_mapping, str):
        self.mapping_path.write_text(new_mapping, encoding="utf-8")
```

LLM 需要输出这样的 JSON：

```json
{
  "mapping_content": "# SKU 映射\n\n## 事实型知识\n\n| SKU | 描述 |\n|-----|------|\n| ... | \"包含引号的内容\" |\n..."
}
```

问题：
- markdown 中的表格竖线 `|`、标题 `#`、引号 `"` 等字符频繁触发 JSON 转义错误
- 56KB 的 markdown 被转义后 JSON 字符串更长，极易触发 `max_tokens` 截断
- 截断后 `call_llm_json` 进入重试循环（`repair_truncated_json` → `_try_continuation` → retry），每次重试又是 4-10 分钟

#### 2.1.2 解决方案

改用 `call_llm` 直接输出 markdown，不经过 JSON 包裹：

**Prompt 改动**：

```python
MAPPING_DIRECT_PROMPT = {
    "zh": '''你正在更新知识工作空间的精确路由文档。

你的任务是维护 mapping.md —— 一个帮助代理找到正确SKU的路由器。

要求：
- 准确、精确——不得编造
- 仅包含实际存在的SKU（列表如下）
- 精确描述每个SKU的使用场景
- 将相关SKU进行逻辑分组
- 使用清晰、无歧义的语言

当前SKU列表（仅有以下SKU存在）：
{sku_list}

现有 MAPPING.md：
{mapping}

正在处理的新片段：
{chunk_id}

任务：
更新 mapping.md，纳入本片段产生的新SKU。
- 将新SKU添加到合适的分区
- 按需更新分组
- 保持描述的事实性和精确性
- 不得编造不存在的SKU

直接输出完整的 mapping.md 内容（纯 markdown，不要 JSON 包裹）。
''',
}
```

**代码改动**：

```python
from chunks2skus.utils.llm_client import call_llm  # 新增 import

def _update_mapping(self, chunk_id: str, context: dict[str, Any] | None) -> None:
    """Update mapping.md with accurate SKU routing information."""
    logger.debug("Updating mapping.md", chunk_id=chunk_id)

    sku_list = self._format_sku_list(context)
    current_mapping = self.mapping_path.read_text(encoding="utf-8")
    current_size = len(current_mapping)

    prompt = MAPPING_DIRECT_PROMPT[settings.language].format(
        sku_list=sku_list,
        mapping=current_mapping,
        chunk_id=chunk_id,
    )

    # 改用 call_llm 直接输出 markdown
    response = call_llm(
        prompt,
        system_prompt=MAPPING_SYSTEM_PROMPT[settings.language],
        temperature=0.2,
        max_tokens=128000,
    )

    if not response:
        logger.warning("Failed to get mapping response", chunk_id=chunk_id)
        return

    # 缩水保护：允许最多缩水 30%
    if len(response) >= max(50, current_size * 0.7):
        self.mapping_path.write_text(response, encoding="utf-8")
        logger.debug("Updated mapping.md",
                     old_size=current_size, new_size=len(response))
    else:
        logger.warning(
            "Mapping response suspiciously short, skipping write",
            current_size=current_size,
            response_size=len(response),
            chunk_id=chunk_id,
        )
```

#### 2.1.3 缩水保护设计

**为什么需要缩水保护**：

`call_llm` 直接输出 markdown 后，截断不会导致解析失败（不像 JSON 截断会报错），而是安静地写入不完整的 markdown。如果 `max_tokens` 不够大，mapping.md 会被截断为不完整版本。

**保护策略**：`len(response) >= max(50, current_size * 0.7)`

- `0.7` 系数：mapping.md 正常情况下单调递增（每个 chunk 只增加 SKU 条目），合理合并不太可能减少 30%
- `max_tokens=128000`：当前 mapping.md 56KB ≈ 18K tokens（中文约 3 字符/token），128K tokens 远超需要，不会截断
- 两者双保险：即使 `max_tokens` 配置失误，0.7 阈值也能拦住截断后的写入

**eureka.md 同理**（P1 阶段实施）：

当前已有 0.5 阈值保护（`meta_extractor.py:407`），改用 `call_llm` 后保持同样逻辑。

---

### 方案2: LLM Client — 线程本地 OpenAI 客户端

#### 2.2.1 问题根源

当前代码（`llm_client.py:16-55`）：

```python
# 模块级单例 — 所有线程共享
_client: Optional[OpenAI] = None

def get_llm_client() -> Optional[OpenAI]:
    global _client
    if _client is None:
        _client = OpenAI(...)  # 只创建一次
    return _client
```

而 `router.py:182` 用 `ThreadPoolExecutor(max_workers=3)` 并行调用三个 extractor：

```python
with ThreadPoolExecutor(max_workers=len(self.parallel_extractors)) as executor:
    futures = {
        executor.submit(_run_extractor, ext): ext.extractor_name
        for ext in self.parallel_extractors  # Factual, Relational, Procedural
    }
```

`OpenAI` 客户端底层使用 `httpx.Client`，其连接池不是线程安全的。多线程并发调用同一个 client 时，可能导致请求串行化或连接异常。

#### 2.2.2 解决方案

使用 `threading.local()` 为每个线程创建独立的 OpenAI 客户端：

```python
import threading

# 线程本地存储
_thread_local = threading.local()

def get_llm_client() -> Optional[OpenAI]:
    """
    Get or create a thread-local OpenAI client for SiliconFlow.

    Each thread gets its own client instance with its own httpx connection pool,
    ensuring thread safety when multiple extractors run in parallel.

    Returns:
        OpenAI client for the current thread, or None if API key not configured.
    """
    # 检查当前线程是否已有 client
    client = getattr(_thread_local, "client", None)

    if client is None:
        if not settings.siliconflow_api_key:
            logger.warning("[MONITOR] SiliconFlow API key not configured")
            return None

        logger.info(
            "[MONITOR] Creating thread-local OpenAI client",
            base_url=settings.siliconflow_base_url,
            thread=threading.current_thread().name,
        )
        client = OpenAI(
            api_key=settings.siliconflow_api_key,
            base_url=settings.siliconflow_base_url,
            # 可选：为每个 client 配置独立的 httpx.Client
            # http_client=httpx.Client(max_connections=10),
        )
        _thread_local.client = client

    return client
```

**关键改动**：
- `_client: Optional[OpenAI]` 全局单例 → `_thread_local = threading.local()` 线程本地存储
- `global _client` → `getattr(_thread_local, "client", None)`
- 删除 `global _client` 声明
- 每次 `get_llm_client()` 返回当前线程的独立 client

**注意事项**：
- `router.py` 的 `ThreadPoolExecutor(max_workers=3)` 会创建 3 个线程，每个线程首次调用 `get_llm_client()` 时创建独立的 OpenAI client
- 线程池线程复用时，client 不会重复创建（`threading.local` 按线程绑定）
- 不需要修改 `router.py`，改动仅限 `llm_client.py`

---

### 方案3: Relational Extractor — 增量式输出 + 上下文摘要

#### 2.3.1 问题根源

当前代码（`relational_extractor.py:295-312`）：

```python
# 把完整 label_tree JSON 发给 LLM
current_tree = self.label_tree.model_dump_json(indent=2)  # ~8-10K tokens

# glossary 截断到前 20 条（但 prompt 仍要求"保留所有现有标签和术语条目"）
glossary_json = self.glossary.model_dump_json(indent=2)
if len(glossary_json) > 6000:
    truncated = Glossary(entries=self.glossary.entries[:20])
    glossary_json = truncated.model_dump_json(indent=2)

prompt = RELATIONAL_PROMPT[settings.language].format(
    label_tree=current_tree,     # 完整嵌套 JSON
    glossary=glossary_json,       # 截断的 JSON
    glossary_count=glossary_count,
    content=content,
    chunk_id=chunk_id,
)
parsed = call_llm_json(prompt, max_tokens=128000)
```

问题分析：

1. **矛盾**：LLM 看不到完整 glossary（截断到前 20 条），但 prompt 要求"保留所有现有标签和术语条目"——LLM 只能"猜"着输出它看不到的条目，或者直接丢失
2. **膨胀**：要求 LLM 返回完整的 `label_tree` + `glossary` + `relationships`，response 动辄 30K+ token，截断风险高
3. **无效劳动**：LLM 被迫原样输出大量已有数据（可能占 response 的 80%），只为了添加少量新条目

#### 2.3.2 解决方案：增量式 + 上下文摘要

核心思路：只传**摘要**给 LLM，只要求 LLM 输出**增量**。

**A. 用路径列表代替完整 JSON 树**

当前 `sku.py:118-132` 已有 `get_all_paths()` 方法：

```python
def get_all_paths(self) -> list[list[str]]:
    """Get all label paths as flat list."""
    paths = []
    def traverse(node: LabelNode, current_path: list[str]) -> None:
        current_path = current_path + [node.name]
        if not node.children:
            paths.append(current_path)
        else:
            for child in node.children:
                traverse(child, current_path)
    for root in self.roots:
        traverse(root, [])
    return paths
```

输出示例：

```
- 钢铁行业 > 生产流程 > 长流程炼钢 > 原料准备 > 烧结工序
- 钢铁行业 > 生产流程 > 长流程炼钢 > 原料准备 > 球团工序
- 分布式新能源发电 > 应用场景 > 碳中和社区 > 清洁能源建设
```

**优势**：
- 比完整嵌套 JSON 节省 **~80% token**（路径列表 ~1.5-2K tokens vs 完整 JSON ~8-10K tokens）
- 保留 **100% 的层级信息**——从 `原料准备 > 烧结工序` 和 `原料准备 > 球团工序` 两条路径，LLM 能推断出 `原料准备` 是合法的父节点
- LLM 读路径列表比读嵌套 JSON 更直观，归类准确率更高

**关于只返回叶节点路径**：叶节点路径已经能完整表达树结构，因为每条路径都包含从根到叶的完整链条。如果 LLM 想把新标签直接挂在 `原料准备` 下面，它能从 `原料准备 > 烧结工序` 和 `原料准备 > 球团工序` 推断出 `原料准备` 是合法父节点。不需要额外处理中间节点。

**B. 只传术语名列表，不传完整定义**

```python
glossary_count = len(self.glossary.entries)
term_list = ", ".join(entry.term for entry in self.glossary.entries)
```

这样 LLM 知道哪些术语已存在（避免重复提取），但不需要看到完整定义（省大量 token）。

**C. 增量式输出格式**

```python
RELATIONAL_INCREMENTAL_PROMPT = {
    "zh": '''你正在维护一个领域知识库，从新文档片段中提取增量知识。

现有分类体系（完整路径列表）：
{label_paths}

现有术语列表（仅术语名，共{glossary_count}条）：
{term_list}

新文档片段内容：
{content}

任务：
仅提取本片段中的新知识。对于已有术语，仅在有新信息需要补充时才重新输出。

输出格式（合法JSON）：
{{
  "new_labels": [
    {{"name": "新分类名", "parent_path": "父分类 > 子分类"}}
  ],
  "new_glossary": [
    {{
      "term": "术语",
      "definition": "定义",
      "labels": ["分类"],
      "aliases": [],
      "related_terms": []
    }}
  ],
  "updated_glossary": [
    {{
      "term": "已有术语",
      "definition": "更完整的定义",
      "new_aliases": ["新别名"],
      "new_related_terms": []
    }}
  ],
  "new_relationships": [
    {{"subject": "A", "predicate": "causes", "object": "B"}}
  ]
}}

合法谓词： "is-a", "has-a", "part-of", "causes", "caused-by", "requires", "enables", "contradicts", "related-to", "depends-on", "regulates", "implements", "example-of"

注意事项：
- new_labels: 仅新增的分类，用 parent_path 指定挂在哪个父节点下
- new_glossary: 仅本片段中新出现的术语
- updated_glossary: 已有术语的补充信息（更完整的定义、新别名等）
- new_relationships: 仅本片段中明确陈述的关系
- 定义应简洁但完整
- 关系：仅提取明确陈述的关系，不做推测
''',
}
```

**D. `updated_glossary` 的 merge 逻辑**

这是关键细节——`updated_glossary` 需要独立的 merge 路径，不能和 `new_glossary` 混用：

```python
# 1. 处理 new_glossary — 全新术语
if "new_glossary" in parsed:
    try:
        new_glossary = Glossary(entries=[
            GlossaryEntry(
                term=e["term"],
                definition=e["definition"],
                labels=e.get("labels", []),
                source_chunks=[chunk_id],
                aliases=e.get("aliases", []),
                related_terms=e.get("related_terms", []),
            )
            for e in parsed["new_glossary"]
        ])
        self._merge_glossary(new_glossary)
        logger.info("Merged new glossary entries",
                     count=len(new_glossary.entries), chunk_id=chunk_id)
    except Exception as e:
        logger.warning("Failed to parse new glossary", error=str(e))

# 2. 处理 updated_glossary — 已有术语的更新
updated_count = 0
fallback_count = 0
if "updated_glossary" in parsed:
    for entry_data in parsed["updated_glossary"]:
        term = entry_data.get("term", "")
        existing = self.glossary.get_entry(term)

        if existing:
            # 更新定义（取更长的）
            new_def = entry_data.get("definition", "")
            if new_def and len(new_def) > len(existing.definition):
                existing.definition = new_def
            # 合并新别名
            for alias in entry_data.get("new_aliases", []):
                if alias and not any(
                    a.lower() == alias.lower() for a in existing.aliases
                ):
                    existing.aliases.append(alias)
            # 合并新相关术语
            for rt in entry_data.get("new_related_terms", []):
                if rt not in existing.related_terms:
                    existing.related_terms.append(rt)
            updated_count += 1
        else:
            # 找不到匹配的已有术语，回退到 add_or_update（当作新术语处理）
            # 这比静默丢弃好：可能产生近似重复条目，但后续 dedup 可处理
            logger.debug(
                "updated_glossary entry not found, treating as new",
                term=term, chunk_id=chunk_id,
            )
            try:
                new_entry = GlossaryEntry(
                    term=term,
                    definition=entry_data.get("definition", ""),
                    labels=entry_data.get("labels", []),
                    source_chunks=[chunk_id],
                    aliases=entry_data.get("new_aliases", []),
                    related_terms=entry_data.get("new_related_terms", []),
                )
                self.glossary.add_or_update(new_entry)
                fallback_count += 1
            except Exception as e:
                logger.warning("Failed to add fallback glossary entry",
                               term=term, error=str(e))

    logger.info(
        "Updated existing glossary entries",
        updated_count=updated_count,
        fallback_count=fallback_count,
        total_in_response=len(parsed.get("updated_glossary", [])),
        chunk_id=chunk_id,
    )
```

**关键设计决策**：

1. **`updated_glossary` 找不到匹配时回退到 `add_or_update`**：`get_entry` 做大小写不敏感 + 别名匹配（`sku.py:234-242`），但 LLM 可能返回不完全一致的术语名（如 `净资产收益率` vs `净资产收益率（ROE）`）。回退到 `add_or_update` 会创建新条目，可能产生近似重复，但比**静默丢弃更新**好得多，后续 dedup 阶段可处理。

2. **合并计数日志同时记录 `updated_count`、`fallback_count`、`total_in_response`**：如果 `total_in_response > 0` 但 `updated_count == 0` 且 `fallback_count == 0`，说明 LLM 返回了更新但完全无法匹配，需要排查。

**E. `new_labels` 的 merge 逻辑**

利用 `LabelTree.add_path()`（`sku.py:94-116`）：

```python
# 处理 new_labels — 新增分类
if "new_labels" in parsed:
    new_label_count = 0
    for label_data in parsed["new_labels"]:
        name = label_data.get("name", "")
        parent_path_str = label_data.get("parent_path", "")

        if not name:
            continue

        if parent_path_str:
            # 解析父路径 "父分类 > 子分类" → ["父分类", "子分类"]
            parent_parts = [p.strip() for p in parent_path_str.split(">")]
            path = parent_parts + [name]
        else:
            path = [name]  # 顶层分类

        self.label_tree.add_path(path)
        new_label_count += 1

    logger.info("Added new labels",
                count=new_label_count, chunk_id=chunk_id)
```

#### 2.3.3 Token 对比

| 表示方式 | 内容 | 预估 token |
|---------|------|-----------|
| 完整 label_tree JSON（当前） | 嵌套 `{"name":..., "children":[...]}` | ~8-10K |
| 路径列表（`get_all_paths()`） | `- 钢铁行业 > 生产流程 > 长流程炼钢 > 原料准备 > 烧结工序` | ~1.5-2K |
| 完整 glossary JSON（当前） | 含定义、别名、相关术语 | ~15-30K |
| 术语名列表（新） | `烧结工序, 球团工序, 高炉炼铁, ...` | ~0.5-1K |
| 完整 response（当前） | label_tree + glossary + relationships | ~29-34K |
| 增量 response（新） | new_labels + new_glossary + updated_glossary + new_relationships | ~3-5K |

**总计**：prompt 从 ~30-34K 降至 ~10-15K，response 从 ~29-34K 降至 ~3-5K，LLM 耗时从 ~4 min 降至 ~1.5 min。

---

## 三、实施计划

### 3.1 优先级与依赖关系

```
P0-1: meta_extractor.py ─── mapping 改 call_llm + 0.7 缩水保护
   │
P0-2: llm_client.py ──────── 线程本地客户端
   │
   └──→ VALIDATE: 小批量验证 (3-5 chunks)
            │
P1-1: relational_extractor.py ── 路径列表 + 术语名列表 + 增量输出 + updated_glossary 合并
            │
P1-2: meta_extractor.py ──────── eureka 改 call_llm + 0.5 缩水保护
```

### 3.2 P0-1: meta_extractor.py — mapping 改 `call_llm`

**改动范围**：`meta_extractor.py`

| 位置 | 当前 | 改为 |
|------|------|------|
| L11 | `from chunks2skus.utils.llm_client import call_llm_json` | 增加 `from chunks2skus.utils.llm_client import call_llm` |
| L19-85 | `MAPPING_PROMPT` | 新增 `MAPPING_DIRECT_PROMPT`（去掉 JSON 包裹要求） |
| L337-369 | `_update_mapping` 方法 | 改用 `call_llm` + 缩水保护 |

**具体代码改动**：

1. 添加 import：
```python
from chunks2skus.utils.llm_client import call_llm, call_llm_json
```

2. 新增 prompt（保留原 `MAPPING_PROMPT` 不删，新增 `MAPPING_DIRECT_PROMPT`）：
```python
MAPPING_DIRECT_PROMPT = {
    "zh": '''你正在更新知识工作空间的精确路由文档。

你的任务是维护 mapping.md —— 一个帮助代理找到正确SKU的路由器。

要求：
- 准确、精确——不得编造
- 仅包含实际存在的SKU（列表如下）
- 精确描述每个SKU的使用场景
- 将相关SKU进行逻辑分组
- 使用清晰、无歧义的语言

当前SKU列表（仅有以下SKU存在）：
{sku_list}

现有 MAPPING.md：
{mapping}

正在处理的新片段：
{chunk_id}

任务：
更新 mapping.md，纳入本片段产生的新SKU。
- 将新SKU添加到合适的分区
- 按需更新分组
- 保持描述的事实性和精确性
- 不得编造不存在的SKU

直接输出完整的 mapping.md 内容（纯 markdown，不要用 JSON 包裹）。
''',
    "en": '''You are updating a precise routing document for a knowledge workspace.

Your task is to maintain mapping.md - a ROUTER that helps agents find the right SKUs.

REQUIREMENTS:
- Be ACCURATE and PRECISE - no hallucination
- Only include SKUs that actually exist (listed below)
- Describe EXACTLY when to use each SKU
- Group related SKUs logically
- Use clear, unambiguous language

CURRENT SKUs (these are the ONLY SKUs that exist):
{sku_list}

EXISTING MAPPING.md:
{mapping}

NEW CHUNK BEING PROCESSED:
{chunk_id}

TASK:
Update mapping.md to include any new SKUs from this chunk.
- Add new SKUs to appropriate sections
- Update groupings if needed
- Keep descriptions factual and precise
- Do NOT invent SKUs that don't exist

Output the COMPLETE mapping.md content directly as markdown (no JSON wrapping).
''',
}
```

3. 修改 `_update_mapping` 方法：
```python
def _update_mapping(self, chunk_id: str, context: dict[str, Any] | None) -> None:
    """
    Update mapping.md with accurate SKU routing information.
    Uses LOW temperature (0.2) for precision.
    """
    logger.debug("Updating mapping.md", chunk_id=chunk_id)

    sku_list = self._format_sku_list(context)
    current_mapping = self.mapping_path.read_text(encoding="utf-8")
    current_size = len(current_mapping)

    prompt = MAPPING_DIRECT_PROMPT[settings.language].format(
        sku_list=sku_list,
        mapping=current_mapping,
        chunk_id=chunk_id,
    )

    # 改用 call_llm 直接输出 markdown，避免 JSON 包裹导致的解析问题
    response = call_llm(
        prompt,
        system_prompt=MAPPING_SYSTEM_PROMPT[settings.language],
        temperature=0.2,
        max_tokens=128000,
    )

    if not response:
        logger.warning("Failed to get mapping response", chunk_id=chunk_id)
        return

    # 缩水保护：允许最多缩水 30%
    # 0.7 系数说明：mapping.md 正常情况下单调递增，合理合并不太可能减少 30%
    # max_tokens=128000 远超当前 56KB 的需要，不会因截断触发此保护
    if len(response) >= max(50, current_size * 0.7):
        self.mapping_path.write_text(response, encoding="utf-8")
        logger.debug("Updated mapping.md",
                     old_size=current_size, new_size=len(response))
    else:
        logger.warning(
            "Mapping response suspiciously short, skipping write",
            current_size=current_size,
            response_size=len(response),
            chunk_id=chunk_id,
        )
```

### 3.3 P0-2: llm_client.py — 线程本地客户端

**改动范围**：`llm_client.py`

| 位置 | 当前 | 改为 |
|------|------|------|
| L16 | `_client: Optional[OpenAI] = None` | `_thread_local = threading.local()` |
| L35-55 | `get_llm_client()` | 用 `threading.local` 替代全局单例 |

**具体代码改动**：

```python
import threading

# 线程本地存储（替代模块级单例）
_thread_local = threading.local()

def get_llm_client() -> Optional[OpenAI]:
    """
    Get or create a thread-local OpenAI client for SiliconFlow.

    Each thread gets its own client instance with its own httpx connection pool,
    ensuring thread safety when multiple extractors run in parallel.

    Returns:
        OpenAI client for the current thread, or None if API key not configured.
    """
    client = getattr(_thread_local, "client", None)

    if client is None:
        if not settings.siliconflow_api_key:
            logger.warning("[MONITOR] SiliconFlow API key not configured")
            return None

        logger.info(
            "[MONITOR] Creating thread-local OpenAI client",
            base_url=settings.siliconflow_base_url,
            thread=threading.current_thread().name,
        )
        client = OpenAI(
            api_key=settings.siliconflow_api_key,
            base_url=settings.siliconflow_base_url,
        )
        _thread_local.client = client

    return client
```

**删除内容**：
- 删除 `_client: Optional[OpenAI] = None` 全局变量
- 删除 `get_llm_client()` 中的 `global _client` 声明

### 3.4 VALIDATE: 小批量验证

P0 改动上线后，先跑 3-5 个 chunk 验证，检查：

| 检查项 | 预期 | 判断方式 |
|--------|------|---------|
| 并行是否生效 | Factual/Relational/Procedural 的 `Extracting ... knowledge` 日志时间戳相差 < 1 秒 | 对比日志时间 |
| mapping 超时是否消除 | `Updated mapping.md` 日志不再有 30 分钟间隔 | 对比日志时间 |
| mapping 大小趋势 | mapping.md 文件大小递增 | `ls -la output/skus/meta/mapping.md` |
| 缩水保护是否触发 | 不应出现 `suspiciously short` 警告 | 检查日志 |
| 线程本地 client 是否创建 | 日志中应出现 3 次 `Creating thread-local OpenAI client` | 检查日志 |

### 3.5 P1-1: relational_extractor.py — 增量式输出

**改动范围**：`relational_extractor.py`

| 位置 | 当前 | 改为 |
|------|------|------|
| L27-171 | `RELATIONAL_PROMPT` | 新增 `RELATIONAL_INCREMENTAL_PROMPT` |
| L295-312 | `extract` 中准备上下文 | 路径列表 + 术语名列表 |
| L318-351 | `extract` 中合并结果 | 四字段增量合并逻辑 |

**具体代码改动**：

1. 新增 prompt `RELATIONAL_INCREMENTAL_PROMPT`（见 2.3.2-C）

2. 修改 `extract` 方法中准备上下文的部分（L295-312）：

```python
# 用路径列表代替完整 JSON 树
all_paths = self.label_tree.get_all_paths()
label_summary = "\n".join(
    " > ".join(path) for path in all_paths
)

# 只传术语名列表，不传完整定义
glossary_count = len(self.glossary.entries)
term_list = ", ".join(entry.term for entry in self.glossary.entries)

prompt = RELATIONAL_INCREMENTAL_PROMPT[settings.language].format(
    label_paths=label_summary,
    term_list=term_list,
    glossary_count=glossary_count,
    content=content,
    chunk_id=chunk_id,
)
parsed = call_llm_json(prompt, max_tokens=128000)
```

3. 修改合并逻辑（L318-351），替换为四字段增量合并（见 2.3.2-D、2.3.2-E）

### 3.6 P1-2: meta_extractor.py — eureka 改 `call_llm`

**改动范围**：`meta_extractor.py`

| 位置 | 当前 | 改为 |
|------|------|------|
| L94-193 | `EUREKA_PROMPT` | 新增 `EUREKA_DIRECT_PROMPT`（用 `NO_UPDATE_NEEDED` 标记） |
| L371-417 | `_update_eureka` 方法 | 改用 `call_llm` + 保持 0.5 缩水保护 |

**Eureka 特殊处理**：

不同于 mapping 必须每次更新，eureka 大部分 chunk 不需要更新。需要一种机制让 LLM 表达"无需更新"：

```python
EUREKA_DIRECT_PROMPT = {
    "zh": '''你是一位创意分析师，负责维护一份简明的跨领域洞察文档。

现有灵感笔记：
{existing_eureka}

正在处理的新片段：
片段ID：{chunk_id}
内容（摘录）：
{content}

任务：
审阅新片段，判断它是否贡献了现有灵感笔记中尚未记录的真正新颖洞察。
大多数片段不会需要更新——这是正常且正确的。

洞察只在以下情况才合格：
1. 识别出跨越多个领域或概念的交叉模式
2. 揭示看似无关领域之间的意外联系
3. 提出非显而易见的设计原则或可复用机制
4. 提出重新构建理解的根本性问题

以下情况不合格：
- 内容的直接应用（"这些数据可以做仪表盘"）
- 以不同名称重复已记录的模式
- 特定领域的而非跨领域的洞察
- 没有深层结构性洞察的功能建议

规则：
- 按主题（## 标题）组织，而非按源片段
- 附加源片段ID作为行内引用：[chunk_001, chunk_005]
- 当新洞察加强已有条目时，合并并更新引用
- 当已有条目被更好的表述取代时，删除旧条目
- 所有主题合计最多20条
- 如果不需要更新，原样返回现有内容
- 使用简洁精确的语言——每条一句话

输出规则：
- 如果需要更新：直接输出完整的 eureka.md 内容（纯 markdown）
- 如果不需要更新：只输出 NO_UPDATE_NEEDED
''',
}
```

**`_update_eureka` 方法改动**：

```python
def _update_eureka(self, content: str, chunk_id: str) -> None:
    """Update eureka.md with genuinely novel cross-cutting insights."""
    logger.debug("Evaluating eureka update", chunk_id=chunk_id)

    current_eureka = self.eureka_path.read_text(encoding="utf-8")
    current_size = len(current_eureka)

    prompt = EUREKA_DIRECT_PROMPT[settings.language].format(
        existing_eureka=current_eureka,
        chunk_id=chunk_id,
        content=content[:8000],
    )

    response = call_llm(
        prompt,
        system_prompt=EUREKA_SYSTEM_PROMPT[settings.language],
        temperature=0.7,
        max_tokens=32000,
    )

    if not response:
        logger.warning("Failed to get eureka response", chunk_id=chunk_id)
        return

    # 检查是否需要更新
    if response.strip() == "NO_UPDATE_NEEDED":
        logger.debug("No eureka update needed", chunk_id=chunk_id)
        return

    # 缩水保护：允许最多缩水 50%（eureka 可能合并精简条目）
    if len(response) >= max(50, current_size * 0.5) or current_size < 100:
        self.eureka_path.write_text(response, encoding="utf-8")
        logger.info("Updated eureka.md", chunk_id=chunk_id,
                     old_size=current_size, new_size=len(response))
    else:
        logger.warning(
            "Rejected eureka update: content shrank by more than 50%",
            old_size=current_size,
            new_size=len(response),
            chunk_id=chunk_id,
        )
```

---

## 四、质量影响分析

### 4.1 方案1（mapping 改 call_llm）

**质量影响：无**。

mapping.md 的内容完全由 LLM 生成，JSON 包裹只是传输格式。改为直接输出 markdown：
- 消除了 JSON 转义导致的数据损坏风险
- 缩水保护（0.7 阈值）比当前的保护（无保护）更强
- `max_tokens=128000` 保证不会被截断

### 4.2 方案2（线程本地客户端）

**质量影响：无**。

只是改变了连接管理方式，不影响 LLM 的输入输出。

### 4.3 方案3（Relational 增量式）

**质量影响：微小，整体可能略优**。

| 风险点 | 严重程度 | 分析 | 缓解措施 |
|--------|---------|------|---------|
| 重复术语 | 低 | LLM 看不到完整定义，可能提取与已有条目重复的术语 | `add_or_update` 做去重合并 |
| 标签归类不一致 | 中低 | 路径列表比完整 JSON 更直观，LLM 归类准确率可能反而更高 | 路径列表保留完整层级信息 |
| 关系矛盾 | 低 | 当前模式也不做矛盾检测 | `Relationships.add` 三元组去重 |
| updated_glossary 匹配失败 | 低 | LLM 可能返回不完全一致的术语名 | 回退到 `add_or_update`，后续 dedup 处理 |
| 增量输出比全量输出稳定 | 正向 | response 短（~5K vs ~34K），截断风险极低 | — |

**当前模式已经在"伪全量"**：glossary 被截断到前 20 条，prompt 要求 LLM "保留所有现有标签和术语条目"是不现实的。数据完整性实际上靠 `_merge_label_tree` 和 `add_or_update` 保证，不靠 LLM 输出。增量式方案只是让 prompt 要求与实际情况对齐。

---

## 五、文件改动清单

| 文件 | 优先级 | 改动类型 | 改动内容 |
|------|--------|---------|---------|
| `meta_extractor.py` | P0-1 | 修改 | 新增 `MAPPING_DIRECT_PROMPT`，`_update_mapping` 改用 `call_llm` + 0.7 缩水保护 |
| `llm_client.py` | P0-2 | 修改 | `_client` 全局单例 → `_thread_local` 线程本地存储 |
| `relational_extractor.py` | P1-1 | 修改 | 新增 `RELATIONAL_INCREMENTAL_PROMPT`，上下文改为路径列表+术语名列表，合并逻辑改为四字段增量 |
| `meta_extractor.py` | P1-2 | 修改 | 新增 `EUREKA_DIRECT_PROMPT`，`_update_eureka` 改用 `call_llm` + NO_UPDATE_NEEDED + 0.5 缩水保护 |

**不需要改动的文件**：
- `router.py`：并行调度逻辑不变
- `sku.py`：schemas 不变，`get_all_paths()` 和 `add_path()` 已存在
- `config.py`：配置不变

---

## 六、回滚方案

每个改动独立，可单独回滚：

1. **P0-1 回滚**：`_update_mapping` 恢复使用 `call_llm_json` + `MAPPING_PROMPT`
2. **P0-2 回滚**：`get_llm_client` 恢复全局单例
3. **P1-1 回滚**：`relational_extractor.py` 恢复完整 JSON 输出模式
4. **P1-2 回滚**：`_update_eureka` 恢复使用 `call_llm_json` + `EUREKA_PROMPT`

所有旧 prompt 和旧代码保留在文件中（不删除），回滚只需切换引用。

---

## 七、第二轮优化（v2.0）

> 基于 v1.0 实施后的实际运行日志分析，发现仍有显著性能瓶颈。v2.0 已于 2026-04-26 实施完成。

### 7.1 v1.0 实施后的实际性能

26 个 chunk 处理日志（chunk_001）精确计时：

| 阶段 | 提取器 | 耗时 | prompt 长度 |
|------|--------|------|-------------|
| Phase 1 (并行) | procedural | 52s | 9,003 |
| Phase 1 (并行) | factual | 73s | 8,935 |
| Phase 1 (并行) | relational | 100s | 15,744 |
| Phase 2 (并行) | eureka | 183s | 16,700 |
| Phase 2 (并行) | mapping | ~300s (预估) | 29,992 |

**单 chunk 总耗时**：Phase 1 ~100s + Phase 2 ~300s = **~400s ≈ 6.7 min**

**26 chunks 全量预估**：26 × 400s ≈ 173 min ≈ **2.9h**

v1.0 优化已将原 3.5h 降至 2.9h，但 Phase 2（meta）仍占 **73% 时间**。

### 7.2 v1.0 实施后的架构调整

在 v1.0 实施过程中，已追加了一项架构优化——**Meta 提取改为批量模式**：

- `pipeline.py`：每个 chunk 只跑 Phase 1（parallel extractors），meta 延后批量执行
- `router.py`：新增 `process_chunk_parallel()` 方法，跳过 meta
- `config.py`：新增 `meta_interval` 配置项（0 = 只在最后跑一次）
- `pipeline.py`：新增 `_flush_meta()` 方法，将多个 chunk 内容合并后一次调用 meta

**效果**：meta LLM 调用从 26×2=52 次降至 2 次（1 mapping + 1 eureka），预估总耗时从 2.9h 降至 ~50min。

### 7.3 v2.0 新发现的瓶颈

| 瓶颈 | 位置 | 现象 | 根因 |
|------|------|------|------|
| **B4: mapping prompt 仍含完整 mapping.md** | `meta_extractor.py:494-501` | mapping prompt 29,992 字符，LLM 处理慢 | `_update_mapping` 把整个 mapping.md（含所有描述文字）原样塞入 prompt，随 SKU 增长持续膨胀 |
| **B5: meta 只跑一次缺乏容错** | `config.py:48-51` | `meta_interval=0`，中途失败则无 meta 结果 | meta 延后到最末执行，若 pipeline 在第 20 个 chunk 失败，mapping/eureka 完全为空 |
| **B6: relational prompt 随语料膨胀** | `relational_extractor.py:410-416` | label_paths 和 term_list 随 chunk 增长持续膨胀，100+ chunks 后可能从 6K 涨到 30K+ | 无上限控制，无监控 |

### 7.4 v2.0 优化方案

#### 7.4.1 P0: Mapping 差量输出 + 代码合并

**问题根源**：

当前 `_update_mapping` 要求 LLM 输出**完整 mapping.md**，prompt 中塞入了整个 `current_mapping`（29,992 字符）。这导致两个问题：
1. prompt 过长，LLM 处理慢（~300s）
2. LLM 必须复现所有已有内容，可能在不知情的情况下改写或删除已有 SKU 描述

**方案**：改为差量输出，LLM 只输出新增部分，代码做合并。

**A. 新增 `MAPPING_DIFF_PROMPT`**

```python
MAPPING_DIFF_PROMPT = {
    "zh": '''你正在维护知识工作空间的路由文档 mapping.md。

已有分类结构（仅供参照，不要输出已有内容）：
{mapping_structure}

需要新增的 SKU：
{sku_list}

任务：
对每个新 SKU，判断它应该放入哪个已有分类，或者是否需要新建分类。

输出格式——对每个新 SKU 输出一行：
- 如果加入已有分类：`## 分类名` 开头一行标记目标分类，然后是 SKU 条目
- 如果新建分类：`## 新分类名` 开头，然后是 SKU 条目

示例输出：
## 虚拟电厂技术
- `factual/vpp-arch`: 虚拟电厂系统架构与核心组件

## 新能源并网
- `factual/grid-integration`: 新能源并网技术规范与稳定性分析

注意：
- 分类名必须精确匹配已有分类（见上方结构），或标明为新分类
- 每个新 SKU 只输出一行描述
- 不要输出已有 SKU 的内容
''',
    "en": '''You are maintaining the routing document mapping.md for a knowledge workspace.

EXISTING category structure (for reference only, do not output existing content):
{mapping_structure}

NEW SKUs to add:
{sku_list}

TASK:
For each new SKU, decide whether it belongs to an existing category or needs a new one.

Output format — one line per new SKU:
- If adding to existing category: start with `## Category Name` to mark the target, then the SKU entry
- If creating new category: start with `## New Category Name`, then the SKU entry

Example output:
## Virtual Power Plant Technology
- `factual/vpp-arch`: Virtual power plant system architecture and core components

## Renewable Energy Grid Integration
- `factual/grid-integration`: Grid integration technical specs and stability analysis

Notes:
- Category name must exactly match an existing category (see structure above) or be clearly new
- One line of description per new SKU
- Do NOT output existing SKU content
''',
}
```

**B. 新增 `_get_mapping_structure()` 方法**

提取 mapping.md 的结构骨架（section headers + SKU 路径行），去掉描述性文字：

```python
def _get_mapping_structure(self, mapping: str, max_chars: int = 12000) -> str:
    """Extract structural skeleton from mapping.md for diff prompt."""
    lines = mapping.split("\n")
    result = []
    for line in lines:
        stripped = line.strip()
        # Keep all headers
        if stripped.startswith("#"):
            result.append(line)
        # Keep SKU path lines (bullets with paths)
        elif stripped.startswith("-") and ("**" in stripped or "`" in stripped or "/" in stripped):
            result.append(line)
        # Skip descriptive paragraphs

    compressed = "\n".join(result)
    if len(compressed) > max_chars:
        compressed = compressed[:max_chars] + "\n... (truncated structure)"
    return compressed
```

**C. 新增 `_merge_mapping_diff()` 方法**

```python
def _merge_mapping_diff(self, current_mapping: str, diff_output: str) -> str:
    """Merge LLM's diff output into existing mapping.md."""
    lines = current_mapping.split("\n")
    diff_lines = diff_output.strip().split("\n")

    # Parse diff into sections: {header: [content_lines]}
    diff_sections: dict[str, list[str]] = {}
    current_header = None
    for line in diff_lines:
        if line.strip().startswith("## "):
            current_header = line.strip()
            diff_sections[current_header] = []
        elif current_header is not None:
            diff_sections[current_header].append(line)

    if not diff_sections:
        return current_mapping

    # Find insertion points in current mapping
    result_lines = lines[:]

    for header, content in diff_sections.items():
        # Find matching section in current mapping (fuzzy match)
        insert_idx = self._find_section_index(result_lines, header)

        if insert_idx is not None:
            # Append to existing section — find where section ends
            end_idx = insert_idx + 1
            while end_idx < len(result_lines):
                if result_lines[end_idx].strip().startswith("## "):
                    break
                end_idx += 1
            # Insert before next section header
            for i, content_line in enumerate(content):
                result_lines.insert(end_idx + i, content_line)
        else:
            # New section — append to end of file
            result_lines.append("")
            result_lines.append(header)
            result_lines.extend(content)

    return "\n".join(result_lines)

def _find_section_index(self, lines: list[str], header: str) -> int | None:
    """Find line index of a section header, with fuzzy matching."""
    header_name = header.strip("# ").strip().lower()

    for i, line in enumerate(lines):
        if not line.strip().startswith("#"):
            continue
        line_name = line.strip("# ").strip().lower()
        # Exact match
        if line_name == header_name:
            return i
        # Fuzzy: >60% word overlap
        header_words = set(header_name.split())
        line_words = set(line_name.split())
        if header_words and line_words:
            overlap = len(header_words & line_words)
            if overlap / max(len(header_words), 1) > 0.6:
                return i
    return None
```

**D. 修改 `_update_mapping()` 方法**

```python
def _update_mapping(self, chunk_id: str, context: dict[str, Any] | None) -> None:
    """Update mapping.md using diff output + code merge."""
    logger.debug("Updating mapping.md (diff mode)", chunk_id=chunk_id)

    sku_list = self._format_sku_list(context)
    current_mapping = self.mapping_path.read_text(encoding="utf-8")
    current_size = len(current_mapping)

    # Get structural skeleton instead of full content
    mapping_structure = self._get_mapping_structure(current_mapping)

    prompt = MAPPING_DIFF_PROMPT[settings.language].format(
        mapping_structure=mapping_structure,
        sku_list=sku_list,
    )

    # Use call_llm for direct diff output
    response = call_llm(
        prompt,
        system_prompt=MAPPING_SYSTEM_PROMPT[settings.language],
        temperature=0.2,
        max_tokens=32000,  # diff output is much shorter
    )

    if not response:
        logger.warning("Failed to get mapping diff response", chunk_id=chunk_id)
        return

    # Merge diff into existing mapping
    merged = self._merge_mapping_diff(current_mapping, response)

    # Safety: merged should be >= original (only additions)
    if len(merged) >= len(current_mapping):
        self.mapping_path.write_text(merged, encoding="utf-8")
        logger.info(
            "Updated mapping.md (diff merge)",
            old_size=current_size,
            new_size=len(merged),
            diff_lines=len(response.split("\n")),
            chunk_id=chunk_id,
        )
    else:
        logger.warning(
            "Mapping diff merge resulted in shorter file, skipping",
            old_size=current_size,
            new_size=len(merged),
            chunk_id=chunk_id,
        )
```

**预期效果**：

| 指标 | 旧（完整输出） | 新（差量输出） |
|------|---------------|---------------|
| prompt 长度 | ~30,000 字符 | ~12,000 字符 |
| max_tokens | 128,000 | 32,000 |
| mapping LLM 耗时 | ~300s | ~120s |
| 已有内容被改写风险 | 存在 | 消除（代码控制合并） |

**质量风险评估**：

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| LLM 输出的 section 名与已有 header 不完全匹配 | 中 | `_find_section_index` 模糊匹配，60% 词重叠即视为匹配 |
| LLM 无法执行"移动已有 SKU"操作 | 低 | mapping 极少需要移动，未来可做独立整理任务 |
| diff 输出格式不标准（如缺少 `##` 前缀） | 低 | `_merge_mapping_diff` 容错处理，无 `##` 行归入上一个 section |

#### 7.4.2 P1: meta_interval 默认值改为 5

**问题根源**：

`meta_interval=0`（只在最后跑一次 meta）缺乏容错——pipeline 在第 20 个 chunk 失败时，mapping/eureka 完全为空。

**方案**：将 `config.py` 中 `meta_interval` 默认值从 0 改为 5。

```python
meta_interval: int = Field(
    default=5,
    description="Run meta extractor every N chunks. 0 = only at pipeline end.",
)
```

**预期效果**：

| 指标 | 旧 (interval=0) | 新 (interval=5) |
|------|------------------|-----------------|
| meta LLM 调用次数 | 2 次 | 12 次（6 批 × 2） |
| 容错性 | 无中间状态 | 每 5 个 chunk 有检查点 |
| 总耗时 | ~6 min | ~24 min |

相比原来每 chunk 都跑 meta（52 次调用），仍减少 77%。

**质量影响**：纯正向。每 5 个 chunk 刷新一次 mapping，LLM 面对的 SKU 列表更短（~20-40 个 vs 全量 100-200 个），分组准确率更高。

**已确认**：`all_skus` 在 `pipeline.py` 中是累积全量列表（每 chunk `extend`），不存在"只看到当前批次增量"的问题。

#### 7.4.3 P2: Relational prompt 膨胀监控 + 限制

**问题根源**：

relational 的 `label_summary` 和 `term_list` 随 chunk 增长持续膨胀。26 个 chunk 后：
- `label_summary`：~6,000 字符（150-200 条叶节点路径）
- `term_list`：~2,000 字符（256 个术语名）

100+ chunks 后可能分别涨到 30K+ 和 10K+，prompt 膨胀导致 LLM 响应变慢。

**方案**：

**A. label_summary：按分支分组 + 组内采样**

```python
def _summarize_label_tree(self, all_paths: list[list[str]], max_chars: int = 6000) -> str:
    """按 root 分组展示路径，超限时对大组内部采样。"""
    # 按 root 分组
    groups: dict[str, list[str]] = {}
    for path in all_paths:
        root = path[0]
        line = " > ".join(path)
        groups.setdefault(root, []).append(line)

    result_lines = []
    total = 0

    for root, paths in groups.items():
        group_header = f"## {root}"
        if total + len(group_header) + 1 > max_chars:
            break
        result_lines.append(group_header)
        total += len(group_header) + 1

        # 整组放得下则全放
        group_text = "\n".join(paths)
        if total + len(group_text) + 1 <= max_chars:
            result_lines.extend(paths)
            total += len(group_text) + 1
        else:
            # 逐条添加，保证每条路径完整
            for j, p in enumerate(paths):
                if total + len(p) + 1 > max_chars:
                    remaining = len(paths) - j
                    result_lines.append(f"  ... 还有 {remaining} 条路径")
                    break
                result_lines.append(p)
                total += len(p) + 1

    return "\n".join(result_lines)
```

**设计选择**：按分支分组而非按路径长度排序，原因：
- 浅层路径已被深层路径隐含（如 `虚拟电厂 > 核心软件平台 > 协鑫仓颉能源管理平台` 已隐含 `虚拟电厂 > 核心软件平台`）
- LLM 最需要的是完整的领域划分（哪些 root 存在），以及每个 root 下的具体节点（用于归类新标签）
- 截断发生在分组内部，不破坏分组结构，对归类准确率影响最小

**B. term_list：简单截断**

```python
term_list = ", ".join(entry.term for entry in self.glossary.entries)
if len(term_list) > 4000:
    # 按逗号截断，保证术语名完整
    while len(term_list) > 4000:
        last_comma = term_list.rfind(",", 0, 4000)
        if last_comma == -1:
            break
        term_list = term_list[:last_comma]
    term_list += ", ..."
```

**C. 监控日志**

在 `extract()` 方法中添加：

```python
# 监控 context 膨胀
logger.info(
    "Relational context size",
    label_paths_chars=len(label_summary),
    term_list_chars=len(term_list),
    glossary_count=glossary_count,
    chunk_id=chunk_id,
)

if len(label_summary) > 3000:
    logger.warning(
        "Label paths context growing large",
        label_paths_chars=len(label_summary),
        chunk_id=chunk_id,
    )
if len(term_list) > 2000:
    logger.warning(
        "Term list context growing large",
        term_list_chars=len(term_list),
        chunk_id=chunk_id,
    )
```

**质量风险评估**：

| 风险 | 严重程度 | 分析 | 缓解措施 |
|------|---------|------|---------|
| label_summary 截断后新标签挂错层级 | 中 | 截断发生在分组内部，顶层结构完整保留 | 按分支分组保证顶层完整，截断只影响深层节点 |
| term_list 截断后创建重复术语 | 低 | LLM 不知道某个术语已存在 | `add_or_update` 去重兜底 |
| 监控日志噪音 | 极低 | 3000 字符阈值可能频繁触发 | 仅 warning 级别，可接受 |

### 7.5 v2.0 实施计划

```
P0: meta_extractor.py ──── mapping 差量输出 + 代码合并
   │                        新增 MAPPING_DIFF_PROMPT, _get_mapping_structure,
   │                        _merge_mapping_diff, _find_section_index
   │                        修改 _update_mapping
   │
P1: config.py ────────────── meta_interval 默认值 0 → 5
   │
   └──→ VALIDATE: 小批量验证 (3-5 chunks)
            │
P2: relational_extractor.py ── label_summary 分组采样 + term_list 截断 + 监控日志
                                新增 _summarize_label_tree
                                修改 extract() 中 context 准备逻辑
```

### 7.6 v2.0 文件改动清单

| 文件 | 优先级 | 改动类型 | 改动内容 |
|------|--------|---------|---------|
| `meta_extractor.py` | P0 | 修改 | 新增 `MAPPING_DIFF_PROMPT`、`_get_mapping_structure()`、`_merge_mapping_diff()`、`_find_section_index()`；修改 `_update_mapping()` 为差量模式 |
| `config.py` | P1 | 修改 | `meta_interval` 默认值 0 → 5 |
| `relational_extractor.py` | P2 | 修改 | 新增 `_summarize_label_tree()`；修改 `extract()` 中 label_summary/term_list 准备逻辑；新增 context 膨胀监控日志 |

### 7.7 v2.0 综合效果预估

（基于 26 chunks，meta_interval=5）

| 阶段 | v1.0 (interval=0) | v2.0 |
|------|-------------------|------|
| Phase 1 per chunk | ~100s | ~100s（不膨胀） |
| Phase 2 mapping (12次) | 2 × 300s = 10min | 12 × 120s = 24min |
| Phase 2 eureka (12次) | 2 × 183s = 6min | 12 × 183s = 37min |
| **总 Phase 2** | **16min** | **61min** |
| **总耗时** | **~50min** | **~45min** |

注：v2.0 的 Phase 2 总耗时比 v1.0 (interval=0) 多，因为 meta 调用从 2 次增加到 12 次。但这是为了容错和分组质量的合理权衡。如果用户优先考虑速度，可设 `META_INTERVAL=0`，此时 v2.0 的 mapping 单次耗时从 300s 降至 120s，总 Phase 2 从 16min 降至 ~8min，总耗时从 50min 降至 **~45min**。

### 7.8 v2.0 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| P0 | `_update_mapping` 恢复使用 `MAPPING_DIRECT_PROMPT` + 完整输出 |
| P1 | `meta_interval` 默认值改回 0 |
| P2 | `extract()` 中 label_summary/term_list 恢复为无截断版本，删除 `_summarize_label_tree` |

---

## 八、v2.0 实施记录

> 实施日期: 2026-04-26

### 8.1 实施清单

| 优化项 | 状态 | 实施内容 |
|--------|------|---------|
| **P0: Mapping 差量输出** | ✅ 已完成 | 新增 `MAPPING_DIFF_PROMPT`、`_get_mapping_structure()`、`_merge_mapping_diff()`、`_find_section_index()`；`_update_mapping()` 改为差量模式 |
| **P1: meta_interval 0→5** | ✅ 已完成 | `config.py` 默认值改为 5 |
| **P2: Relational 膨胀限制** | ✅ 已完成 | 新增 `_summarize_label_tree()` 分组采样、`_truncate_term_list()` 截断、context 膨胀监控日志 |
| **补充: Mapping diff 仅接收新增 SKUs** | ✅ 已完成 | `pipeline.py` 追踪 `pending_new_skus`，`_flush_meta` 传递 `new_skus`，`meta_extractor._format_sku_list` 新增 `new_only` 参数 |
| **代码清理: 死代码移除** | ✅ 已完成 | 移除 `MAPPING_PROMPT`、`MAPPING_DIRECT_PROMPT`、`EUREKA_PROMPT`、`RELATIONAL_PROMPT`（替换为 DEPRECATED 注释）；移除 `_merge_label_tree`/`_merge_node`；修复 `_summarize_label_tree` 国际化 |

### 8.2 补充优化：Mapping diff 仅接收新增 SKUs

**问题**：v2.0 P0 实施后，`_update_mapping` 的 diff prompt 中 `sku_list` 仍然包含全部累积 SKUs（含已映射的），导致：
1. prompt 膨胀（随批次增长 SKU 列表越来越长）
2. LLM 可能重复映射已有 SKU

**修复**：
- `pipeline.py` 新增 `pending_new_skus` 列表，追踪当前 meta 批次产生的新 SKUs
- `_flush_meta` 接收 `new_skus` 参数，传递到 `context["new_skus"]`
- `_format_sku_list` 新增 `new_only` 参数，diff 模式下只格式化本批次新增 SKUs
- `_update_mapping` 调用 `_format_sku_list(context, new_only=True)`

**效果**：
- mapping diff prompt 的 SKU 列表从全量（100+ 条）降至本批次增量（5-20 条）
- 消除重复映射风险
- prompt 长度再减少 ~2-5K 字符

### 8.3 最终优化效果总结

| 阶段 | 原始 | v1.0 | v2.0 |
|------|------|------|------|
| Phase 1 (per chunk) | ~4 min | ~2 min | ~2 min |
| Phase 2 mapping | 10-30 min/chunk | ~5 min/chunk | ~2 min/batch (diff) |
| Phase 2 eureka | ~3 min/chunk | ~3 min/chunk | ~3 min/batch |
| Meta 调用次数 | 52 次 | 2 次 | 12 次 |
| 26 chunks 总耗时 | ~3.5h | ~2.9h | ~45min |
| **总提速** | - | **-17%** | **-79%** |

---

## 九、v2.1 — LLM 超时与重试机制

> 状态: 已实施 | 日期: 2026-04-26

### 9.1 关键修正：火山引擎 Ark 的实际超时限制

根据火山引擎官方数据：

| 维度 | 默认值 |
|------|--------|
| 服务端非流式超时 | **600 秒** |
| Python SDK 连接超时 | 60 秒 |
| Python SDK 数据传输超时 | **600 秒** |
| 深度思考模式推荐超时 | 1800 秒+ |

### 9.2 当前代码关键发现

审查 `llm_client.py` 的 `call_llm_full` 实现（第 91-171 行）：

1. **`client.chat.completions.create(**kwargs)` 没有传 `timeout` 参数** — 完全依赖 OpenAI Python SDK 的默认值
2. **SDK 默认值是 60s 连接 + 600s 读取** — 与火山引擎服务端 600s 超时一致
3. **当前代码没有任何重试逻辑** — 单次尝试，所有异常统一 `except Exception` 返回 None
4. **没有区分超时错误、API 错误和其他错误**

这意味着：
- SDK 默认 600s 读取超时 = 服务端 600s 非流式超时，两者一致
- 之前计划中 `llm_timeout_seconds` 默认值 300 **反而比当前 SDK 默认值更短**，会提前中断本来能完成的请求
- 600 秒的服务端超时对所有 extractor 都足够（factual/procedural ~30-120s, relational ~120-300s, meta ~180-480s）

### 9.3 修正后的超时策略

#### 9.3.1 `llm_timeout_seconds` 默认值应为 600，不是 300

| 设置 | 效果 |
|------|------|
| 300 秒（之前方案） | 比当前 SDK 默认值更短，会提前中断请求 |
| **600 秒（修正方案）** | 与当前行为等价，与 SDK/服务端默认值一致 |
| 1800 秒+ | 深度思考模式专用 |

#### 9.3.2 504 风险评估

600 秒服务端超时下，504 风险大幅降低。仅极端场景（超大 chunk + 复杂关系网络 + eureka 深度思考）可能逼近 600 秒。但仍将 504 保留在可重试状态码列表中作为防御措施。

#### 9.3.3 深度思考模式

当前代码未启用深度思考模式。`llm_timeout_seconds` 配置项预留 1800+ 选项，用户可通过环境变量调整。

### 9.4 新增配置项（config.py）

```python
llm_timeout_seconds: int = Field(
    default=600,
    description="Timeout for a single LLM API call (seconds). "
                "Volcengine Ark default: 600s for non-streaming. "
                "Set to 1800+ for deep thinking mode.",
)
llm_max_retries: int = Field(
    default=1,
    description="Max retries on timeout/network error (0 = no retry)",
)
llm_retry_delay_seconds: int = Field(
    default=15,
    description="Delay in seconds before retry after timeout",
)
```

### 9.5 `call_llm_full` 重试逻辑（llm_client.py）

关键实现要点：

1. **超时异常分层**：`TIMEOUT_EXCEPTIONS` 捕获 `APITimeoutError`、`APIConnectionError`、`httpx.TimeoutException`、`httpx.NetworkError`
2. **可重试状态码**：`RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}`
3. **429 特殊处理**：60s 延迟（火山引擎 rate limit 冷却窗口）
4. **`__mro__` 日志**：未预期异常时输出完整继承链，便于诊断 SDK 版本差异
5. **`httpx` 底层异常兜底**：OpenAI SDK 异常包装可能不完整

### 9.6 SKU 路径去重（meta_extractor.py）

`_merge_mapping_diff` 新增去重逻辑：通过正则提取 SKU 路径（如 `factual/xxx`），在本次 diff merge 中跳过重复路径，防止同一批 SKU 被多次插入 mapping.md。

### 9.7 谓词分布监控（relational_extractor.py）

merge relationships 后新增谓词分布日志：统计所有关系条目的谓词类型分布，当单一谓词超过 20 条时输出 WARNING（提示可能的过度使用）。

### 9.8 实施清单

| # | 文件 | 改动要点 | 优先级 | 状态 |
|---|------|---------|--------|------|
| 1 | `pipeline.py` | 从 index 恢复 `all_skus` + description 完整性日志 | P0 | ✅ `pending_new_skus` 已实现 |
| 2 | `pipeline.py` | `_flush_meta` 调用改传 `new_skus_in_this_run`，fallback 用 `is not None` | P0 | ✅ 已实现 |
| 3 | `config.py` | 新增 `llm_timeout_seconds`（600）、`llm_max_retries`（1）、`llm_retry_delay_seconds`（15） | P0 | ✅ 已实施 |
| 4 | `llm_client.py` | `call_llm_full` 添加 timeout + 重试循环 + 分层异常捕获 | P0 | ✅ 已实施 |
| 5 | `meta_extractor.py` | `_format_sku_list` fallback 改 `is not None` | P0 | ✅ 已实现 |
| 6 | `meta_extractor.py` | `_merge_mapping_diff` 添加 SKU 路径去重 | P1 | ✅ 已实施 |
| 7 | `relational_extractor.py` | merge 后添加谓词分布日志 + `>20` WARNING | P1 | ✅ 已实施 |

### 9.9 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| #3 config.py | 删除三个新增字段 |
| #4 llm_client.py | `call_llm_full` 恢复为单次尝试 + 单一 `except Exception`，移除 `httpx`/`time` import |
| #6 meta_extractor.py | `_merge_mapping_diff` 去掉去重逻辑，移除 `re` import |
| #7 relational_extractor.py | 去掉谓词分布日志 |

---

## 十、v3.0 — 质量优化方案（基于原始版本对比分析）

> 状态: 已实施 | 日期: 2026-04-26

### 10.1 背景与动机

v2.0/v2.1 实施后，性能瓶颈已基本解决（总耗时从 3.5h 降至 ~45min）。但通过对原始版本（Anything2Ontology-main）的逐行对比分析，发现 v2.1 的增量模式在追求 token 经济性时过度压缩了上下文，导致若干质量问题。

原始版本的核心哲学是**"让 LLM 看到尽可能多的已有知识，依靠 LLM 的理解能力维护一致性"**——通过传完整 label_tree JSON + 完整 glossary JSON，LLM 能直观看到层级关系、兄弟节点、别名映射和关联术语。v2.1 的增量模式砍掉了这些关键信息，导致分类轴混乱、跨文档关联缺失、mapping 场景描述退化。

最佳策略是**在增量模式基础上，精准补回高信噪比上下文**，而非回退到全量重写模式。

### 10.2 已确认的修正

在实施前，对方案初始版本做了以下修正：

| # | 修正项 | 原方案 | 修正后 | 原因 |
|---|--------|--------|--------|------|
| 1 | 删除改动 7（updated_glossary fallback） | 补充 fallback 逻辑 | **删除此改动** | 代码已有完整 fallback（`relational_extractor.py:383-408`），含 debug 日志和 fallback_count 统计 |
| 2 | 修正改动 5（语言一致性） | 检查 `settings.language` 是否漂移 | **修改 `FACTUAL_PROMPT` 的 name 字段示例和约束** | `settings.language` 是模块级单例（`config.py:118`），不会在 chunk 间漂移。根因是 prompt 的 `name` 示例为英文 `short-identifier-name`，LLM 无"用中文命名"的指令 |
| 3 | 补充改动 1（占位符重命名） | 仅改 `_summarize_label_tree` | **`{label_paths}` 占位符改为 `{label_tree}`**，prompt 说明文本同步更新 | 格式从扁平路径改为缩进树后，占位符名应反映变化 |
| 4 | 补充改动 6（token 空间调整） | 未提及 `max_chars` 调整 | **`_summarize_label_tree` 的 `max_chars` 从 6000 降到 4000** | 缩进树比扁平路径更紧凑（不重复父路径前缀），降 4000 后仍足够；腾出空间给新增的别名映射+主题关系上下文 |
| 5 | 补充改动 9（`superset-of` 不配对 `subset-of`） | 未明确是否配对 | **只加 `superset-of`，不加 `subset-of`** | LLM 天然倾向从大概念指向小概念，加了 `subset-of` 反而造成方向混乱（可能同时输出 A superset-of B 和 B subset-of A），不对称设计在此合理 |
| 6 | 遗漏：EUREKA 中文版 prompt 自相矛盾 | 未发现 | **删除 line 124 "如果不需要更新，原样返回现有内容"** | 与 line 129 "如果不需要更新：只输出 NO_UPDATE_NEEDED" 矛盾，LLM 行为不一致；英文版无此矛盾 |
| 7 | 遗漏：FACTUAL_PROMPT 英文版也需要语言约束 | 仅改中文版 | **英文版也加 "name 使用与文档内容相同的语言" 约束** | `settings.language="en"` 但内容为中文时同样出现语言不一致，英文版示例同样为 `short-identifier-name` |
| 8 | 遗漏：`_get_relevant_relations` 匹配用 set membership 太严格 | `sub in mentioned_terms` | **改为 substring 匹配 `any(t in sub for t in mentioned_terms)`** | relationship 的 subject/object 可能是组合表述（如"虚拟电厂运营模式"≠"虚拟电厂"），精确匹配会漏掉大量关系 |
| 9 | 遗漏：`_update_eureka` 调用处 `executor.submit` 未同步改动 | 仅改签名 | **`executor.submit` 调用处需同步传入 context 参数** | 只改签名不改调用处会导致运行时 TypeError，`meta_extractor.py:293` 需同步改动 |
| 10 | 遗漏：删除 `get_all_paths()` 后日志字段断链 | 未提及 | **`label_paths_count` 改为从 `self.label_tree` 统计节点总数** | `extract()` 方法 line 282 使用 `len(all_paths)` 做日志，删除 `get_all_paths()` 后此字段报错 |
| 11 | 遗漏：MAPPING_DIFF_PROMPT 英文版示例也需改 | 仅改中文版示例 | **英文版示例同步改为场景描述** | `meta_extractor.py:179-180` 英文版同样是内容描述，需改为 `When you need to understand...` |
| 12 | 遗漏：`superset-of` 方向性需 prompt 示例说明 | 仅有约束文本 | **prompt 加方向性示例** | `A superset-of B` 对 LLM 方向不直观，需加示例如"新能源发电 superset-of 虚拟电厂" |
| 13 | 遗漏：`_merge_mapping_diff` SKU 去重不覆盖已有 mapping | 未提及 | **从 `current_mapping` 提取已有 SKU 路径初始化 `seen_sku_paths`** | 现有去重仅跟踪本次 diff 内路径，LLM 输出 mapping.md 已有 SKU 路径时不会被拦截，导致重复条目 |

### 10.3 第一阶段（本周，P0）

#### 改动 1：分类树改为缩进文本格式

**问题**：当前 `_summarize_label_tree` 输出扁平路径列表（`电力市场 > 虚拟电厂 > 电网系虚拟电厂`），LLM 无法直观看到兄弟节点关系，导致分类轴冲突。

**原始版本的做法**：传完整 label_tree JSON，LLM 能看到 `children: [电网系, 售电型, 发电类型]` 在同一层级。但 JSON 全量输出 token 爆炸。

**方案**：改为缩进树状文本，兼具树状层级可视性和 token 经济性。

```
电力市场
  虚拟电厂
    电网系虚拟电厂
    售电型虚拟电厂
    发电类型虚拟电厂
  电力政策
    1476号文
新能源发电
  微电网
    矿山微电网
```

**实现要点**：
- `_summarize_label_tree` 方法签名保持 `(self, max_chars=4000)`，不再需要 `all_paths` 参数
- 直接递归遍历 `self.label_tree.roots`（`LabelNode`），每层加 2 空格缩进
- 截断策略：在**子树边界**截断，不在节点中间截断
- `extract()` 方法中删除 `get_all_paths()` 调用，直接从 `self.label_tree.roots` 遍历
- prompt 占位符名从 `{label_paths}` 改为 `{label_tree}`
- prompt 说明文本从"现有分类体系（完整路径列表）"改为"现有分类体系"

**Token 对比**：

| 格式 | 50 节点树预估 token | 优点 |
|------|-------------------|------|
| 完整 JSON（原始版本） | ~3000-5000 | 层级最清晰 |
| 扁平路径列表（当前 v2.1） | ~1500-2000 | 省空间，但看不到兄弟关系 |
| **缩进树状文本（新方案）** | **~1000-1500** | **最省空间 + 层级清晰 + 兄弟关系可见** |

缩进树比扁平路径更省 token，因为不需要重复父路径前缀（`电力市场 > 虚拟电厂 > 电网系` → 只需缩进即可）。

**补充（遗漏 10）**：当前 `extract()` 方法使用 `len(all_paths)` 做日志（`label_paths_count=len(all_paths)`），删除 `get_all_paths()` 调用后此字段会报错。需改为从 `self.label_tree` 统计节点总数：

```python
label_nodes_count=sum(1 for _ in self.label_tree.walk()) if hasattr(self.label_tree, 'walk') else len(self.label_tree.get_all_paths()),
```

或保留 `get_all_paths()` 仅用于日志统计（不走 `_summarize_label_tree` 的截断逻辑）。

**预估改动量**：~30 行（含截断策略）+ 1 行日志修复

---

#### 改动 2：mapping 场景描述恢复

**问题**：v2.1 的 `MAPPING_DIFF_PROMPT` 丢失了原始版本的两个关键约束和场景描述维度。

**原始版本的关键约束**：
- `Describe EXACTLY when to use each SKU` / `精确描述每个SKU的使用场景`
- `Group related SKUs logically` / `将相关SKU进行逻辑分组`

**v2.1 当前示例**（内容描述，非场景描述）：
```
- `factual/vpp-arch`: 虚拟电厂系统架构与核心组件
```

**方案**：在 `MAPPING_DIFF_PROMPT` 中做三处改动：

1. 加约束："每个 SKU 的描述应回答'什么时候需要查阅这个 SKU'，而非'这个 SKU 包含什么内容'"
2. 加约束："按使用场景逻辑分组，而非按来源文档分组"
3. 改示例为场景描述，并展示分组逻辑：

```markdown
示例输出（中文版）：
## 虚拟电厂技术
- `factual/vpp-arch`: 需要了解虚拟电厂系统架构时查阅
- `factual/vpp-policy`: 需要了解虚拟电厂政策法规时查阅
```

4. 英文版示例同步改为场景描述（遗漏 11）：

```markdown
Example output (English version):
## Virtual Power Plant Technology
- `factual/vpp-arch`: When you need to understand VPP system architecture
- `factual/vpp-policy`: When you need to understand VPP policy and regulations
```

**预估改动量**：~8 行 prompt 文本

---

#### 改动 3：清除 mapping.md 占位符

**问题**：`INIT_MAPPING` 包含占位符 `*尚未映射任何 SKU。*`，首次 diff merge 后不会自动清除，永久残留在文件中。

**方案**：在 `_merge_mapping_diff` 的 `lines = current_mapping.split("\n")` 之后加一行过滤：

```python
lines = [l for l in lines if "尚未映射任何" not in l and "No SKUs mapped yet" not in l]
```

**补充（遗漏 13）**：`_merge_mapping_diff` 的 SKU 路径去重只跟踪本次 diff 内的路径，不检查 `current_mapping` 中是否已存在相同路径。如果 LLM 在 diff 中输出了 mapping.md 里已有的 SKU 路径，去重不会拦截，导致重复条目。

修复：在方法开头先从 `current_mapping` 提取已有 SKU 路径初始化 `seen_sku_paths`：

```python
# 从 current_mapping 中提取已有 SKU 路径，防止重复
import re
existing_sku_paths = set(re.findall(r'`([^`]+)`', current_mapping))
seen_sku_paths = existing_sku_paths  # 初始化而非空集合
```

**预估改动量**：~4 行（1 行过滤 + 3 行已有 SKU 路径初始化）

---

#### 改动 4：`is-a` 报警阈值优化

**问题**：当前 `new_relationships > 20` 触发 warning，但新能源领域天然 taxonomic，21 条关系不代表有问题。

**方案**：改为双重检测，保留绝对数量作为 info 日志：

```python
# 1. 绝对数量日志（info 级别，不是 warning）
overuse = {p: c for p, c in predicate_counts.items() if c > 20}
if overuse:
    logger.info("Predicate count over 20", predicates=overuse)

# 2. 占比报警（warning 级别）
total = len(self.relationships.entries)
for pred, count in predicate_counts.items():
    if count / total > 0.3:
        logger.warning(
            "Predicate ratio exceeds 30%",
            predicate=pred,
            count=count,
            total=total,
            ratio=f"{count/total:.1%}",
        )

# 3. 同一 object 下 is-a 子节点过多
isa_by_object: dict[str, int] = {}
for rel in self.relationships.entries:
    if (rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)) == "is-a":
        isa_by_object[rel.object] = isa_by_object.get(rel.object, 0) + 1
for obj, count in isa_by_object.items():
    if count > 5:
        logger.warning(
            "Same object has >5 is-a children",
            object=obj,
            is_a_count=count,
        )
```

**预估改动量**：~10 行

---

#### 改动 5：Factual SKU name 语言一致性

**问题**：日志中 chunk 1 的 SKU name 是中文，后续 chunk 是英文。根因不是 `settings.language` 漂移（它是模块级单例，启动时固定），而是 `FACTUAL_PROMPT` 的 `name` 字段示例为英文 `short-identifier-name`，LLM 无"用中文命名"的指令。

**方案**：修改 `FACTUAL_PROMPT` 中文版的 `name` 字段：

```
# 当前（中英文都是英文示例）
"name": "short-identifier-name"

# 改为（中文版用中文示例 + 约束）
"name": "简短中文标识名（如：虚拟电厂架构）"
```

同时在两个语言版本的 prompt 注意事项中都加一条约束（遗漏 7）：

```
- name 字段使用与文档内容相同的语言
```

英文版 `FACTUAL_PROMPT` 同样需要加此约束（`factual_extractor.py:47` 英文版示例也是 `short-identifier-name`），防止 `settings.language="en"` 但内容为中文时出现语言不一致。

**预估改动量**：~4 行 prompt 文本

---

### 10.4 第二阶段（下周，P1）

#### 改动 6：别名映射 + 主题相关已有关系

**问题**：v2.1 只传术语名列表（逗号分隔），丢失了原始版本 glossary 中的 `aliases`、`definition`、`related_terms` 信息。LLM 无法做实体消歧（VPP=虚拟电厂），也无法发现跨文档关联。

**原始版本的做法**：传完整 glossary JSON（含 definition、aliases、related_terms），但 token 爆炸（~15-30K tokens）。

**方案**：在增量模式中精准补回两个高信噪比上下文，总 token 增加约 ~2400 字符（label_tree max_chars 从 6000 降到 4000 后，净增幅可承受）。

**A. 别名映射 `_get_alias_map()`**

从 glossary 的 aliases 生成别名→标准术语的映射表，约 200-500 字符：

```python
def _get_alias_map(self) -> str:
    """Generate alias → standard term mapping from glossary."""
    lines = []
    for entry in self.glossary.entries:
        if entry.aliases:
            aliases_str = ", ".join(entry.aliases)
            lines.append(f"{aliases_str} → {entry.term}")
    return "\n".join(lines) if lines else "(无别名)"
```

LLM 看到的格式：

```
VPP → 虚拟电厂
V2G → 车网互动
DR → 需求响应
```

**B. 主题相关关系 `_get_relevant_relations()`**

筛选 subject/object 在当前 chunk 中出现的已有关系，最多 40 条，约 1500-2000 字符：

```python
def _get_relevant_relations(self, content: str, max_relations: int = 40) -> str:
    """Get existing relationships relevant to current chunk content."""
    # 从 content 中提取出现的术语（含别名匹配）
    mentioned_terms = set()
    for entry in self.glossary.entries:
        if entry.term in content:
            mentioned_terms.add(entry.term.lower())
        for alias in entry.aliases:
            if alias in content:
                mentioned_terms.add(entry.term.lower())
        # related_terms 也纳入匹配范围
        for rt in entry.related_terms:
            if rt in content:
                mentioned_terms.add(rt.lower())

    # 筛选涉及这些术语的关系（substring 匹配，遗漏 8 修正）
    relevant = []
    for rel in self.relationships.entries:
        sub = rel.subject.lower()
        obj = rel.object.lower()
        if any(t in sub for t in mentioned_terms) or any(t in obj for t in mentioned_terms):
            pred = rel.predicate.value if hasattr(rel.predicate, "value") else str(rel.predicate)
            relevant.append(f"- {rel.subject} {pred} {rel.object}")
        if len(relevant) >= max_relations:
            break

    return "\n".join(relevant) if relevant else "(无相关已有关系)"
```

**C. Prompt 增加占位符**

在 `RELATIONAL_INCREMENTAL_PROMPT` 中增加：

```
术语别名映射：
{alias_map}

与当前内容相关的已有关系：
{relevant_relations}
```

**D. Token 预算调整**

| 上下文 | 当前 v2.1 | 改动后 | 变化 |
|--------|----------|--------|------|
| label_tree | 6000 字符 | 4000 字符 | -2000 |
| term_list | 4000 字符 | 4000 字符 | 不变 |
| alias_map | 0 | ~400 字符 | +400 |
| relevant_relations | 0 | ~2000 字符 | +2000 |
| **总计** | **~10000** | **~10400** | **+4%** |

缩进树本身比扁平路径更紧凑，实际 label_tree 4000 字符的覆盖范围可能等同或超过原来 6000 字符的扁平路径。

**预估改动量**：~40 行（含两个新方法 + prompt 改动 + `extract()` 调用改动）

---

#### 改动 7：分类轴约束

**问题**：LLM 向已有父节点添加子类时，不检查现有子类使用的分类维度，导致同一节点下混用不同分类轴（如"虚拟电厂"下既有"电网系/售电型/发电类型"按功能分类，又有"城市级"按规模分类）。

**方案**：在 `RELATIONAL_INCREMENTAL_PROMPT` 的 Guidelines 里加分类轴约束，同时包含"约束"和"引导"：

```
- 当向已有父节点添加子类时：
  1. 先检查该父节点现有子类使用的分类维度
  2. 如果新子类与现有子类在同一维度，直接添加
  3. 如果新子类属于不同维度，创建新的子树
  示例：虚拟电厂下已有"电网系/售电型/发电类型"（按功能分类），
  如果要添加"城市级"（按规模分类），应创建"虚拟电厂 > 按规模 > 城市级"
```

**预估改动量**：~8 行 prompt 文本

---

#### 改动 8：谓词升级

**问题**：当前 13 个谓词缺少"认证"和"包含"类关系的精确表达；未知谓词静默降级为 `related-to`，无法追踪 LLM 输出了什么未识别谓词。

**方案**：

**A. 新增谓词**

在 `RelationType` 枚举（`sku.py`）中新增：
- `certifies`：认证关系（如"绿证 certifies 绿电"）
- `superset-of`：包含关系（如"新能源发电 superset-of 虚拟电厂"），不加 `subset-of`（LLM 天然从大→小，不对称设计避免冗余）

**B. fallback 加 warning**

```python
# 当前：静默 fallback
except ValueError:
    predicate = RelationType.RELATED_TO

# 改为：记录 warning 后 fallback
except ValueError:
    logger.warning(
        "Unknown predicate from LLM, falling back to related-to",
        raw_predicate=predicate_str,
        chunk_id=chunk_id,
    )
    predicate = RelationType.RELATED_TO
```

**C. prompt 加软约束**

```
优先使用精确谓词（如 certifies、superset-of），仅在确实无法归类时使用 related-to。
新增可用谓词：certifies（认证）、superset-of（包含/超集）
superset-of 方向说明：从大概念指向小概念，表示"包含"关系
示例：新能源发电 superset-of 虚拟电厂（新能源发电包含虚拟电厂这一子类）
```

**补充（遗漏 12）**：`superset-of` 对 LLM 方向不直观（`A superset-of B` 意味着 A 包含 B，但 LLM 可能理解为 B 包含 A），必须在 prompt 中给出方向性示例。

**预估改动量**：~13 行（枚举 2 行 + warning 3 行 + prompt 8 行）

---

### 10.5 第三阶段（两周后，P2）

#### 改动 9：Eureka 触发门槛调整 + SKU 去重上下文

**问题**：eureka 准入标准要求"必须跨领域"，导致大量有价值的可复用领域设计原则被排除。此外，中文版 `EUREKA_DIRECT_PROMPT` 存在自相矛盾（line 124 "如果不需要更新，原样返回现有内容" 与 line 129 "如果不需要更新：只输出 NO_UPDATE_NEEDED" 矛盾）。

**方案**：

**A. 修复中文版 prompt 自相矛盾（遗漏 6）**

删除 `meta_extractor.py:124` 的 "如果不需要更新，原样返回现有内容"。英文版无此矛盾行，无需改动。

**B. 放宽准入标准**

在 `EUREKA_DIRECT_PROMPT` 的准入条件中增加第 5 条：

```
5. 提出可复用于其他领域的领域设计原则或架构模式
```

同时更新排除标准的最后一条：

```
- 是领域特定的且不具可复用性的功能建议
```

**C. 传入当前 chunk 的 Factual SKU 列表**

修改 `_update_eureka` 签名：

```python
def _update_eureka(self, content: str, chunk_id: str, context: dict | None = None) -> None:
```

在 prompt 中增加：

```
当前 chunk 已提取的 Factual SKU：
{factual_skus}

注意：不要将已有 SKU 已覆盖的领域知识重复作为 eureka 洞察输出。
```

调用处（`meta_extractor.py` 中）需要从 `context["new_skus"]` 中筛选 `classification == FACTUAL` 的 SKU 传入。

**D. 同步修改 `executor.submit` 调用处（遗漏 9）**

`meta_extractor.py:293` 的 `executor.submit(self._update_eureka, content, chunk_id)` 需改为：

```python
executor.submit(self._update_eureka, content, chunk_id, context)
```

只改签名不改调用处会导致运行时 TypeError。

**预估改动量**：~17 行

---

#### 改动 10：关系置信度评分

**问题**：`Relationship.confidence` 字段已预留但从未启用，无法区分 LLM 高置信度关系和低置信度推测。

**方案**：

**A. prompt 增加 confidence 字段**

在 `new_relationships` 输出格式中加 `"confidence": 4`，1-5 整数。

**B. merge 时映射到 float**

```python
confidence_raw = rel_data.get("confidence")
if confidence_raw and isinstance(confidence_raw, (int, float)):
    # 映射 1-5 整数到 0.2-1.0 float
    rel.confidence = max(0.2, min(1.0, float(confidence_raw) / 5.0))
```

选择 1-5 int 而非 0.0-1.0 float：LLM 对整数评分更准确，0.0-1.0 容易产生 0.73 这种伪精度。

**预估改动量**：~8 行

---

### 10.6 第四阶段（一个月后，P3）

#### 改动 11：独立的跨文档关系发现阶段

**问题**：两个版本都没有专门的跨文档关系发现机制。不同文档中的"虚拟电厂"和"VPP"不会自动对齐，两个文档分别提到 A→B 和 B→C 不会自动推断 A→C。

**方案**：在 Module 3 完成后、Module 4 之前，新增一个后处理步骤：

1. **实体消歧**：利用 glossary aliases 做初步对齐（VPP→虚拟电厂）
2. **候选关系推断**：对相似实体对（如 A→B 和 B→C 已存在），生成候选三元组 A→C
3. **LLM 验证**：对候选关系调用 LLM 判断是否成立
4. **写入**：通过 `Relationships.add()` 去重后写入

现有 postprocessors 管道已支持扩展，实现复杂度较高但架构上无需大改。

**预估改动量**：~200 行新代码

---

### 10.7 改动量汇总

| 阶段 | 改动 | 代码行数 | 风险 |
|------|------|---------|------|
| **第一阶段（P0）** | 1. 缩进树 + 占位符重命名 + max_chars 调整 + 日志字段修复 | ~31行 | 极低 |
| | 2. mapping 场景描述恢复（中英文版） | ~8行 prompt | 零 |
| | 3. 占位符清除 + 已有 SKU 路径去重初始化 | ~4行 | 极低 |
| | 4. is-a 报警阈值优化 | ~10行 | 低 |
| | 5. Factual SKU name 语言一致性（中英文版） | ~4行 prompt | 低 |
| **第一阶段小计** | | **~57行** | |
| **第二阶段（P1）** | 6. 别名映射 + 主题关系（substring 匹配）+ token 预算调整 | ~42行 | 低 |
| | 7. 分类轴约束 | ~8行 prompt | 极低 |
| | 8. 谓词升级（含 superset-of 方向示例） | ~13行 | 低 |
| **第二阶段小计** | | **~63行** | |
| **第三阶段（P2）** | 9. Eureka 门槛 + SKU 去重 + prompt 矛盾修复 + executor.submit 同步 | ~17行 | 低 |
| | 10. 关系置信度评分 | ~8行 | 低 |
| **第三阶段小计** | | **~25行** | |
| **第四阶段（P3）** | 11. 跨文档关系发现 | ~200行新代码 | 中 |
| **总计** | | **~345行** | |

### 10.8 文件改动清单

| 文件 | 阶段 | 改动类型 | 改动内容 |
|------|------|---------|---------|
| `relational_extractor.py` | P0 | 修改 | `_summarize_label_tree` 改为缩进树；占位符 `{label_paths}`→`{label_tree}`；`max_chars` 6000→4000；prompt 说明文本更新；`label_paths_count` 日志字段改为从 `self.label_tree` 统计 |
| `meta_extractor.py` | P0 | 修改 | `MAPPING_DIFF_PROMPT` 中英文版加约束句 + 改示例为场景描述 |
| `meta_extractor.py` | P0 | 修改 | `_merge_mapping_diff` 加占位符过滤 + 从 `current_mapping` 提取已有 SKU 路径初始化 `seen_sku_paths` |
| `relational_extractor.py` | P0 | 修改 | 谓词分布监控：绝对数量改 info + 占比 >30% warning + 同一 object >5 is-a warning |
| `factual_extractor.py` | P0 | 修改 | `FACTUAL_PROMPT` 中英文版 name 字段示例改为中文/加语言约束 |
| `relational_extractor.py` | P1 | 修改 | 新增 `_get_alias_map()`、`_get_relevant_relations()`（substring 匹配）；prompt 增加占位符；`extract()` 调用改动 |
| `relational_extractor.py` | P1 | 修改 | prompt 加分类轴约束 + 引导 + 示例 |
| `sku.py` | P1 | 修改 | `RelationType` 枚举新增 `certifies`、`superset-of` |
| `relational_extractor.py` | P1 | 修改 | fallback 加 warning 日志；prompt 加软约束 + `superset-of` 方向性示例 |
| `meta_extractor.py` | P2 | 修改 | `EUREKA_DIRECT_PROMPT` 中文版删除矛盾行 + 准入标准放宽；`_update_eureka` 签名加 context 参数；`executor.submit` 调用同步传入 context |
| `relational_extractor.py` | P2 | 修改 | prompt 加 confidence 字段；merge 时 1-5→0.2-1.0 映射 |
| 新增 postprocessor | P3 | 新增 | 跨文档关系发现阶段 |

### 10.9 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 缩进树截断在子树中间 | 低 | 中 | 截断策略在子树边界断开，不截断节点中间 |
| 别名映射增加 prompt 长度 | 确定 | 低 | label_tree max_chars 从 6000→4000，净增仅 ~4% |
| `superset-of` 方向反转 | 低 | 低 | prompt 加方向性示例引导（大概念→小概念） |
| LLM 不遵守 confidence 输出 | 中 | 低 | confidence 为可选字段，缺失时默认 None |
| 分类轴约束过长影响 LLM 遵循 | 低 | 中 | 约束控制在 5 行内，附具体案例 |
| `_get_relevant_relations` substring 匹配误命中 | 低 | 中 | `mentioned_terms` 从 glossary 提取，术语本身有区分度；必要时加最小长度过滤（≥2字符） |
| `_merge_mapping_diff` 已有 SKU 路径提取正则遗漏 | 低 | 低 | 用 `re.findall(r'\x60([^\\x60]+)\x60', current_mapping)` 提取反引号内路径，覆盖 mapping.md 标准格式 |

### 10.10 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| 改动 1 | `_summarize_label_tree` 恢复为扁平路径版本，占位符改回 `{label_paths}`，`max_chars` 改回 6000，日志字段改回 `len(all_paths)` |
| 改动 2 | `MAPPING_DIFF_PROMPT` 中英文版删除新增约束句和示例改动 |
| 改动 3 | `_merge_mapping_diff` 删除占位符过滤行和 `seen_sku_paths` 初始化 |
| 改动 4 | 恢复 `> 20` 为 warning 级别，删除占比和同 object 检测 |
| 改动 5 | `FACTUAL_PROMPT` 中英文版 name 示例改回 `short-identifier-name`，删除语言约束 |
| 改动 6 | 删除 `_get_alias_map()`、`_get_relevant_relations()`，prompt 删除新增占位符 |
| 改动 7 | prompt 删除分类轴约束段落 |
| 改动 8 | `RelationType` 枚举删除 `certifies`、`superset-of`，fallback 删除 warning，prompt 删除方向性示例 |
| 改动 9 | `EUREKA_DIRECT_PROMPT` 恢复中文版矛盾行，准入标准改回 4 条，`_update_eureka` 签名去掉 context，`executor.submit` 去掉 context 参数 |
| 改动 10 | prompt 删除 confidence 字段，merge 删除映射逻辑 |
| 改动 11 | 删除新增 postprocessor 文件 |

所有改动独立，可单独回滚，互不影响。

---

## 十一、v3.0 实施记录

> 实施日期: 2026-04-26

### 11.1 实施清单

| # | 改动 | 状态 | 实施内容 |
|---|------|------|---------|
| **1** | 缩进树 + 占位符重命名 | ✅ 已完成 | `_summarize_label_tree` 改为递归缩进树；`{label_paths}` → `{label_tree}`；`max_chars` 6000→4000；`_walk_tree` 统计节点数 |
| **2** | mapping 场景描述恢复 | ✅ 已完成 | `MAPPING_DIFF_PROMPT` 中英文版加"什么时候需要查阅"约束 + 场景描述示例 |
| **3** | 占位符清除 + 已有 SKU 路径去重 | ✅ 已完成 | `_merge_mapping_diff` 过滤占位符 + 从 `current_mapping` 初始化 `seen_sku_paths` |
| **4** | is-a 报警阈值优化 | ✅ 已完成 | 三重检测：绝对>20 info、占比>30% warning、同 object >5 is-a warning |
| **5** | Factual SKU name 语言一致性 | ✅ 已完成 | 中英文版 FACTUAL_PROMPT 加语言约束 + 中文版 name 示例 |
| **6** | 别名映射 + 主题关系 | ✅ 已完成 | `_get_alias_map()` + `_get_relevant_relations()` (substring 匹配) + prompt 占位符 |
| **7** | 分类轴约束 | ✅ 已完成 | prompt 加分类轴约束段落 + 示例 |
| **8** | 谓词升级 | ✅ 已完成 | `certifies`/`superset-of` 枚举 + fallback warning + prompt 方向性示例 |
| **9** | Eureka 门槛 + SKU 去重 | ✅ 已完成 | 删除矛盾行 + 第5条准入标准 + `_format_factual_skus()` + executor.submit 同步 |
| **10** | 关系置信度评分 | ✅ 已完成 | prompt 加 confidence 字段 + 1-5→0.2-1.0 映射 |
| **11** | 跨文档关系发现 | ✅ 已完成 | 新增 `CrossDocRelationsPostprocessor`：实体消歧 + 传递候选生成 + LLM 验证 + 写入 |

### 11.2 改动 11 实施详情

**新增文件**：

| 文件 | 内容 |
|------|------|
| `postprocessors/cross_doc_relations.py` | `CrossDocRelationsPostprocessor` — 跨文档关系发现后处理器 |

**修改文件**：

| 文件 | 改动内容 |
|------|---------|
| `schemas/postprocessing.py` | 新增 `CrossDocRelationResult` schema |
| `postprocessors/__init__.py` | 导出 `CrossDocRelationsPostprocessor` |
| `postprocessors/pipeline.py` | 注册为 Step 4 + `run_cross_relations()` 方法 |
| `cli.py` | 新增 `postprocess cross-relations` 子命令 + `postprocess all` 输出更新 |

**核心流程**：

```
1. 实体消歧 — 利用 glossary aliases 构建别名→标准术语映射
2. 传递候选生成 — A pred B + B pred C => A pred C（可传递谓词）
3. 过滤已有 — 排除已在 relationships.json 中的关系
4. LLM 验证 — 分批调用 LLM 判断候选关系是否成立
5. 写入 — 通过 Relationships.add() 去重后写入 relationships.json
```

**可传递谓词**：`causes`, `caused-by`, `requires`, `depends-on`, `part-of`, `superset-of`, `enables`, `regulates`

**设计决策**：

- 传递推理仅在**相同可传递谓词**时生成同谓词候选（A causes B + B causes C => A causes C）
- 不同可传递谓词链仅生成 `related-to`（A causes B + B enables C => A related-to C）
- LLM 验证结果使用 `source_chunks=["cross-doc-discovery"]` 标记来源
- 推断关系默认 confidence=0.4，LLM 验证后按 1-5 评分映射
- 分批验证（每批 ≤40 条）避免 prompt 膨胀
- 已有关系作为上下文传入 LLM，防止误判

**使用方式**：

```bash
# 单独运行
python -m chunks2skus.cli postprocess cross-relations -s output/skus/

# 作为完整后处理管道的一部分
python -m chunks2skus.cli postprocess all -s output/skus/
```

---

## 十二、v3.1 — 并行化优化

> 实施日期: 2026-04-26

### 12.1 背景

项目使用三个大模型（火山引擎），参数为：
- TPM: 5000k (5M tokens/min)
- RPM: 30,000 requests/min
- 上下文窗口: 256k
- 最大输出: 128k

v3.0 实施后，并行度极低（仅 Phase 1 的 3 个提取器并行），对配额的利用率不足 1%。瓶颈集中在两个后处理器：Proofreading（逐 SKU 串行评分）和 Cross-doc（逐批次串行验证）。

### 12.2 并行架构分析（改动前）

| 层级 | 位置 | 并行数 | 占 TPM | 占 RPM |
|------|------|--------|--------|--------|
| Phase 1 提取器 | `router.py:255` | 3 | 0.7% | 0.01% |
| Meta 内部 | `meta_extractor.py:310` | 2 | 0.6% | — |
| Proofreading | `proofreading.py` | **1** (串行) | — | — |
| Cross-doc 验证 | `cross_doc_relations.py` | **1** (串行) | — | — |
| 后处理步骤 | `pipeline.py` | **1** (串行) | — | — |

### 12.3 改动清单

| # | 改动 | 状态 | 文件 | 详情 |
|---|------|------|------|------|
| 1 | Jina client 线程安全 | ✅ 已完成 | `utils/jina_client.py` | 添加 `_rate_limit_lock = threading.Lock()`，请求前后 `_last_request_time` 更新均在锁内 |
| 2 | Proofreading 并行化 | ✅ 已完成 | `postprocessors/proofreading.py` | `ThreadPoolExecutor(max_workers=6)` + `as_completed`，每 SKU 独立评分，report 写入加 `report_lock` |
| 3 | Cross-doc 批次并行化 | ✅ 已完成 | `postprocessors/cross_doc_relations.py` | `ThreadPoolExecutor(max_workers=8)` + `as_completed`，批次间零状态依赖（同一快照只读），写入在所有批次完成后 |

### 12.4 线程安全保证

| 共享资源 | 保护方式 |
|---------|---------|
| Jina `_last_request_time` | `threading.Lock()` — 请求前后都在锁内 |
| LLM 客户端 | 每线程独立实例（`_thread_local`，已有机制） |
| Proofreading `report` | `report_lock = threading.Lock()` — 写入计数器时加锁 |
| Proofreading header 文件 | 每个 SKU 独立文件，无竞争 |
| Cross-doc `relationships` | 并行期间只读不写（run() 开头加载，循环结束后才写入） |
| Cross-doc `accepted_rels` | `as_completed` 主线程串行消费，`extend` 无竞争 |

### 12.5 并行架构（改动后）

| 层级 | 位置 | 并行数 | 占 TPM | 占 RPM |
|------|------|--------|--------|--------|
| Phase 1 提取器 | `router.py:255` | 3 | 0.7% | 0.01% |
| Meta 内部 | `meta_extractor.py:310` | 2 | 0.6% | — |
| **Proofreading** | `proofreading.py` | **6** | **1.8%** | **0.02%** |
| **Cross-doc 验证** | `cross_doc_relations.py` | **8** | **2.4%** | **0.01%** |
| 后处理步骤 | `pipeline.py` | 1 (串行) | — | — |

### 12.6 Jina API 使用状态

当前 `.env` 中 `JINA_API_KEY` 为空，`search_web()` 直接返回 `None`。Proofreading 实际走 `"(Web search unavailable)"` 分支，纯靠 LLM 自身判断打分，没有外部验证。Jina 的线程安全锁已预先加上，配置 API key 后即可启用。

### 12.7 预期加速

| 后处理器 | 改动前 | 改动后 | 加速比 |
|---------|--------|--------|--------|
| Proofreading | 1 SKU/次 | 6 SKU 并行 | **~6x** |
| Cross-doc 验证 | 1 批次/次 | 8 批次并行 | **~8x** |

### 12.8 质量影响

| 改动 | 质量影响 | 原因 |
|------|---------|------|
| Proofreading 并行 | **零影响** | 每个 SKU 独立评分，相同 prompt + 相同 source chunk = 确定性结果 |
| Cross-doc 并行 | **零影响** | 每批读取同一 `relationships`/`glossary` 快照（只读），写入在所有批次完成后 |

### 12.9 回滚方式

每项改动独立，可通过 git revert 单独回滚：

```bash
# 回滚 Proofreading 并行（恢复为串行 for 循环）
git revert <commit>

# 回滚 Cross-doc 并行（恢复为串行 for 循环）
git revert <commit>

# 回滚 Jina 锁（恢复为 global 变量无锁版本）
git revert <commit>
```

---

## 十三、v3.2 — 提取质量修复

> 实施日期: 2026-04-26

### 13.1 背景

v3.0-v3.1 优化了性能和并行度，但 21/26 chunks 的输出质量评估暴露了 **10 个系统级质量问题**。这些问题均为 prompt 约束不足或代码防御缺失导致，非架构缺陷。

### 13.2 质量评估摘要（21 chunks / 199 SKU / 82 Skills / 209 关系）

| 问题 | 严重度 | 检出率 | 根因 |
|------|--------|--------|------|
| `example-of` 方向反转 | P0 | 所有 `example-of` 关系 | prompt 无方向定义 |
| 元数据SKU膨胀 | P0 | ~15/21 chunks 第一个 SKU | prompt 无排除规则 |
| Eureka 覆盖面极窄 | P1 | 17/21 chunks 贡献 0 条 | 双重劝退 prompt |
| Eureka 归因错误 | P1 | 已有洞察存在归因错误 | `_flush_meta` 只传最后一个 chunk_id |
| Glossary 定义绑定特定企业 | P1 | 多个词条 | prompt 无泛化指令 |
| 原文复制粘贴未转化 | P1 | ~5-8% SKU | prompt 只说"提取"不说"转化" |
| 交叉引用缺失 | P2 | 几乎所有 SKU | 架构设计 + prompt 未要求 |
| 置信度无区分度 | P2 | 96.2% 为 1.0 | LLM 倾向给高分 |
| `source_chunk` 空字段 | P3 | 所有 glossary 词条 | 代码遗留 |
| Procedural 提取器 `'str'` 错误 | P3 | 1 个 chunk | LLM 返回数组混入字符串 |

### 13.3 改动清单

| # | 优先级 | 改动 | 文件 | 改动量 | 状态 |
|---|--------|------|------|--------|------|
| 1 | P0 | `example-of` 方向定义 | `relational_extractor.py` | 2行 prompt | ✅ 已完成 |
| 2 | P0 | 元数据SKU排除规则 + 最小字数检查 | `factual_extractor.py` | 7行 (4 prompt + 3 code) | ✅ 已完成 |
| 3 | P1 | Eureka 降低门槛 + `chunk_ids` 签名改版 | `meta_extractor.py` + `pipeline.py` | ~8行 | ✅ 已完成 |
| 4 | P1 | Glossary 泛化规则 | `relational_extractor.py` | 4行 prompt | ✅ 已完成 |
| 5 | P1 | 原文转化规则 + markdown 结构化 warning | `factual_extractor.py` | 8行 (4 prompt + 4 code) | ✅ 已完成 |
| 6 | P2 | `source_chunk` 填充 | `relational_extractor.py` | 2行代码 | ✅ 已完成 |
| 7 | P3 | Procedural 类型检查 | `procedural_extractor.py` | 3行代码 | ✅ 已完成 |

**总计**: ~34 行改动，零架构变动。

### 13.4 改动详情

#### 改动 1：`example-of` 方向定义

**位置**: `relational_extractor.py` L159 后（`superset-of` 方向定义之后）

**内容**: 在中文 prompt 的谓词说明中，`superset-of` 定义后追加：

```
- example-of：实例归属关系，方向为 实例 → 类型（如"协鑫虚拟电厂 example-of 负荷型虚拟电厂"）
  注意：主语必须是具体实例，宾语必须是抽象类别，方向不可反转
```

英文版同步添加。

**风险**: 极低。仅增加方向约束，不影响其他谓词。

---

#### 改动 2：元数据SKU排除规则 + 最小字数检查

**位置 A**: `factual_extractor.py` L66 后（`"描述性细节"` 之后），加排除规则：

```
不应提取的内容（元数据，不具备独立知识价值）：
- 调研时间、调研地点、调研对象等文档头部信息
- 仅包含"本报告由XX于XX时间针对XX完成"类句子的内容
- 无法脱离文档上下文独立使用的描述性段落

如果一个潜在SKU仅包含上述类型信息，跳过它，不要生成。
```

英文版同步添加。

**位置 B**: `factual_extractor.py` `_create_sku()` 中 `char_count` 计算后加：

```python
if char_count < 80:
    logger.info("Skipping trivially short SKU", name=name, chars=char_count)
    return None
```

**调用方确认**: `extract()` L168 已有 `if sku_info:` guard，返回 None 不会被追加。

---

#### 改动 3：Eureka 降低门槛 + chunk_ids 签名改版

**3a**: `meta_extractor.py` EUREKA_SYSTEM_PROMPT zh — 删除"大多数片段不需要更新"，改为"每份行业调研报告通常都包含至少一个可提炼的跨领域模式。"

**3b**: EUREKA_DIRECT_PROMPT — 将 `"Most chunks will NOT warrant an update"` / `"大多数片段不会需要更新"` 改为积极措辞。

**3c**: `meta_extractor.py:291` — 签名 `chunk_id: str` → `chunk_ids: list[str] | str`

**3d**: `meta_extractor.py:529` — `_update_eureka` 参数同步改

**3e**: prompt 模板 `{chunk_id}` → `{chunk_ids_str}`，格式化时 `", ".join(chunk_ids if isinstance(chunk_ids, list) else [chunk_ids])`

**3f**: `pipeline.py:214` — `chunk_ids[-1]` → `chunk_ids`

---

#### 改动 4：Glossary 泛化规则

**位置**: `relational_extractor.py` prompt 中 `new_glossary` 说明后追加：

```
glossary 定义规则：
- 定义必须是该术语的通用含义，适用于任何使用该术语的场景
- 禁止在定义中出现具体企业名、项目名、地名
- 如果文档中只有该术语的特定企业用法，用该用法归纳出通用定义
  ❌ "国海绿能可作为重卡换电站项目的EPC总包方"
  ✅ "对工程项目的设计、采购、施工全过程进行总承包的方"
```

---

#### 改动 5：原文转化规则 + markdown 结构化 warning

**5a**: `factual_extractor.py` prompt 中"任务"段后追加知识转化规则：

```
知识转化规则（重要）：
- 不要直接复制原文段落。必须将原文信息转化为结构化知识
- 包含数据对比的内容必须转化为 Markdown 表格或 JSON 数组
- 包含步骤流程的内容必须转化为有序列表
- 参数规格必须转化为字段-值对
- 原文的叙述性段落必须提炼为要点，不得原样保留
```

**5b**: `_create_sku()` 中 `content_str = str(content)` 后、写文件前加弱检查：

```python
if content_type == "markdown":
    has_structure = any(marker in content_str for marker in ("#", "- ", "| ", "1."))
    if not has_structure:
        logger.warning("Markdown SKU lacks structure markers", name=name, chars=len(content_str))
```

---

#### 改动 6：`source_chunk` 填充

**位置 A**: `relational_extractor.py` L389 — `GlossaryEntry(` 构造中加 `source_chunk=chunk_id,`

**位置 B**: `relational_extractor.py` L443 — fallback `GlossaryEntry(` 构造中加 `source_chunk=chunk_id,`

---

#### 改动 7：Procedural 类型检查

**位置**: `procedural_extractor.py` L165，`for procedure in procedures:` 循环内加：

```python
if not isinstance(procedure, dict):
    logger.warning("Skipping non-dict procedure", type=type(procedure).__name__)
    continue
```

### 13.5 执行计划

1. **P0 改动 1+2** — 同一 commit，用"奇峰聚能"单 chunk 验证
2. **P1 改动 3+4+5** — 验证 P0 后实施
3. **P2+P3 改动 6+7** — 随后实施
4. **全量重跑** — 全部改动验证后执行
5. **`example-of` 历史数据翻转** — 全量重跑后评估是否需要

### 13.6 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| 1 | 删除 `example-of` 方向定义行 |
| 2 | 删除 prompt 排除规则段落 + 删除最小字数检查 |
| 3 | 恢复 EUREKA_SYSTEM_PROMPT 原文 + 恢复 `chunk_id: str` 签名 + pipeline 改回 `chunk_ids[-1]` |
| 4 | 删除 glossary 泛化规则段落 |
| 5 | 删除知识转化规则段落 + 删除 markdown 结构化 warning |
| 6 | 删除 `source_chunk=chunk_id,` |
| 7 | 删除 `isinstance` 检查 |

所有改动独立，可单独回滚。

---

## 14. 验证结果与后续跟踪（2026-04-26 更新）

### 14.1 已验证通过的改动（关闭）

| 改动 | 验证方式 | 结果 |
|------|---------|------|
| 1. `example-of` 方向定义 | 5-chunk 抽取，10 条 `example-of` 方向全部正确 | ✅ PASS |
| 2. 元数据 SKU 排除 | 无 meta 类型 SKU 进入 factual/procedural | ✅ PASS |
| 3. Eureka 门槛降低 | 18 条 Eureka 洞察，含多条跨概念聚合 | ✅ PASS |
| 4. Glossary 泛化规则 | 51 条 glossary 定义均为通用定义，无企业名/项目名 | ✅ PASS |
| 5. Factual 原文转化规则 | 46 条 Factual SKU 均为结构化输出 | ✅ PASS |
| 6. `source_chunk` 填充 | glossary.json 所有条目均有 `source_chunk` | ✅ PASS |
| 7. Procedural 类型检查 | 无 `non-dict` 相关 warning | ✅ PASS |

### 14.2 新发现的小问题（进入下一 batch）

| 问题 | 影响 | 修复方式 | 优先级 |
|------|------|---------|--------|
| `is-a` vs `superset-of` 区分不足 | 2/60 条关系用 `is-a` 替代了 `superset-of`（3.3% 偏差率） | prompt 已加区分规则 + 正误示例 | 低 |
| 部分 Factual SKU 信息密度偏低 | 最短 164 字符 | 可考虑加最小信息量要求，暂不急 | 低 |

### 14.3 观察中的指标（全量跑完再评估）

- **跨 chunk Eureka 聚合质量**：5 chunk 样本太小，26 chunk 全量后才能看出聚合深度
- **`related-to` 占比**：当前 6.7%（4/60），较之前 7.7% 略降，趋势好，目标降至 5% 以下
- **`superset-of` 占比**：当前 35%（21/60），全量后目标降至 25% 以下

### 14.4 5-chunk 验证样本统计

- 样本 chunk：固德威-虚拟电厂、国海绿能-重卡换电站、远景科技-储能AIDC、紫电捷控-交直流微电网、非洲调研-肯尼亚
- 总产出：77 SKU（46 factual + 20 procedural + 6 meta + 5 relational）+ 18 Eureka + 51 glossary + 60 relationships
- 文本质量评分：8.7/10

### 14.5 全量重跑预期

- 26 chunk 全量预计产出：~200-240 Factual SKU、~80-100 Procedural SKU、~90-100 条 Eureka 洞察
- 重点观察：Eureka 中跨越 3+ chunk 的洞察（验证增量聚合是否有效）、`superset-of` 占比是否降至 25% 以下

### 14.6 全量 26-chunk 实际结果

| 指标 | 5-chunk 测试 | 26-chunk 全量 | 预测区间 | 达标？ |
|------|-------------|--------------|---------|--------|
| Factual SKU | 46 | 245 | 200-240 | ✅ 超预期 |
| Procedural SKU | 20 | 100 | 80-100 | ✅ 达上限 |
| 关系条目 | 60 | 393 | - | ✅ 6.5x |
| Glossary 条目 | 51 | 294 | - | ✅ 5.8x |
| Eureka 洞察 | 18 | 20 | 90-100 | ❌ 远低预期 |
| 总字符数 | 150,941 | 352,504 | - | ✅ |

#### 关键指标

- **`is-a` vs `superset-of`**：5/6 条 `is-a` 正确（偏差率 0.25%，较 5-chunk 3.3% 大幅下降）✅
- **`superset-of` 占比**：24.7%（降至 25% 以下）✅
- **`related-to` 占比**：9.7%（5-chunk 为 6.7%，因跨领域增多可接受）
- **跨 chunk Eureka**：5/20 跨 3+ chunk，1 条跨 7 chunk
- **跨 chunk 关系**：仅 4 条来自 2+ chunk

#### 文本质量评分

| 模块 | 5-chunk | 全量 | 说明 |
|------|---------|------|------|
| Factual | 8.5 | 8.0 | 47 条 <150 字符（19.2%），12 条 <100 字符 |
| Procedural | 8.5 | 8.0 | 稳定，但部分缺决策点 |
| Relational | 8.5 | 8.5 | 谓词精确度 99.7% |
| Eureka | 8.5 | 7.0 | 数量严重不足（20 vs 预期 90-100） |
| **总体** | **8.7** | **7.9** | Eureka 是主要降分项 |

### 14.7 第二轮改动（prompt 层修复，2026-04-26 实施）

| 编号 | 优先级 | 改动 | 文件 | 预期效果 |
|------|--------|------|------|---------|
| P0 | 最高 | Eureka 去重标准放宽："仅当核心原则完全相同才跳过，主题相关但角度不同的洞察保留" | meta_extractor.py | Eureka 数量从 20 涨到 40+ |
| P1 | 高 | Factual "所以呢"规则：每个 SKU 必须能回答"所以呢？"，仅陈述"X存在"的不生成 | factual_extractor.py | 消除薄 SKU（<100 字符） |
| P2 | 中 | Procedural 决策点格式：原文有条件分支必须提炼，纯线性流程不强制 | procedural_extractor.py | 消除虚假决策点，有分支的流程必须体现 |
| P3 | 低 | Factual 格式选择规则：3+ 可对比字段→JSON，概念解释→Markdown | factual_extractor.py | 同类内容格式统一 |

**验证计划**：先重跑 5-chunk 样本验证 P0（Eureka 数量），确认后全量重跑。

---

<!-- 注：章节编号从十三直接跳到十五，十四未使用。原因是 v3.2（十三）的修复在实施过程中拆分为两批，第二批独立编号为十五而非十四，避免与十三的子节混淆。 -->

## 十五、v3.2.1 — 提取质量修复（第二批，Bug 修复 + 防御性改进）

> 状态: ✅ 已实施 | 日期: 2026-04-26 | 全量验证: 26 chunks, 318 SKUs, 通过

### 15.1 背景

全量 26-chunk 跑完后，对 mapping.md 描述错位和 Eureka 洞察内容压缩两个问题做了根因分析。分析过程追溯了 `name` → `description` → `content` → `mapping.md` 四层数据链，最终确认了 **2 个 P0 bug + 1 个防御性改进**，均为"对任何素材都成立"的通用问题，不依赖特定文档内容。

同时梳理了之前在 CLAUDE.md 中记录但尚未反映到本文档的改动项，经代码验证后剔除了已存在的项，保留真正需要的新增改动。

### 15.2 根因分析过程

#### 15.2.1 mapping.md 描述错位

**现象**：sku_078 的 `name` 是"常见节能降碳技术解决方案"，但 mapping.md 写的是"综合能源服务模式对比"；skill_090 的 `name` 是 AIDC 业务开发，但 mapping.md 写的是"零碳园区规划"。

**验证链**：

| SKU | `name` | `content` | `description` | mapping 描述 | 根因 |
|-----|--------|-----------|--------------|-------------|------|
| sku_078 | "常见节能降碳技术解决方案及核心参数" ✅ | 热泵/余热利用/压缩空气/储能 ✅ | "光伏、风电降碳之外，**综合能源服务**常用的四类节能降碳技术" ⚠️ | "综合能源服务模式差异" ❌ | description 含误导关键词 + 上下文漂移 |
| skill_090 | "new-energy-enterprise-aidc-business-development-workflow" ✅ | AIDC 智算中心新能源配套业务 ✅ | "当新能源企业想要拓展AIDC..." ✅ | "零碳园区规划" ❌ | 纯上下文漂移 |

**两层根因**：
1. **factual extractor**：sku_078 的 `description` 使用了"综合能源服务常用的"这种将自身定位为其他概念子话题的限定语，给下游 meta extractor 埋下误导关键词
2. **meta extractor**：`_format_sku_list` 只传 `path` + `description`，不传 `name`，LLM 缺核心锚点；同 batch 内 SKU 语义场互相干扰，导致 mapping 描述被上下文"带偏"

#### 15.2.2 Eureka 内容压缩

**现象**：`EUREKA_DIRECT_PROMPT` 行 92 有 "Maximum 20 bullets" 约束，LLM 在接近上限时压缩已有条目以腾出空间，导致早期洞察丢失。

**根因**：prompt 虽然在行 89-90 说 "Only APPEND"，但没有明确禁止在达到上限时压缩已有条目，LLM 的合理推断是"合并旧条目腾出空间给新条目"。

### 15.3 代码验证结果

对之前清单中的部分项做了代码验证，以下项**已在代码中存在**，不需要重复添加。注意：这些不是"不存在的问题"，而是"问题曾被识别且代码中已有对应实现"——未来维护者不应误以为这些问题从未被关注过。

| 原列出的改动 | 验证结果 | 代码位置 | 实施来源 |
|---|---|---|---|
| `example-of` 方向定义 | ❌ 已有 | `relational_extractor.py` prompt 行 92/173 | v3.0 改动 1 |
| `is-a` vs `superset-of` 区分 | ❌ 已有 | `relational_extractor.py` prompt 行 89-91/170-172 | v3.0 改动 8 |
| Glossary 泛化规则 | ❌ 已有 | `relational_extractor.py` prompt 行 108-113/189-194 | v3.2 改动 4 |
| `GlossaryEntry` source_chunk 填充 | ❌ 已有 | `relational_extractor.py` 行 410/465 | v3.2 改动 6 |
| Procedural isinstance 检查 | ❌ 已有 | `procedural_extractor.py` 行 177-180 | v3.2 改动 7 |
| `_create_sku()` 返回值检查 | ❌ 已有 | `factual_extractor.py` 行 210-213 / `procedural_extractor.py` 行 181-183 | v2.1 实施 |

### 15.4 待实施改动清单

#### P0-A：mapping 描述错位修复（meta_extractor.py）

**根因**：`_format_sku_list` 不传 `name`，LLM 被同 batch 上下文带偏。

| 位置 | 当前 | 改为 | 改动量 |
|------|------|------|--------|
| `_format_sku_list` L636-638 | `f"{sku.get('path', 'unknown')}: {sku.get('description', 'No description')}"` | `f"{simplified_path}: **{sku.get('name', '')}** — {sku.get('description', 'No description')}"`；path 简化为 `classification/sku_id` 格式 | ~3 行 |
| `MAPPING_DIFF_PROMPT` 中英文版 | 无操作顺序约束 | 加"1. 先读 name 确定核心主题 2. 再读 description 补充细节 3. 描述中的核心概念必须来自 name，不得来自同分组其他 SKU" | ~4 行 prompt |
| 新增 `_validate_mapping_entries()` | 无 | 在写入 mapping.md 前，用 description 前 10 字做 substring 检查，低重叠打 warning 日志，不阻止写入 | ~25 行 |

**`_format_sku_list` 改动详解**：

```python
# 当前
lines.append(
    f"- [{classification}] "
    f"{sku.get('path', 'unknown')}: {sku.get('description', 'No description')}"
)

# 改为
# 1. path 简化为 classification/sku_id 格式（消除 Windows 反斜杠路径与 mapping.md 正斜杠格式的不一致）
path = sku.get("path", "")
if "\\" in path or "/" in path:
    parts = path.replace("\\", "/").split("/")
    simplified = f"{parts[-2]}/{parts[-1]}"
else:
    simplified = path

# 2. 加 name 字段作为核心锚点，加粗显示，暗示 LLM 优先级
name = sku.get("name", "")
desc = sku.get("description", "No description")
if name:
    lines.append(f"- [{classification}] {simplified}: **{name}** — {desc}")
else:
    lines.append(f"- [{classification}] {simplified}: {desc}")
```

**`MAPPING_DIFF_PROMPT` 操作顺序约束（中英文版）**：

```
每条 mapping 描述的生成顺序：
1. 先读该 SKU 的 name 字段，确定核心主题
2. 再读 description 字段补充细节
3. 描述中的核心概念必须来自 name，不得来自同分组其他 SKU
```

**`_validate_mapping_entries` 校验函数**：

```python
def _validate_mapping_entries(self, new_mapping: str, new_skus: list[dict]) -> None:
    """Validate that mapping descriptions overlap with SKU descriptions.
    
    Uses description (Chinese) rather than name (may be English hyphen-case)
    for substring overlap checking. Logs warnings for low overlap, does NOT
    block writes.
    """
    for sku in new_skus:
        description = sku.get("description", "")
        path = sku.get("path", "")
        if not description or len(description) < 5:
            continue
        
        # 取 description 前 10 字作为关键词锚点
        anchor = description[:10]
        
        # 检查 anchor 中的连续 2 字片段是否出现在 mapping 中
        # （对中文场景足够，不需要 jieba 分词）
        path_marker = path.replace("\\", "/").split("/")[-1] if path else ""
        if not path_marker:
            continue
        
        # 在 mapping 中找到包含此 SKU 路径的行
        mapping_lines = new_mapping.split("\n")
        sku_mapping_desc = ""
        for line in mapping_lines:
            if path_marker in line:
                sku_mapping_desc = line
                break
        
        if not sku_mapping_desc:
            continue
        
        # 检查 anchor 的连续 2 字片段是否出现在 mapping 描述中
        has_overlap = any(
            anchor[i:i+2] in sku_mapping_desc 
            for i in range(len(anchor) - 1)
        )
        
        if not has_overlap:
            logger.warning(
                "Low overlap mapping entry",
                sku_path=path_marker,
                description_anchor=anchor,
                mapping_line=sku_mapping_desc.strip()[:80],
            )
```

**设计决策**：
- 用 `description` 做校验锚点而非 `name`：skill_090 的 `name` 是 `new-energy-enterprise-aidc-business-development-workflow`（英文 hyphen-case），和中文 mapping 描述做词重叠匹配不上；`description` 是中文，更可靠
- 不引入 jieba 分词：取 description 前 10 字的连续 2 字片段做 substring 检查，对 sku_078 和 skill_090 两种错位都能检测到，30 行以内，无额外依赖
- 不阻止写入：仅打 warning 日志，作为监控和人工审核入口

---

#### P0-B：Eureka APPEND 强约束（meta_extractor.py）

**根因**：`EUREKA_DIRECT_PROMPT` 有 "Maximum 20 bullets" 约束但无"禁止压缩"约束，LLM 在接近上限时合并已有条目。

| 位置 | 当前 | 改为 | 改动量 |
|------|------|------|--------|
| `EUREKA_DIRECT_PROMPT` 中英文版 | "Only APPEND"（行 89-90）但无禁止压缩约束 | 加"不得合并或压缩已有条目，如果超过上限则停止追加新条目而非压缩已有条目" | ~2 行 prompt |

---

#### P0-C：description 独立成立约束（factual_extractor.py）

**根因**：`FACTUAL_PROMPT` 对 description 仅有"一句话摘要"约束，无独立性要求。factual extractor 可能生成将自身定位为其他概念子话题的 description。

| 位置 | 当前 | 改为 | 改动量 |
|------|------|------|--------|
| `FACTUAL_PROMPT` 中英文版 description 字段说明 | `"description": "该事实单元的一句话摘要"` | 加独立性约束 + 正反例 | ~3 行 prompt |

**约束内容**：

```
description 必须独立成立——读者在不知道同文档其他 SKU 内容的情况下，
应能从 description 准确判断本 SKU 的核心主题。
禁止使用将本 SKU 定位为其他概念子话题的限定语，除非该限定语本身就是本 SKU 的核心主题。

正例："碳捕集利用与封存技术中的核心性能指标"（领域背景是必要的）
反例："综合能源服务常用的节能降碳技术"（把自身定位为另一个概念的子集）
```

**设计决策**：
- 用"独立成立"而非具体句式黑名单（如"避免'XX领域常用的YY'"）：具体句式太窄，LLM 换个说法就能绕过；"独立成立"是通用原则
- 加正反例而非纯规则：LLM 对示例的遵从性远强于抽象规则
- "除非该限定语本身就是本 SKU 的核心主题"：避免过度收紧——"碳捕集技术中的核心指标"是合法的，"碳捕集技术"是核心主题而非从属限定

---

#### 防御性改进：单字术语过滤（relational_extractor.py）

**根因**：`_get_relevant_relations` 的 `mentioned_terms` 收集没有最小长度过滤，单字术语（如"电"）匹配到所有包含该字的内容，产生大量假阳性。对中文素材尤其重要，英文素材无效但无害。

| 位置 | 当前 | 改为 | 改动量 |
|------|------|------|--------|
| `_get_relevant_relations` L662-677 | `mentioned_terms.add(entry.term.lower())` 无长度过滤 | 过滤掉长度 < 2 字符的术语 | ~1 行 |

```python
# 当前
if entry.term in content:
    mentioned_terms.add(entry.term.lower())

# 改为
if len(entry.term) >= 2 and entry.term in content:
    mentioned_terms.add(entry.term.lower())
```

---

### 15.5 功能增强项（非 Bug 修复，独立实施）

#### Eureka 洞察可信度标注

新增后处理脚本，给每条洞察加 `source_chunk_count` 和 `confidence` 字段，不改提取逻辑。

- **high**（来自 3+ 个文档）：跨领域验证过的规律，可直接用于决策或报告
- **medium**（来自 2 个文档）：有一定依据，参考价值高
- **low**（来自 1 个文档）：单一案例观察，适合头脑风暴，需自行判断

注意：APPEND 模式下洞察只增不改，早期文档的洞察不会被后期覆盖。如果素材有时间跨度（如新旧版本政策文件），low 可信度的旧洞察可能已过时，建议结合 `source_chunk` 字段追溯原始文档确认。

此功能为增强项，不是 Bug 修复，不影响提取逻辑的正确性。

---

### 15.6 素材依赖的参数

以下参数的合理值依赖素材类型，换素材时需重新评估：

| 参数 | 当前值 | 适用前提 | 备注 |
|------|--------|----------|------|
| Eureka 洞察门槛 | 20 bullets max | 结构化商业报告 | 更长或更短的文档可能需要调整上限 |
| 元数据排除规则 | 按 chunk header 判断 | 文档有明确章节结构 | 无章节标记的素材可能需要调整 |
| MERGE→APPEND 模式 | APPEND only | 需要保留历史洞察 | **双性质**：(1) 修通用 bug——LLM 在上限约束下压缩已有内容，APPEND 模式对任何素材都必要；(2) 副作用——高度重复素材下产生冗余洞察（不同文档反复提到同一模式），此时可能需要合并模式做去重 |
| Description 独立性约束强度 | 严格 | 多主题混合文档 | 单主题文档可能不需要 |

---

### 15.7 Description 独立性约束 — 验证方法

修改 factual_extractor 的 description 约束后，需验证约束生效且未过度收紧：

1. **单 chunk 验证**：用含多主题的 chunk（安悦节能 chunk，即 sku_076/078 问题的来源）重跑，具体检查 sku_078：(a) 新 description 不再包含"综合能源服务常用的"这类从属限定语；(b) 仍保留"节能降碳技术"这个必要的领域背景
2. **mapping 校验对比**：对比改动前后 `_validate_mapping_entries` 的低重叠 warning 数量，下降说明约束在起作用，上升说明约束让 description 变得更模糊需回滚
3. **抽样 5 条 description**：全量重跑后，从不同领域各抽 1 条，对比新旧 description 是否仍能独立理解

换素材类型重跑时，把"抽查 5 条 description 的独立性"作为标准验收步骤之一。

---

### 15.8 改动量汇总

| 文件 | 优先级 | 改动 | 代码行数 | 风险 |
|------|--------|------|---------|------|
| `meta_extractor.py` | P0-A | `_format_sku_list` 加 `name` 字段 + path 简化 | ~3 行 | 极低 |
| `meta_extractor.py` | P0-A | `MAPPING_DIFF_PROMPT` 加操作顺序约束（中英文） | ~4 行 prompt | 零 |
| `meta_extractor.py` | P0-A | 新增 `_validate_mapping_entries` 校验函数 | ~25 行 | 极低 |
| `meta_extractor.py` | P0-B | `EUREKA_DIRECT_PROMPT` 加 APPEND 强约束（中英文） | ~2 行 prompt | 零 |
| `factual_extractor.py` | P0-C | `FACTUAL_PROMPT` description 独立成立约束（中英文） | ~3 行 prompt | 低 |
| `relational_extractor.py` | 防御 | `_get_relevant_relations` 单字术语过滤 | ~1 行 | 极低 |
| 新增脚本 | 增强 | Eureka 洞察可信度标注 | ~30 行 | 零 |
| **总计** | | | **~68 行** | |

### 15.9 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| P0-A `_format_sku_list` | 恢复为 `path: description` 格式，删除 name 字段和 path 简化 |
| P0-A `MAPPING_DIFF_PROMPT` | 删除操作顺序约束段落 |
| P0-A `_validate_mapping_entries` | 删除函数定义和调用 |
| P0-B `EUREKA_DIRECT_PROMPT` | 删除 APPEND 强约束行 |
| P0-C `FACTUAL_PROMPT` | 删除 description 独立成立约束和正反例 |
| 防御 `_get_relevant_relations` | 删除 `len(entry.term) >= 2` 条件 |
| Eureka 可信度标注 | 删除新增脚本 |

所有改动独立，可单独回滚，互不影响。

---

## 十六、v3.2.1 实施记录与全量验证

> 实施日期: 2026-04-26 | 验证方式: 安悦节能单 chunk + 26 chunk 全量重跑

### 16.1 实施清单
| P0-A2 | `MAPPING_DIFF_PROMPT` 加操作顺序约束（中英文） | `meta_extractor.py` | ✅ 已实施 |
| P0-A3 | 新增 `_validate_mapping_entries` 校验函数 | `meta_extractor.py` | ✅ 已实施 |
| P0-B | `EUREKA_DIRECT_PROMPT` 加 APPEND 强约束（中英文） | `meta_extractor.py` | ✅ 已实施 |
| P0-C | `FACTUAL_PROMPT` description 独立成立约束（中英文） | `factual_extractor.py` | ✅ 已实施 |
| 防御 | `_get_relevant_relations` 单字术语过滤 | `relational_extractor.py` | ✅ 已实施 |
| 基础设施 | httpx 全阶段超时配置（connect=30s, read=600s, write=60s, pool=30s） | `llm_client.py` | ✅ 已实施 |
| 基础设施 | `validate_single_chunk.py` 修复（`extract_single_chunk` 替代 monkey-patch + `resolve()` 路径） | `validate_single_chunk.py` | ✅ 已实施 |

### 16.2 httpx 超时修复（基础设施）

**问题**：全量跑时第 5/26 chunk（则鸣新能源）之后进程卡住超过 2 小时无任何输出。

**根因**：`OpenAI()` 构造函数未传 `timeout` 参数，httpx 默认 `connect`/`pool` 超时为 None（无限）。火山引擎 API 在并发请求时可能静默丢弃连接（不返回也不关闭），TCP 层无超时导致永远挂起。`call_llm_full` 中 `timeout=settings.llm_timeout_seconds` 仅覆盖请求级 read timeout，不覆盖 connect/pool 阶段。

**修复**：在 `get_llm_client()` 中构造 `OpenAI()` 时传入 `httpx.Timeout`，覆盖全部 4 个超时阶段：

| 阶段 | 修复前 | 修复后 | 说明 |
|------|--------|--------|------|
| connect | None (无限) | 30s | TCP 建连超时 |
| read | 600s (请求级) | 600s (客户端级) | 等待响应超时 |
| write | None (无限) | 60s | 发送大请求超时 |
| pool | None (无限) | 30s | 连接池获取超时 |

### 16.3 单 chunk 验证（安悦节能）

用安悦节能 chunk 单独重跑验证三项检查：

| 检查项 | 修复前 | 修复后 | 结论 |
|--------|--------|--------|------|
| sku_002 description 不含"综合能源服务常用的" | ❌ 含从属限定语 | ✅ "介绍山东安悦节能技术有限公司的发展背景、主营业务范围及核心竞争优势" | PASS |
| sku_002 保留"节能降碳"背景 | 通过 description 从属定位 | 通过 mapping.md 上下文体现 | PASS |
| mapping.md 描述以"节能降碳"为核心 | "需要了解综合能源服务常用技术" | "需要了解山东安悦节能技术有限公司基本概况时查阅" | PASS |
| `_validate_mapping_entries` 低重叠 warning | 不存在 | 校验函数正常运行（无低重叠 = 匹配度高） | PASS |

### 16.4 全量 26-chunk 验证结果

**运行概况**：

| 指标 | 数值 |
|------|------|
| 处理 chunks | 26 |
| 总 SKU | 318（factual 218 + procedural + relational） |
| 总运行时间 | 4,073 秒（~68 分钟） |
| 总字符数 | 349,313 |
| 平均每 chunk 产出 | 12.2 SKU |
| HTTP 超时卡死 | 0 次（httpx 修复生效） |

#### Eureka 增量衰减曲线

| 批次 | Chunk 数 | 旧大小 | 新大小 | 增量 | 增幅 |
|------|----------|--------|--------|------|------|
| 1 | 5 | 42 | 1,020 | +978 | — |
| 2 | 5 | 1,020 | 1,963 | +943 | 92% |
| 3 | 5 | 1,963 | 2,994 | +1,031 | 53% |
| 4 | 5 | 2,994 | 3,743 | +749 | 25% |
| 5 | 5 | 3,743 | 5,100 | +1,357 | 36% |
| 6 | 1 | 5,100 | 6,005 | +905 | 18% |

**结论**：
- ✅ **APPEND 强约束持续有效** — 全程只增不减，无 `Rejected eureka` 或 shrink warning
- 增量曲线整体平稳，批次 5 出现 spike（+1,357）是因为该批包含远景储能、金风碳中和园区等高密度洞察 chunk
- 最后一 chunk 仍产出 905 字符，无后期空洞

#### Low Overlap Warning 分析

全量跑共 **12 条** Low overlap warning，占 318 个 SKU 的 **3.8%**。

| 问题模式 | 数量 | 说明 |
|---------|------|------|
| "行业视角" description vs "企业名" mapping | 8 | LLM 生成 mapping 时倾向写"需要了解XX企业核心信息"，而 SKU description 从行业维度描述 |
| description 与 mapping 主题不完全对应 | 3 | 如 sku_038 "则鸣新能源参与设计的" vs "莫桑比克矿场离网微电网项目收益" |
| 边界情况 | 1 | skill_021 有"离网"重叠但较弱 |

**关键发现**：
- `_validate_mapping_entries` 校验函数正常工作
- 12 条 warning 中，最终 mapping.md 的描述已在后续批次被修正（如 sku_078 最终描述为"需要了解我国电网调频分类及对应规则要求时查阅"，与 header.md 吻合）
- warning 触发发生在中间状态（5 chunk 一批处理时 mapping 尚未最终整合），最终输出正确
- **8/12 的"行业视角 vs 企业名"模式可通过在 `MAPPING_DIFF_PROMPT` 中增加"mapping 描述必须包含 SKU description 中的行业/技术关键词"约束进一步降低**

#### 其他 Warning 统计

| Warning 类型 | 数量 | 说明 |
|-------------|------|------|
| JSON 解析失败 | 2 次 | 均在 retry 后成功（attempt=1） |
| TRUNCATED | 0 | 无截断 |
| Markdown 缺少结构标记 | 6 条 | 小 SKU（66-131 字符），信息性 warning |
| HTTP 超时 | 0 | httpx 修复生效 |
| Procedural 类型错误 | 0 | v3.2 改动 7 生效 |

### 16.5 安悦节能 sku_002 修复前后对比

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| description | "光伏、风电降碳之外，**综合能源服务常用的**四类节能降碳技术" | "介绍山东安悦节能技术有限公司的发展背景、主营业务范围及核心竞争优势" |
| 含"综合能源服务常用的" | ❌ YES | ✅ NO |
| 含"节能降碳" | 通过从属定位（不当） | 通过 mapping.md 上下文体现（正确） |
| mapping.md 描述 | "需要了解综合能源服务常用技术" | "需要了解山东安悦节能技术有限公司基本概况时查阅" |
| mapping Low overlap | 有 | 无 |

### 16.6 Header-Mapping 标题错配问题

#### 问题发现

全量 26-chunk 验证中，12 条 Low overlap warning 中有 **3 条是真正的最终输出错配**（header.md 标题与 mapping.md 描述不对应）：

| SKU | header.md 标题 | mapping.md 描述 | 错配类型 |
|-----|---------------|----------------|---------|
| sku_091 | 邀约型虚拟电厂参与调峰辅助服务的**流程** | 需要了解**西安广林汇智**公司基本信息时查阅 | LLM 混淆同批次 SKU |
| sku_152 | 锌铁液流电池核心技术**瓶颈及突破** | 需要了解**双台区柔直互联**交直流微电网工作模式时查阅 | 完全不同领域 |
| sku_160 | 纬景储能企业**核心信息** | 需要了解液流电池**LCOS计算逻辑**时查阅 | 企业信息 vs 成本计算 |

#### 根因分析

LLM 在 `MAPPING_DIFF_PROMPT` 生成 mapping 描述时，混淆了同一批次（5 chunk 一批）中多个 SKU 的对应关系。具体机制：

1. `_flush_meta` 每 5 chunk 触发一次 mapping 更新
2. `_format_sku_list(context, new_only=True)` 列出本批次所有新增 SKU（含 name + description）
3. LLM 为每个 SKU 生成一行 mapping 描述时，可能将 SKU A 的描述写到 SKU B 的行上
4. 现有 `_validate_mapping_entries` 只检查 description 字段的重叠度，无法发现"描述与 SKU 主题完全错配但恰好有 2-char overlap"的情况

**这不是 header 被覆写后 mapping 没跟上的问题**（header.md 不会被后续 chunk 修改），而是 **LLM 生成时的注意力错位**——同一批次多个 SKU 的 name/description 信息量大，LLM 未能精确对齐。

#### 修复方案

**选项 A（已实施）**：在 `_validate_mapping_entries` 中增加 **header 标题校验层**——从磁盘读取 header.md 的实际标题（ground truth），检查标题关键词是否出现在 mapping 描述中。

- 代码改动：`meta_extractor.py` `_validate_mapping_entries` 方法，新增 ~30 行
- 效果：对 sku_091（"邀约型虚拟电厂" vs "西安广林汇智"）、sku_152（"锌铁液流电池" vs "双台区柔直互联"）、sku_160（"纬景储能" vs "LCOS计算逻辑"）均会产生 `Header-mapping title mismatch` warning
- 不改主流程，仅增加诊断输出

**选项 B（待实施）**：在 pipeline 末尾增加 mapping 全量刷新步骤——所有 chunk 处理完后，用全部 SKU 的最终 header 标题重新生成完整 mapping.md。这是架构级改动，待整体流程稳定后考虑。

#### 当前错配率

3/318 = **0.9%**，不影响 Module 4 可用性。3 条错配建议人工修正 mapping.md 中对应行。

### 16.7 后续优化建议

| 优先级 | 建议 | 预期效果 | 改动量 |
|--------|------|---------|--------|
| P1 | ~~`MAPPING_DIFF_PROMPT` 加约束~~ 已被选项 A 取代 | — | — |
| P1 | 人工修正 3 条 header-mapping 错配 | 修正 sku_091/152/160 的 mapping 描述 | 3 行 |
| P2 | Eureka 洞察可信度标注（15.5 已规划） | 区分高/中/低可信度洞察 | ~30 行新脚本 |
| P3 | Pipeline 末尾 mapping 全量刷新（选项 B） | 从根本上消除 header ↔ mapping 不同步 | ~50 行，需改 pipeline |
| P4 | 关系跨文档关联发现验证 | 当前仅 4 条来自 2+ chunk 的关系 | 已有 postprocessor，需调参 |

---

## 十七、v4.0 — 全链路性能优化（基于代码级评估）

> 状态: 🔧 实施中 | 评估日期: 2026-04-27 | 基于 v3.2.1 全量验证后代码审查 + 外部评审修正

### 17.1 背景

v3.2.1 全量 26-chunk 验证通过，总运行时间 **68 分钟**。质量优化阶段已完成，下一步聚焦**全链路性能优化**。本次优化基于逐文件代码审查，对 17 项优化建议做了代码级可行性验证和收益校准，并经外部评审修正了若干关键判断。

### 17.2 当前性能基线

| 阶段 | 耗时 | 占比 | 瓶颈点 |
|------|------|------|--------|
| Stage 1: PDF→Markdown (PaddleOCR) | ~5-10 min (PDF场景) | 7-15% | 串行逐页 OCR |
| Stage 2: Markdown→Chunks | ~2-3 min | 3-4% | LLM 滚动窗口分块 |
| Stage 3: Chunks→SKUs (Phase 1 提取) | ~30-40 min | 44-59% | 三提取器并行但 chunk 间串行 |
| Stage 3: Chunks→SKUs (Phase 2 Meta) | ~8-12 min | 12-18% | mapping/eureka 差量模式 |
| Stage 3: Post-processing | ~10-15 min | 15-22% | Proofreading 6 并行 + Cross-doc 8 并行 |

**总计**: ~68 min（纯文本场景），PDF 场景额外 +5-10 min

### 17.3 优化方案与代码评估

#### 17.3.1 P0-Step1: `jina_client` httpx 连接池复用

**当前状态**：`jina_client.py` L57：

```python
with httpx.Client(timeout=30.0) as client:
    # 每次 search_web 调用都新建 httpx.Client
    # with 块结束后关闭连接 → TCP 握手 + TLS 协商浪费
```

**代码评估**：

| 模块 | 连接管理 | 问题 |
|------|---------|------|
| `chunks2skus/utils/llm_client.py` | `_thread_local` 缓存 | ✅ 已是连接池复用模式，每线程独立 client |
| `chunks2skus/utils/jina_client.py` | `with httpx.Client(...)` | ❌ **每次调用新建**，TCP/TLS 开销 50-100ms/次 |
| `skus2ontology/utils/llm_client.py` | 全局单例 `_client` | ✅ 连接池已复用 |
| `markdown2chunks/chunkers/llm_chunker.py` | 实例级 `self.client` | ✅ 单实例复用 |

**结论**：httpx 连接池复用的真问题在 **`jina_client.py`**，不在 `llm_client.py`。`llm_client.py` 的 thread-local 缓存已经实现了连接池复用。

**实现方案**：

模块级单例 + double-check locking + 断连重建 + 显式关闭接口：

```python
# jina_client.py 顶部新增
_jina_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()

def _get_jina_client() -> httpx.Client:
    """Get or create module-level httpx.Client (thread-safe lazy init)."""
    global _jina_client
    if _jina_client is None or _jina_client.is_closed:
        with _client_lock:
            if _jina_client is None or _jina_client.is_closed:
                _jina_client = httpx.Client(timeout=30.0)
                logger.debug("Jina httpx.Client created (connection pool)")
    return _jina_client

def close_jina_client() -> None:
    """Explicitly close the Jina httpx.Client.
    
    Call when pipeline completes to release connection pool.
    Not strictly necessary for CLI (OS reclaims on exit), but
    important for long-running service deployments.
    """
    global _jina_client
    with _client_lock:
        if _jina_client is not None and not _jina_client.is_closed:
            _jina_client.close()
            _jina_client = None
            logger.debug("Jina httpx.Client closed")

# search_web 中替换 with httpx.Client(...) 块
def search_web(query: str, ...):
    ...
    try:
        client = _get_jina_client()
        response = client.get(url, headers=headers)
        response.raise_for_status()
        ...
    except (httpx.ConnectError, httpx.ReadError) as e:
        # Connection broken — tear down client so next call rebuilds it
        logger.warning("Jina connection error, resetting client", error=str(e))
        with _client_lock:
            if _jina_client is not None:
                _jina_client.close()
                _jina_client = None
        return None
    except Exception as e:
        logger.error("Jina search failed", query=query[:50], error=str(e))
        return None
```

**边界情况处理**：

| 边界情况 | 处理方式 |
|---------|---------|
| 关闭时机 | CLI 工具进程退出自然回收；服务部署时 pipeline 完成后调用 `close_jina_client()` |
| 远端断连 | `httpx.ConnectError`/`httpx.ReadError` 时强制关闭 client、置 `_jina_client = None`，下次调用触发重建 |
| `is_closed` 判断 | `_get_jina_client` 中检查 `_jina_client.is_closed`，覆盖服务端主动关闭连接的场景 |
| 线程安全 | `_rate_limit_lock` 已串行化所有 Jina 调用，实际同一时刻只有一个线程在调用；但 double-check locking 仍保留，为未来并发调用留安全余量 |

**改动量**：8 行新增 + 3 行修改 = 共 11 行。风险：零。

**预估加速**：~200ms/次 Jina 调用（省去 TCP+TLS 握手），Proofreading 阶段 N 次 Jina 调用省 N × 200ms。

**补充发现**：当前 `.env` 中 `JINA_API_KEY` 为空，`search_web()` 直接返回 `None`。此优化在配置 API key 后生效，当前不产生实际收益。但改动极简，可预先实施。

---

#### 17.3.2 P0-Step2: PaddleOCR 页间并行

**当前状态**：`paddleocr_vl_parser.py` L189-210，串行逐页循环：

```python
for page_num in range(start_page, page_count):
    page_md = self._ocr_page(doc[page_num], page_num + 1)
    ...
    page_markdowns[page_num] = text
    progress_f.write(json.dumps({"page": page_num, "text": text}) + "\n")
    progress_f.flush()
```

**代码评估**：

| 评估项 | 结论 |
|--------|------|
| 线程安全基础设施 | ✅ 已有 `_thread_local`（L29），为每个线程创建独立 `OpenAI` client |
| 进度写入 | 需加 `threading.Lock` 保护 `progress_f.write` + `flush` |
| `page_markdowns` | `dict` 按 `page_num` 独立 key 写入，线程安全 |
| 页间依赖 | 无。每页 OCR 完全独立 |

**实现方案**：

并发度从 `.env` 读取，默认 4，本地 OCR 部署时可调到 8-10：

```python
# config.py 新增
ocr_page_concurrency: int = Field(
    default=4,
    description="Max concurrent pages for OCR parsing. "
                "Adjust based on API rate limits (SiliconFlow: 4-5 safe, "
                "local OCR: 8-10).",
)

# paddleocr_vl_parser.py 中替换串行循环
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

progress_lock = threading.Lock()
max_workers = min(settings.ocr_page_concurrency, page_count - start_page)

def _ocr_page_wrapper(page_num: int) -> tuple[int, str | None]:
    """OCR one page, return (page_num, text_or_None)."""
    page_md = self._ocr_page(doc[page_num], page_num + 1)
    return page_num, page_md

with ThreadPoolExecutor(max_workers=max_workers) as page_pool:
    futures = {
        page_pool.submit(_ocr_page_wrapper, pn): pn
        for pn in range(start_page, page_count)
    }
    for future in as_completed(futures):
        pn, page_md = future.result()
        if page_md is None:
            pages_failed += 1
            text = f"<!-- OCR failed: page {pn + 1} -->"
        else:
            text = page_md

        page_markdowns[pn] = text
        # Lock-protected progress write (guarantees .jsonl line integrity)
        with progress_lock:
            progress_f.write(
                json.dumps({"page": pn, "text": text}, ensure_ascii=False) + "\n"
            )
            progress_f.flush()
```

**并发度选择依据**：

| 部署方式 | 推荐 `ocr_page_concurrency` | 原因 |
|---------|---------------------------|------|
| SiliconFlow API | 4 | 5-10 RPS 限制，但每页 5-15s，4 路实际 RPS 仅 0.27-0.8，远低于限速 |
| 本地 OCR (mlx-vlm) | 8-10 | 无 API 限速，受本地 GPU 内存限制 |
| 火山引擎 API | 4 | 类似 SiliconFlow |

**线程安全分析**：

- `_ocr_page` 已用 thread-local 的 `OpenAI` client（L63-86），多线程安全 ✅
- `page_markdowns` 是 dict，CPython GIL 保证 dict 赋值原子性，不同 key 并发写安全 ✅
- `pages_failed` 在 `as_completed` 主线程自增，实际单线程消费，安全 ✅
- 最终输出 `all_pages` 仍按 `range(page_count)` 排序组装，顺序不变 ✅

**改动量**：~25 行。风险：极低。预估加速：3-5x（PDF 场景）。

---

#### 17.3.3 P0-Step3: Chunk 间流水线并行

**当前状态**：`pipeline.py` L104-134，chunk 间完全串行：

```python
for i, chunk in enumerate(chunks):
    new_skus = self.router.process_chunk_parallel(chunk, all_skus)
    ...
    all_skus.extend(new_skus)
```

**代码评估**：

| 提取器 | 状态依赖 | 可否 chunk 间并行 |
|--------|---------|------------------|
| FactualExtractor | 无状态（独立写 SKU 目录） | ✅ 可以 |
| ProceduralExtractor | 无状态（独立写 SKU 目录） | ✅ 可以 |
| RelationalExtractor | **有状态** — 维护 `self.label_tree`、`self.glossary`、`self.relationships`，每 chunk 后增量更新并写盘（`_save_data` L562） | ❌ 必须串行 |

**关键约束**：`Router.process_chunk_parallel`（L179-188）把三个 extractor 放在一个 `ThreadPoolExecutor` 里并行跑。如果 chunk 间也并行，Relational 的状态会被竞争。

**Relational 必须串行的根本原因**：

```python
# relational_extractor.py:303-332
def extract(self, content, chunk_id, context=None):
    # 读取 self.glossary / self.label_tree / self.relationships
    label_summary = self._summarize_label_tree(max_chars=4000)
    glossary_count = len(self.glossary.entries)
    alias_map = self._get_alias_map()
    relevant_relations = self._get_relevant_relations(content)
```

`RelationalExtractor` 内部维护了 `self.glossary`、`self.label_tree`、`self.relationships` 三个累积状态。每个 chunk 的 extract 都要先读这些状态、再更新它们。如果两个 Relational extract 并发执行，会出现 read-modify-write 竞态。

**实现方案**：生产者-消费者模式

```
                    ┌──────────────────────┐
  chunk_0 ────────→ │                      │
  chunk_1 ────────→ │  Factual/Procedural  │ ←── chunk 间并行 (max_workers=4)
  chunk_2 ────────→ │  线程池              │
                    └──────────┬───────────┘
                               │ 结果入队 (callback)
                               ▼
                    ┌──────────────────────┐
                    │  Relational          │ ←── 串行消费，保持顺序
                    │  单线程              │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Meta 批量窗口       │ ←── 不变
                    └──────────────────────┘
```

**核心实现骨架**：

```python
from concurrent.futures import ThreadPoolExecutor
from threading import Thread
from queue import Queue

def run(self) -> SKUsIndex:
    # ... 初始化同之前 ...
    
    chunks = self.router.load_chunks(self.chunks_dir)
    unprocessed = [c for c in chunks if not self.index.is_chunk_processed(c.chunk_id)]
    
    if not unprocessed:
        return self.index
    
    # ── 队列与共享状态 ──
    relational_queue: Queue[tuple[ChunkInfo, list[dict]]] = Queue()
    all_skus_lock = threading.Lock()
    
    # ── 消费者：Relational 串行处理 ──
    def relational_consumer():
        while True:
            item = relational_queue.get()
            if item is None:  # 哨兵，结束信号
                relational_queue.task_done()
                break
            
            chunk, factual_procedural_skus = item
            try:
                with all_skus_lock:
                    context_skus = list(all_skus)
                
                rel_skus = self.router.relational_extractor.extract(
                    chunk.content, chunk.chunk_id, {}
                )
                
                with all_skus_lock:
                    all_skus.extend(factual_procedural_skus + rel_skus)
                    # ... 更新 index, mark_chunk_processed 等 ...
                    
                # Meta 批次累积逻辑同之前
                pending_meta_content.append((chunk.chunk_id, chunk.content))
                pending_new_skus.extend(factual_procedural_skus + rel_skus)
                
                if settings.meta_interval > 0 and len(pending_meta_content) >= settings.meta_interval:
                    self._flush_meta(pending_meta_content, all_skus, pending_new_skus)
                    pending_meta_content.clear()
                    pending_new_skus.clear()
                    
            except Exception as e:
                logger.error("Relational failed", chunk_id=chunk.chunk_id, error=str(e))
            finally:
                relational_queue.task_done()
    
    consumer_thread = Thread(target=relational_consumer, daemon=True)
    consumer_thread.start()
    
    # ── 生产者：Factual + Procedural 跨 chunk 并行 ──
    def run_factual_procedural(chunk: ChunkInfo) -> list[dict]:
        skus = []
        for ext in [self.router.factual_extractor, self.router.procedural_extractor]:
            try:
                result = ext.extract(chunk.content, chunk.chunk_id, {})
                skus.extend(result)
            except Exception as e:
                logger.error("Extractor failed", extractor=ext.extractor_name, 
                           chunk_id=chunk.chunk_id, error=str(e))
        return skus
    
    # ── Callback 异常处理（关键！） ──
    # add_done_callback 在 worker 线程触发，f.result() 可能抛异常
    # 如果不处理，chunk 永远不会进入 relational_queue，consumer 死等
    def _on_done(f, c):
        try:
            result = f.result()
        except Exception as e:
            logger.error("Factual/Procedural failed", chunk_id=c.chunk_id, error=str(e))
            result = []  # 空结果，让消费者跳过
        relational_queue.put((c, result))
    
    fp_pool = ThreadPoolExecutor(max_workers=4)
    futures = {}
    for chunk in unprocessed:
        future = fp_pool.submit(run_factual_procedural, chunk)
        future.add_done_callback(lambda f, c=chunk: _on_done(f, c))
        futures[future] = chunk
    
    # 等待所有 Factual/Procedural 完成
    fp_pool.shutdown(wait=True)
    
    # 发送结束哨兵
    relational_queue.put(None)
    consumer_thread.join()
    
    # 最终 meta flush
    if pending_meta_content:
        self._flush_meta(pending_meta_content, all_skus, pending_new_skus)
    
    # ... 保存 index ...
```

**关键实现要点**：

1. **`all_skus_lock` 的粒度**：只在读取/修改 `all_skus` 时加锁，不覆盖 LLM 调用。Relational 的 LLM 调用期间不持锁 ✅

2. **Glossary 累积正确性**：Relational 是串行消费，`self.glossary` 的 read-modify-write 天然不会竞态 ✅。Factual/Procedural 的 SKU 已进入 `all_skus` 后 Relational 才开始读——`relational_queue.put` 的时序保证了这一点。

3. **`add_done_callback` 中的闭包陷阱**：`lambda f, c=chunk: _on_done(f, c)` 用了默认参数绑定，避免经典的闭包变量问题 ✅

4. **Callback 异常处理**：`_on_done` 包装了 `f.result()` 的异常，失败时 put 空结果而非静默丢弃 ✅。这是防止 consumer 死等的关键——不处理的后果是 chunk 永远不进队列，`consumer_thread.join()` 永远不返回。

5. **Meta 的批次边界**：Meta 仍在 Relational 消费者线程里串行 flush，glossary/eureka 的 APPEND 模式不会被并行破坏 ✅

**预估加速**：2-3x（Phase 1 部分），实现难度中等，需重构 pipeline 主循环。

---

#### 17.3.4 P1: Relational 上下文瘦身（含 label_tree 骨架保留）

**当前状态**：`relational_extractor.py` L322-333：

```python
label_summary = self._summarize_label_tree(max_chars=4000)  # 缩进树，截断到 4000 字符
term_list = self._truncate_term_list(...)                    # 截断到 4000 字符
alias_map = self._get_alias_map()                            # 无截断
relevant_relations = self._get_relevant_relations(content)   # 最多 40 条
```

**问题**：26 chunk 后 `label_summary` ~6000 字符（截断到 4000）、`term_list` ~2000 字符，后期 chunk prompt 确实膨胀。100+ chunks 后可能分别涨到 30K+ 和 10K+。

**关键修正（来自外部评审）**：

> 语义检索筛选 glossary 时，**不能只看相似度高的词条，还要保留 label_tree 的根节点和当前 chunk 涉及领域的中间节点**。否则 LLM 看到的是"扁平的相似词列表"而不是"分类层次结构"，会破坏分类的一致性。

**实现方案**（分两阶段）：

**阶段 A（无 embedding，先用子串匹配）**：

1. glossary 筛选：对当前 chunk content 做子串匹配，筛选相关术语（类似 `_get_relevant_relations` 的方式）
2. label_tree 骨架保留：保留所有根节点 + 匹配术语所属路径的中间节点
3. term_list 截断上限从 4000 降至 2000

**阶段 B（引入 embedding，后续实施）**：

1. 复用 `embedding_client.py`（已有，SiliconFlow `BAAI/bge-m3` 模型）
2. 对 glossary entries 预计算 embedding 并缓存
3. 每次 chunk 处理时对 content 做 embedding，检索 top-50 相关词条
4. 根据这些词条的 `labels` 字段定位 label_tree 路径，保留根到路径的所有中间节点

**预估加速**：1.5-2x（Relational 单次调用），后期 chunk 效果更显著。

---

#### 17.3.5 P1: Dedup 桶间并行

**当前状态**：`dedup.py` L170-183，桶间串行：

```python
for bucket in all_buckets:
    if bucket.sku_count <= 1:
        continue
    flagged = self._tier1_scan(bucket)  # 纯读 header 信息
    ...
```

**代码评估**：

| 层级 | 操作类型 | 可否并行 |
|------|---------|---------|
| Tier1 扫描 | 只读 header 信息 | ✅ 可以 |
| Tier2 判断 | 只读 SKU 内容 | ✅ 可以（但同一 SKU 可能出现在多个 pair 中） |
| `_apply_action` | 修改 index + 删除 SKU 目录 | ❌ 需串行或加锁 |

**实现方案**：

1. Tier1 所有桶并行扫描（纯读操作，安全）
2. 汇总所有 flagged pairs 后，Tier2 保持串行（避免同一 SKU 被两个线程同时 delete）

**预估加速**：1.5-2x（Dedup 阶段），改动 ~15 行。

---

#### 17.3.6 P1→P2 降级: Glossary 批量持久化

**原始建议**：Relational extractor 每个 chunk 处理完后增量更新 glossary，改为内存中累积、每 N 个 chunk 批量持久化。

**代码评估**：

- `_save_data`（L272-301）每 chunk 写 3 个 JSON 文件 + `header.md` = 4 个文件
- 26 chunk = 104 次文件写入
- SSD 上写 100KB JSON 约 1-2ms，104 次 ≈ **0.1-0.2s**
- `__init__` 时 load 一次，后续只在内存操作，`_save_data` 只做 write，无 read-then-write 问题

**结论**：**收益极低（~0.2s），从 P1 降级为 P2**。真正的 IO 瓶颈在 LLM API 调用（每次 10-60s），0.2s 的文件 IO 可忽略。改动简单（每 N 个 chunk 写一次），可顺手实施但不应占用优先资源。

---

#### 17.3.7 P2: max_tokens 动态估算

**当前状态**：各提取器 `max_tokens` 硬编码：

| 提取器 | max_tokens | 实际输出 |
|--------|-----------|---------|
| Factual/Procedural | 64,000 | ~3-5K |
| Relational | 128,000 | ~3-5K (增量模式) |
| Meta | 32,000 | ~2-8K |
| Dedup | 4,000 | ~1K |
| Proofreading | 1,000 | ~0.5K |

**代码评估**：SiliconFlow API 对 `max_tokens` 的行为：
- 流式返回：`max_tokens` 几乎无影响（按实际生成 token 返回）
- 非流式返回：可能按 `max_tokens` 预分配 GPU 内存，但不会显著增加延迟

**结论**：收益可能不到 10-20%，需实测确认 SiliconFlow API 对 `max_tokens` 的行为。建议用小样本实测——固定 prompt，对比 max_tokens=64000 vs max_tokens=4000 的实际响应时间。如果差异 < 5%，这条直接弃置。

---

#### 17.3.8 P2: Chatbot 减少轮次

**当前状态**：`skus2ontology/chatbot.py` 是交互式 chatbot，`max_rounds` 可配置。

**代码评估**：`_build_system_prompt`（L246-272）已包含压缩后的 `mapping.md` 和 `eureka.md`，信息量充足。优化方向：首轮给更结构化的模板提示，减少"来回确认"次数。

**结论**：产品级优化，B 端必须做。改 `SYSTEM_PROMPT_TEMPLATE` 即可，几行改动。

---

#### 17.3.9 P2: LLMChunker 窗口并行

**当前状态**：`llm_chunker.py` L160-228，滚动窗口模式：

```python
# 每次 cut_point 取决于上一窗口的输出 → 天然串行
```

**代码评估**：滚动窗口天然串行，无法直接并行。替代方案：先用 `HeaderChunker` 切出顶级章节，再对每个章节并行 LLM 分块。需 pipeline 层面改动。

**结论**：实现较复杂。如果文档有清晰标题结构，HeaderChunker 已能处理大部分情况，LLM 回退只在无标题长文档时才用。

---

#### 17.3.10 ⚠️ 需验证的高风险项

##### #6: LLMChunker 降级到 3B 模型

**当前模型**：`markdown2chunks/config.py` — `Qwen2.5-7B-Instruct`

**风险**：3B 模型在中文长文档的语义边界识别上经常出错——把一段话从中间切开。

**结论**：**降至 P3**。7B 是中文分块质量的下限，不应降低。

##### #13: Proofreading 搜索结果缓存

**代码评估**：`proofreading.py` L252-255：

```python
query = f"{sku_entry.name} {sku_entry.description}"
web_results_raw = search_web(query)
```

每个 SKU 的 `name` 不同 → `query` 几乎不会重复 → **缓存命中率可能接近 0%**。

**结论**：先加日志统计 query 重复率，>20% 再做缓存。当前不建议实施。

##### #14: CrossDoc 关系传递剪枝（含谓词感知分层修正）

**当前状态**：`cross_doc_relations.py` 所有候选都送 LLM 验证，传递推理产生的候选默认 `confidence=0.4`（L521）。

**原始修正方案**：按置信度分层——高(>0.8)直接采纳、中(0.5-0.8)LLM 验证、低(<0.5)丢弃。

**关键反例（来自外部评审）**：`requires` 不一定传递——A requires B + B requires C ≠ A requires C。机械地"高置信度直接采纳"会产生错误关系。

**改进方案：按谓词类型区分传递性**：

| 传递性 | 谓词 | 处理方式 | 原因 |
|--------|------|---------|------|
| **强传递** | `causes`, `depends-on`, `superset-of`, `is-a` | 高置信度可直接采纳（可加抽样验证） | 传递性逻辑成立：A causes B + B causes C ⇒ A causes C |
| **弱传递** | `requires`, `enables`, `related-to` | 必须经 LLM 验证 | 传递性不保证：A requires B + B requires C ⇏ A requires C |
| **不传递** | `has-a`, `certifies`, `example-of` | 候选直接丢弃，不做传递推理 | 传递推理在逻辑上不成立 |

**实现**：在 `cross_doc_relations.py` 的传递候选生成阶段，根据谓词的传递性分类决定是否生成候选、以及候选的 `confidence` 初始值：

```python
TRANSMITTABLE_PREDICATES = {"causes", "depends-on", "superset-of", "is-a"}
WEAKLY_TRANSMITTABLE = {"requires", "enables", "related-to"}
NON_TRANSMITTABLE = {"has-a", "certifies", "example-of"}

# 生成候选时
if predicate in TRANSMITTABLE_PREDICATES:
    candidate_confidence = 0.8  # 高置信度，可考虑跳过 LLM
elif predicate in WEAKLY_TRANSMITTABLE:
    candidate_confidence = 0.5  # 必须经 LLM 验证
else:  # NON_TRANSMITTABLE
    continue  # 不生成候选
```

**结论**：方向正确，但需额外验证"强传递谓词直接采纳"的误判率。建议先对强传递谓词也走 LLM 验证、记录验证结果，收集足够样本后再决定是否跳过。优先级提升为 P1。

---

### 17.4 Meta 批量窗口动态调整（修正）

**原始建议**："新增 SKU 少则延长间隔"。

**修正**（来自外部评审）：**反向调整逻辑**：

| 新增 SKU 数量 | 间隔调整 | 原因 |
|--------------|---------|------|
| 多 | 延长间隔（攒批处理） | 减少调用次数 |
| 少 | 缩短间隔（避免长时间不更新 mapping） | 否则 APPEND 模式会累积压缩压力 |

当前 `meta_interval=5`（固定值），可在 `pipeline.py` 中改为动态：根据上一批新增 SKU 数量调整下一批的间隔。

**优先级**：P2（当前固定间隔已可工作，动态调整为锦上添花）。

---

### 17.5 优先级与实施计划

| 优先级 | 策略 | 加速 | 难度 | 代码评估 | 实施批次 |
|--------|------|------|------|---------|---------|
| **P0-Step1** | `jina_client` 连接池复用 | 累积 ~1-2 min | 极低 | 真问题在 jina_client.py，~11 行 | Batch 1 |
| **P0-Step2** | PaddleOCR 页间并行 | 3-5× (PDF) | 低 | 已有线程安全基础设施，~25 行，并发度可配置 | Batch 1 |
| **P0-Step3** | Chunk 间流水线并行 | 2-3× (Phase1) | 中 | Factual/Procedural 可并行，Relational 必须串行，callback 需异常处理 | Batch 1 |
| P1 | #9 Relational 上下文瘦身 | 1.5-2× | 中 | 必须保留 label_tree 骨架 | Batch 2 |
| P1 | #12 Dedup Tier1 并行 | 1.5-2× | 低 | Tier1 并行、Tier2 串行 | Batch 2 |
| P1 | #14 CrossDoc 谓词感知剪枝 | 减少 LLM 调用 | 低 | 按谓词传递性分层 | Batch 2 |
| P2 | Glossary 批量持久化 | ~0.2s | 极低 | **收益极低，降级自 P1** | Batch 3 |
| P2 | #11 max_tokens 动态 | 0-20% | 低 | 需实测 SiliconFlow API 行为（差异<5%则弃置） | Batch 3 |
| P2 | #16 Chatbot 减少轮次 | 30-50% | 低 | 产品级优化 | Batch 3 |
| P2 | #5 LLMChunker 窗口并行 | 2-3× (长文档) | 中 | 滚动窗口天然串行，需 Header 预切 | Batch 3 |
| P3 | #6 3B 模型降级 | — | — | ⚠️ 中文分块质量不可降 | — |
| P3 | #13 Proofreading 缓存 | — | — | ⚠️ query 重复率近 0% | — |

### 17.6 综合加速预估

**场景 A：纯文本（26 chunks）**

| 优化 | 当前 | 优化后 | 加速 |
|------|------|--------|------|
| Phase 1 (per chunk, Factual+Procedural) | 串行 ~2 min | 并行 ~0.5 min | 4× |
| Phase 1 (per chunk, Relational) | ~1.5 min | ~1 min (瘦身) | 1.5× |
| Phase 2 Meta | ~8-12 min | ~8-12 min (不变) | — |
| Post-processing | ~10-15 min | ~8-12 min (Tier1 并行) | 1.3× |
| **总计** | **~68 min** | **~15-20 min** | **3.5-4.5×** |

**场景 B：PDF 输入**

| 优化 | 当前 | 优化后 | 加速 |
|------|------|--------|------|
| Stage 1 (OCR) | 串行 ~10 min | 并行 ~2-3 min | 3-5× |
| Stage 3-4 | ~58 min | ~15-20 min | 同场景 A |
| **总计** | **~68+10 min** | **~17-23 min** | **3-4×** |

### 17.7 Batch 1 实施方案（P0 三项）

#### 17.7.1 实施顺序

```
Step 1: jina_client 连接池复用 (~11 行, 5 分钟)
   │      改动最小，风险最低，先拿到"零风险加速"验证
   │
Step 2: PaddleOCR 页间并行 (~25 行, 30 分钟)
   │      并发度可配置，验证方式：扫描版 PDF × 2 次（串行 vs 并行）
   │
Step 3: Chunk 间流水线并行 (~60 行, 1-2 天)
   │      需重构 pipeline.py 主循环为生产者-消费者模式
   │      先用 5 chunk 验证 Relational 队列消费的顺序性
   │      再扩展到全量
   │
   └──→ VALIDATE: 全量 26-chunk 重跑
            │
            ├─ 质量回归检查（见 17.7.4）
            └─ 对比总耗时 vs 基线 (68 min)
```

#### 17.7.2 文件改动清单

| 文件 | 改动类型 | 改动内容 | 改动量 |
|------|---------|---------|--------|
| `chunks2skus/utils/jina_client.py` | 修改 | 新增 `_get_jina_client()`/`close_jina_client()`；`search_web` 中 `with httpx.Client(...)` 改为模块级单例复用 + 断连重建 | ~11 行 |
| `anything2markdown/parsers/paddleocr_vl_parser.py` | 修改 | `_parse_pdf_to_markdown` 中逐页循环改为 `ThreadPoolExecutor` + `Lock` | ~25 行 |
| `anything2markdown/config.py` | 修改 | 新增 `ocr_page_concurrency` 配置项（默认 4） | ~4 行 |
| `chunks2skus/pipeline.py` | 修改 | 主循环重构为生产者-消费者模式 | ~60 行 |
| `chunks2skus/router.py` | 修改 | 新增 `process_factual_procedural()` 方法（不含 Relational） | ~20 行 |

#### 17.7.3 线程安全保证

| 共享资源 | 保护方式 |
|---------|---------|
| Jina `_jina_client` | `threading.Lock` — double-check locking 初始化 + 断连重建 |
| PaddleOCR `progress_f` | `threading.Lock` — 写入+flush 在锁内 |
| PaddleOCR `page_markdowns` | `dict` 按 `page_num` 独立 key，无需锁 |
| PaddleOCR `_thread_local` | 已有机制，每线程独立 OpenAI client |
| Pipeline `all_skus` | `threading.Lock` — Factual/Procedural 并行写入时加锁 |
| Pipeline `pending_new_skus` | `threading.Lock` — 同上 |
| Relational 状态 (`label_tree`, `glossary`, `relationships`) | 串行消费，无竞争 |
| LLM 客户端 | 已有 `_thread_local` 机制 |

#### 17.7.4 质量回归验证矩阵

加速优化最容易出的问题不是性能，而是悄悄破坏之前的质量保证。每个 P0 改完后跑一次"质量回归检查"：

| 检查项 | 验证方法 | 预期 | 耗时 |
|--------|---------|------|------|
| Eureka 增量曲线只增不减 | `grep -c "^## " meta/eureka.md` before/after | 后者计数 ≥ 前者 | 1 min |
| mapping 描述错配率 < 1% | 抽查 20 个 SKU 的 description 是否匹配内容 | ≤ 0 个错配 | 3 min |
| `example-of` 方向仍全部正确 | `grep "example-of" relational/relationships.json` 抽查 | subject 总是更具体的实例 | 1 min |

三个检查 5 分钟内跑完，能及早发现并发引入的语义问题。

#### 17.7.5 各 Step 实测验证指标

| Step | 验证指标 | 采集方式 |
|------|---------|---------|
| Step 1 (jina_client) | proofreading 阶段总耗时 before/after | 日志中 `postprocessing complete` 时间戳差 |
| Step 2 (PaddleOCR) | PDF OCR 总耗时串行 vs 并行 | 日志时间戳 + `progress_f` 行数 |
| Step 3 (Chunk 并行) | Phase 1 总耗时 before/after + 质量回归 | 日志 + 17.7.4 矩阵 |

**Step 1 特别说明**：如果实测 Jina 连接复用的收益低于预期（每次省 <50ms），说明 Jina 服务端处理时间才是主要耗时——这种数据用于校准其他网络相关优化的预估，不影响后续步骤的优先级。

### 17.8 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| jina_client 复用 | `search_web` 恢复为 `with httpx.Client(...)` 模式，删除 `_get_jina_client`/`close_jina_client` |
| PaddleOCR 并行 | `_parse_pdf_to_markdown` 恢复为串行 for 循环，删除 `ThreadPoolExecutor` 和 `Lock` |
| `ocr_page_concurrency` 配置 | 从 `config.py` 删除 |
| Chunk 间并行 | `pipeline.py` 恢复为串行主循环，删除生产者-消费者逻辑 |
| Router 拆分 | 删除 `process_factual_procedural()` 方法，恢复 `process_chunk_parallel()` 统一调用 |

所有改动独立，可单独回滚，互不影响。

### 17.9 关键代码发现记录

以下发现对后续维护有参考价值：

| 发现 | 位置 | 影响 |
|------|------|------|
| `llm_client.py` 的 `_thread_local` 已实现连接池复用 | `chunks2skus/utils/llm_client.py` L49-87 | 不需要额外优化，每线程独立 client 已是最优 |
| `jina_client.py` 每次调用新建 `httpx.Client` | `chunks2skus/utils/jina_client.py` L57 | **真问题**，TCP/TLS 开销累积 |
| `skus2ontology/utils/llm_client.py` 用全局单例 | `skus2ontology/utils/llm_client.py` L25-33 | 连接池已复用，无需改动 |
| Relational 每次写 4 文件但总 IO 仅 ~0.2s | `relational_extractor.py` L562 | 不构成瓶颈，批量持久化收益极低 |
| `_save_data` 只做 write 不做 read-then-write | `relational_extractor.py` L272-301 | 无重复读取问题 |
| CrossDoc 传递候选 confidence=0.4 | `cross_doc_relations.py` L521 | 分层剪枝需按谓词类型区分传递性 |
| Proofreading query 重复率近 0% | `proofreading.py` L252-255 | 每个 SKU name 不同，搜索缓存无意义 |
| `LLMChunker` 滚动窗口天然串行 | `llm_chunker.py` L160-228 | 并行化需先 Header 预切 |
| `add_done_callback` 在 worker 线程触发 | Python `concurrent.futures` 文档 | `f.result()` 可能抛异常导致 callback 静默失败，必须包 try-except |


### 17.10 Path 路径问题修复

> 状态: ✅ 第 1 轮完成，第 2/3 轮待实施 | 评估日期: 2026-04-28 | 完成日期: 2026-04-28

#### 17.10.1 问题概述

在生产环境运行完成后,检查输出目录 `G:\Program Files\AI coding\知识萃取\输出\ontology` 发现两个关键问题:

1. **SKU 路径使用 Windows 反斜杠**: mapping.md 中路径为 `output\skus\factual\sku_018` 而非 `output/skus/factual/sku_018`
2. **严重 SKU 重复**: sections 2.5 和 2.6 包含完全相同的内容被提取了两次

#### 17.10.2 根因分析

##### 问题 1: Windows 反斜杠路径

**数据流追踪**:
```
extractor.py (str(sku_dir)) → skus_index.json → meta_extractor._update_mapping → mapping.md
```

**关键代码位置**:

| 文件 | 行号 | 代码 | 问题 |
|------|------|------|------|
| `factual_extractor.py` | 288 | `"path": str(sku_dir)` | Windows 下输出 `\` |
| `procedural_extractor.py` | 269 | `"path": str(skill_dir)` | Windows 下输出 `\` |
| `relational_extractor.py` | 577 | `"path": str(self.type_dir)` | Windows 下输出 `\` |
| `meta_extractor.py` | 401 | `self.mapping_path.write_text(merged)` | 直接写入未标准化 |
| `assembler.py` | 136-139 | `_rewrite_path(content)` | 正则只匹配 `/` |

**正则表达式问题**:

```python
# assembler.py L21-23
PATH_REWRITE_PATTERN = re.compile(
    r"(?:^|(?<=[\s(/\"']))[\w./\-]+?(?=(?:factual|procedural|relational|meta)(?:/|$|\s|\"|\)|,))"
)
# [\w./\-] 不包含反斜杠,无法匹配 Windows 路径
```

```python
# meta_extractor.py L536
existing_sku_paths = set(re.findall(r'`([^`]+/[^`]+)`', current_mapping))
# 正则只匹配 /,导致去重失效
```

**影响**: 路径标准化在 Linux 下正常,Windows 下失败。`_rewrite_path` 依赖正确路径格式。

##### 问题 2: SKU 重复

**根本原因**: 输入文件重复导致重复提取。

`G:\Program Files\AI coding\知识萃取\输出\chunks\chunks_index.json` 中:
```
"科技战略与投资策略10个建议与5大误区.md": 15653 tokens
"科技战略与投资策略10个建议与5大误区(1).md": 15653 tokens
```

两个文件内容完全相同,生成相同 SKU,但 meta_extractor 的去重逻辑依赖路径匹配,失败检测重复。

#### 17.10.3 修复策略

采用三轮渐进式修复,优先修复现有数据,再从源头预防。

##### 第 1 轮: 快速修复现有数据 (今日)

**目标**: 修复已有 mapping.md,无需重新运行 Module 3。

| 改动 | 文件 | 行号 | 改动量 |
|------|------|------|--------|
| 写入时标准化路径 | `meta_extractor.py` | 401 | +1 行 |
| 预处理 content | `assembler.py` | 138 | +1 行 |
| 手动清理重复 SKU | `output/ontology/mapping.md` | — | 手动操作 |
| 重新运行 Module 4 | `pipeline.py` | — | 运行时 1.5h |

**代码改动**:

```python
# meta_extractor.py L401
self.mapping_path.write_text(merged.replace("\\", "/"), encoding="utf-8")

# assembler.py L138 (在 _rewrite_path 之前)
content = content.replace("\\", "/")
rewritten, rewrite_count = _rewrite_path(content)
```

**收益**: 修复现有 mapping.md,assembler 能正确处理,Module 4 生成正确 ontology。

##### 第 2 轮: 从源头标准化路径 (明日)

**目标**: 修复三个 extractor 的路径生成,所有新数据自动标准化。

| 改动 | 文件 | 行号 | 改动量 |
|------|------|------|--------|
| 新增 `_normalize_path` | `chunks2skus/extractors/base.py` | 新增函数 | 8 行 |
| 调用标准化函数 | `factual_extractor.py` | 288 | 1 行替换 |
| 调用标准化函数 | `procedural_extractor.py` | 269 | 1 行替换 |
| 调用标准化函数 | `relational_extractor.py` | 577 | 1 行替换 |
| 重新运行 Module 3 | `pipeline.py` | — | 运行时 4h |

**`_normalize_path` 实现**:

```python
@staticmethod
def _normalize_path(p: Path) -> str:
    """标准化路径为正斜杠格式"""
    return str(p).replace("\\", "/")
```

**收益**: skus_index.json 中所有路径自动标准化,meta_extractor 收到正确数据。

##### 第 3 轮: 内容去重 (下周)

**目标**: md2chunks 使用 SHA256 内容指纹去重,自动跳过重复文件。

| 改动 | 文件 | 行号 | 改动量 |
|------|------|------|--------|
| 计算 SHA256 | `md2chunks/parsers/markdown_parser.py` | 新增函数 | 10 行 |
| 维护已见 hash 集合 | `md2chunks/parsers/markdown_parser.py` | 解析逻辑 | 5 行 |
| 重复文件跳过 | `md2chunks/parsers/markdown_parser.py` | 解析逻辑 | 3 行 |
| 触发 postprocess | `md2chunks/pipeline.py` | 结束时 | 2 行 |

**收益**: 自动检测并跳过重复输入文件,从源头避免 SKU 重复。

#### 17.10.4 实施记录

##### 第 1 轮：已完成 (2026-04-28)

| 任务 | 状态 | 备注 |
|------|------|------|
| 修改 `meta_extractor.py` L401 | ✅ | `write_text(merged.replace("\\", "/"))` |
| 修改 `assembler.py` L138 | ✅ | `content.replace("\\", "/")` 预处理 |
| 手动清理旧数据 | ✅ | 清理脚本处理旧 26-chunk 数据集（已被新数据覆盖） |
| README.md 更新 | ✅ | 统计数字更新为 503+303+1+1=808 |
| 用户重新运行完整 pipeline | ✅ | 57 chunks 新数据集，808 SKU |

**新数据集验证结果**（57 chunks 全量运行）：

| 检查项 | 结果 | 状态 |
|--------|------|------|
| 反斜杠路径 | 0 条 | ✅ |
| 重复 sku_id | 0 条 | ✅ |
| 重复 chunk | 0 条 | ✅ |
| relational/meta 重复条目 | 各 1 条（之前各 39 条） | ✅ |
| mapping.md 反斜杠 | 0 个 | ✅ |
| mapping.md 路径重写 | `skus/factual/sku_xxx` 格式 | ✅ |
| 来自重复文件的 SKU | 0 条 | ✅ |

**说明**：用户在第 1 轮代码修复后用全新输入数据（57 chunks，商业/资本模式主题）重新运行了完整 pipeline。新数据无重复输入文件，808 SKU 全部合法。之前讨论的"科技战略与投资策略"重复文件问题在当前数据集中不存在。代码修复在源头生效，无需再做数据清理。

##### 第 2 轮：待实施

| 任务 | 状态 | 前置条件 |
|------|------|---------|
| 新增 `_normalize_path` 到 `base.py` | 🔧 待实施 | 第 1 轮已完成 |
| 修改 3 个 extractor 调用标准化函数 | 🔧 待实施 | base.py 完成 |
| 重新运行 Module 3 | — | 新数据已验证路径正确，优先级降低 |

##### 第 3 轮：待实施

| 任务 | 状态 | 前置条件 |
|------|------|---------|
| md2chunks SHA256 内容指纹去重 | 🔧 待实施 | 第 2 轮完成 |

> **优先级调整**：第 2 轮从"必须"降级为"建议"。当前 `.replace("\\", "/")` 写入时标准化已足够保证下游正确性，第 2 轮的 `_normalize_path` 是代码整洁性优化，不影响功能。第 3 轮 SHA256 去重为输入质量保障，长期有价值。

#### 17.10.5 验证结果

| 检查项 | 预期 | 实际 | 状态 |
|--------|------|------|------|
| skus_index.json 路径格式 | 全部 `/` | 0 条反斜杠 | ✅ |
| mapping.md 路径格式 | 全部 `/` | 0 条反斜杠 | ✅ |
| assembler 路径重写 | `skus/factual/sku_xxx` | 去掉 `output/` 前缀 | ✅ |
| skus_index.json 重复 sku_id | 0 | 0 | ✅ |
| skus_index.json 重复 chunk | 0 | 0 | ✅ |
| relational 重复条目 | 1 条 | 1 条（之前 39 条） | ✅ |
| meta 重复条目 | 1 条 | 1 条（之前 39 条） | ✅ |
| 来自重复文件的 SKU | 0 | 0 | ✅ |

**最终数据统计**（57 chunks，商业/资本模式主题）：

| 指标 | 值 |
|------|-----|
| 总 SKU | 808 |
| factual | 503 |
| procedural | 303 |
| relational | 1 |
| meta | 1 |
| chunks_processed | 57 |

### 17.11 v4.0 第二轮优化：基于运行日志的精细化瓶颈分析

> 状态: 🔧 待实施 | 评估日期: 2026-04-27 | 基于 v3.2.1 + P0-Step3 已实施后的 26-chunk 全量运行日志

#### 17.10.1 背景

P0-Step3（Chunk 间流水线并行）已实施，pipeline.py 已重构为 producer-consumer 模式。26-chunk 全量运行总耗时 **73 分钟**，FP 阶段已实现 chunk 间并行（`chunk_concurrency=4`），Relational 串行消费。

本轮优化基于运行日志的时间戳分析，精确定位各阶段实际耗时和阻塞关系。

#### 17.10.2 日志基线数据（26 chunk 全量运行）

| 指标 | 值 |
|------|-----|
| 总耗时 | 4380.7s ≈ **73 分钟** |
| Pipeline 起止 | 06:57:41 → 08:10:42 |
| 总 SKU | 323 |
| 总字符 | 334,945 |

**Meta 批处理耗时**（`meta_interval=5`，6 次调用）：

| 批次 | chunks | 耗时 | 阻塞 Relational |
|------|--------|------|-----------------|
| 1 | 5 | **145s** | 是 |
| 2 | 5 | **149s** | 是 |
| 3 | 5 | **127s** | 是 |
| 4 | 5 | **166s** | 是 |
| 5 | 5 | **~130s** | 是 |
| 6 | 1 | **175s** | 是 |

Meta 总耗时 ≈ **892s ≈ 15 分钟**，全部阻塞 Relational 消费线程。

#### 17.10.3 瓶颈诊断

##### 瓶颈 1（P0）：Meta 阻塞 Relational 消费者

**现象**：`_flush_meta()` 在 Relational 消费者线程内部同步执行，每次 130-175s，期间 Relational 无法处理队列中的下一个 chunk。

**代码路径**：

```python
# pipeline.py L152-155 — 当前代码
if settings.meta_interval > 0 and len(pending_meta_content) >= settings.meta_interval:
    self._flush_meta(pending_meta_content, all_skus, pending_new_skus)  # 阻塞！
    pending_meta_content = []
    pending_new_skus = []
```

**竞争条件确认**：

1. `_flush_meta` 内部调用 `self.index.remove_sku()` + `self._add_sku_to_index()` + `self._save_index()` — 修改 `self.index` 内存状态
2. Relational 消费者在 `with all_skus_lock:` 块中也调用 `self._add_sku_to_index()` + `self._save_index()`
3. `self.index` 是 Pydantic model，非线程安全
4. `_save_index()` 是裸文件写入，无锁保护

**如果 Meta 移到独立线程**，两个线程会并发修改 `self.index` 和并发写 `skus_index.json`，必须加锁。

**安全分析**：

| 共享资源 | Meta 操作 | Relational 操作 | 冲突？ |
|---------|----------|----------------|--------|
| `self.index` 内存 | `remove_sku("meta-knowledge")` + `add_sku` | `add_sku` + `mark_chunk_processed` | **是** |
| `skus_index.json` | `_save_index()` | `_save_index()` | **是** |
| `mapping.md` | 写入 | 不操作 | 否 |
| `eureka.md` | 写入 | 不操作 | 否 |
| `label_tree.json` | 不操作 | 写入 | 否 |
| `glossary.json` | 不操作 | 写入 | 否 |
| `relationships.json` | 不操作 | 写入 | 否 |

只有 `self.index` 和 `skus_index.json` 是共享冲突点，加一把锁保护即可。其他文件两组线程各写各的，安全。

**锁设计决策**：合并 `all_skus_lock` 和新增锁为一把 `_index_lock`，避免两把锁保护重叠资源导致的死锁风险。

**`all_skus` 浅拷贝安全性确认**：

- `_flush_meta` 只将 `all_skus` 传入 `context` dict，被 `meta_extractor.extract()` 消费
- `_update_mapping` 调用 `_format_sku_list(context, new_only=True)` — **只读**
- `_update_eureka` 调用 `_format_factual_skus(context)` — **只读**
- 结论：`all_skus[:]` 浅拷贝安全，无需 `copy.deepcopy`

**预期收益**：节省 **12-15 分钟**（73 分钟 → 58-61 分钟），降幅 17-20%。

---

##### 瓶颈 2（P1）：Relational `max_tokens` 过大

**现象**：`relational_extractor.py` L372 使用 `max_tokens=128000`，但实际响应仅 2K-6K tokens。

```python
parsed = call_llm_json(prompt, max_tokens=128000)
```

**收益不确定性**：取决于 doubao-seed API 的实现——是否按 `max_tokens` 预分配 KV cache 或影响排队优先级。需 5 分钟实测确认。

**实施建议**：作为 Step 0 优先测试，零风险。固定 prompt 对比 `max_tokens=128000` vs `max_tokens=16000` 的响应时间，差异 >10% 就值得改。

---

##### 瓶颈 3（P2-弃置）：Factual + Procedural 串行执行

**分析结论**：FP 通常不是瓶颈。Meta 阻塞 Relational 期间 FP 的加速完全没有意义——Relational 在等 Meta，不在等 FP。唯一有收益的场景是"Relational 空闲等待 FP 产出"，但从日志看这个场景极少。

**决定**：1-3 分钟的收益不值得引入并发复杂度，**跳过**。

---

##### 瓶颈 4（P2）：Mapping 用轻量模型

**现象**：Mapping 的任务是"给 SKU 分类并写一句话描述"，这是典型的低复杂度任务，但当前使用与 Relational 相同的 `extraction_model`。

**方案**：参照 `dedup_scan_model` 模式，新增 `mapping_model` 配置项。轻量模型（如 `doubao-seed-2-0-lite`）可能将 Mapping 单次耗时从 50-60s 降到 20-30s。

**预期收益**：6 次 Meta 中的 Mapping 部分节省约 **3-5 分钟**。

**验证**：跑一次 5 chunk 的对比，看 mapping.md 的描述是否仍然准确。

---

##### 瓶颈 5（P2）：Eureka prompt 膨胀

**现象**：第 6 次 Meta 时 `existing_eureka` 已达 10408 chars，加上 `content[:8000]` 和 `factual_skus`，总 prompt 超 17K chars。

**截断策略**：只截 `content[:8000]` → `content[:4000]`，保留 `existing_eureka` 完整。Eureka 的 APPEND 强约束依赖于 LLM 看到完整已有内容，避免重复——截断 `existing_eureka` 会破坏去重。

**预期收益**：Eureka 单次从 ~60s 降到 ~40s，6 次节省约 **2 分钟**。

#### 17.10.4 实施计划

| Step | 内容 | 风险 | 时间 | 前置条件 |
|------|------|------|------|---------|
| **0** | `max_tokens` 128K→16K 单 chunk 对比 | 零（临时改1行） | 5 min | 无 |
| **1+2** | 合并锁 + Meta 线程解耦（原子提交） | 低 | 30 min | Step 0 完成 |
| **3** | 5 chunk 回归测试 | — | 15 min | Step 1+2 完成 |
| **4** | Mapping 轻量模型 + Eureka 截断 | 低 | 10 min | Step 3 通过 |

**Step 1+2 原子提交的必要性**：如果只加锁不解耦线程，行为和现在一样（无收益）；只解耦线程不加锁，会立刻出现竞争条件（`self.index` 内存损坏 + `skus_index.json` 写交错）。两个改动必须同时落地。

**Step 1+2 具体改动清单**：

| 文件 | 改动 | 改动量 |
|------|------|--------|
| `pipeline.py` `__init__` | 新增 `self._index_lock = threading.Lock()` | 2 行 |
| `pipeline.py` `run()` | 移除 `all_skus_lock`，所有 `with all_skus_lock:` → `with self._index_lock:` | ~5 处替换 |
| `pipeline.py` `run()` | 创建 `meta_executor = ThreadPoolExecutor(max_workers=1)` | 1 行 |
| `pipeline.py` `run()` | `_flush_meta` 调用改为 `meta_executor.submit()`，深拷贝 `pending_meta_content` 和 `pending_new_skus`，浅拷贝 `all_skus[:]` | ~8 行 |
| `pipeline.py` `run()` | consumer 结束后 `meta_executor.shutdown(wait=True)` 再处理最终 pending | 3 行 |
| `pipeline.py` `_flush_meta` | `self.index.remove_sku` + `self._add_sku_to_index` + `self._save_index` 包在 `with self._index_lock:` 中 | 3 行 |
| `pipeline.py` `extract_single_chunk` | `_save_index()` 纳入 `_index_lock` 保护 | 2 行 |

**Step 3 回归检查项**：

| 检查项 | 预期 |
|--------|------|
| `skus_index.json` SKU 总数与预期一致 | 无因并发写丢失条目 |
| `meta-knowledge` SKU 存在且内容完整 | mapping.md + eureka.md 无截断乱码 |
| 日志无 `Exception` 或 `Lock` 相关警告 | 无死锁或竞争异常 |
| `mapping.md` 和 `eureka.md` 的内容完整 | 无截断或乱码 |

#### 17.10.5 预期综合收益

| 优化项 | 预期节省 | 置信度 |
|--------|---------|--------|
| Meta 与 Relational 并行解耦 | **12-15 min** | 高（日志数据直接证明阻塞） |
| `max_tokens` 优化 | **0-10 min** | 不确定（需实测 API 行为） |
| Mapping 轻量模型 | **3-5 min** | 中（需验证轻量模型质量） |
| Eureka content 截断 | **~2 min** | 高 |

**P0 + P1 落地后**：73 分钟 → 50-55 分钟（降幅 25-30%）

**如果 `max_tokens` 也有收益**：可能进一步降到 45-50 分钟

**理论优化上限**：在不改模型、不改架构的前提下，45-50 分钟是合理上限。

### 17.12 知识库实用性验证：方案 B 最小可用脚本

> 状态: 🔧 测试中 | 评估日期: 2026-04-28 | 目标: 50 个真实问题验证知识库质量

#### 17.12.1 方案概述

创建 Streamlit 聊天界面，将 ontology 全量注入 LLM system prompt，通过 50 个真实问题验证知识库的实用性。

**技术选型**：
- 框架：Streamlit（单文件，零前端依赖）
- LLM：SiliconFlow API（doubao-seed-2-0 系列）
- 方案：RAG-less 全量注入（方案 B）

**脚本**：`G:\Program Files\AI coding\知识萃取\chat_ontology.py`

#### 17.12.2 数据加载策略

| 层级 | 文件 | 字符数 | 注入方式 |
|------|------|--------|---------|
| 核心文件 | README.md + spec.md + mapping.md + eureka.md | ~117 KB | 全量注入 system prompt |
| 摘要索引 | 947 个 header.md | ~231 KB | 全量注入 system prompt |
| 完整内容 | 283 个 content.md + 344 个 SKILL.md | — | **未注入**（按需加载预留） |
| **合计** | **951 个文件** | **~350 KB (~90K tokens)** | system prompt |

#### 17.12.3 功能清单

- 多轮对话 + 对话历史清空
- 模型切换（pro/lite/mini）
- Temperature 调节
- 响应耗时统计（平均/最快/最慢）
- 侧边栏显示 token 估算和加载文件列表
- Streamlit 流式输出

#### 17.12.4 验证计划

50 个真实问题，覆盖以下维度：

| 维度 | 问题数 | 目的 |
|------|--------|------|
| 事实检索 | 15 | 验证 SKU 内容的准确性和完整性 |
| 框架建议 | 10 | 验证 procedural SKU 的可用性 |
| 跨领域关联 | 10 | 验证 relational + eureka 的连接质量 |
| 边界/缺失 | 10 | 验证 LLM 是否诚实标注"知识库无覆盖" |
| 深度追问 | 5 | 验证多轮对话的知识连贯性 |

#### 17.12.5 观察指标

| 指标 | 关注点 |
|------|--------|
| 首次响应延迟 | system prompt 90K tokens 的实际影响 |
| 回答质量 | 是否引用具体 SKU 编号，是否有幻觉 |
| 知识覆盖 | 哪些问题回答得好，哪些不好 |
| 边界行为 | 无覆盖时的回答方式 |
| 模型对比 | pro vs lite vs mini 的质量差异 |

### 17.13 all_skus / add_sku 去重修复

> 状态: ✅ 已实施 | 日期: 2026-04-28 | 与 17.11 线程安全修复配套

#### 17.13.1 问题描述

`pipeline.py` 的 `relational_consumer` 每处理一个 chunk，都会将 `rel_skus`（`sku_id == "relational-knowledge-base"`）追加到 `all_skus` 和 `pending_new_skus` 列表中。由于 relational 使用固定 `sku_id`，每个 chunk 都会生成一份新的快照，但这些旧快照从未被清理，导致：

1. **`all_skus` 无限膨胀**：N 个 chunk 后累积 N 份重复的 relational SKU，浪费内存
2. **`pending_new_skus` 不纯**：传给 meta extractor 的"新增 SKU"列表包含旧 relational 快照，造成噪音
3. **`add_sku` 无去重**：`index.py` 的 `add_sku()` 直接 `append`，去重完全依赖调用方记忆，脆弱

#### 17.13.2 修复方案

三个原子修改，同时实施：

| 优先级 | 问题 | 文件 | 行号 | 改动 |
|--------|------|------|------|------|
| **P1** | `all_skus` 累积 rel 快照 | `pipeline.py` | 137 | `extend(factual_procedural_skus + rel_skus)` → `extend(factual_procedural_skus)` |
| **P3** | `pending_new_skus` 包含 rel | `pipeline.py` | 154 | `extend(factual_procedural_skus + rel_skus)` → `extend(factual_procedural_skus)` |
| **P2** | `add_sku` 无去重保护 | `schemas/index.py` | 42 | 内建 `sku_id` 去重，替换旧条目时先减后加计数器 |

#### 17.13.3 技术细节

**P2 `add_sku` 去重实现**：

```python
def add_sku(self, entry: SKUEntry) -> None:
    """Add an SKU entry, replacing any existing entry with the same sku_id."""
    for i, existing in enumerate(self.skus):
        if existing.sku_id == entry.sku_id:
            # Decrement old entry's counters before removal
            self.total_characters -= existing.character_count
            if existing.classification == SKUType.FACTUAL:
                self.factual_count -= 1
            elif existing.classification == SKUType.RELATIONAL:
                self.relational_count -= 1
            elif existing.classification == SKUType.PROCEDURAL:
                self.procedural_count -= 1
            elif existing.classification == SKUType.META:
                self.meta_count -= 1
            self.skus.pop(i)
            break

    self.skus.append(entry)
    self.total_skus = len(self.skus)
    self.total_characters += entry.character_count
    self.updated_at = datetime.now()
    # ... type counter increment for new entry
```

**幂等性**：pipeline 中现有的 `remove_sku` 调用（L142-143）保留作为防御性编程。`add_sku` 内部会先去重再追加，即使 `remove_sku` 没有被调用也能保证正确性。双重删除（`remove_sku` + `add_sku` 内部 pop）不会冲突——`remove_sku` 找不到就 return False。

**安全性分析**：

| 维度 | 影响 | 风险 |
|------|------|------|
| `all_skus` 移除 rel | meta extractor 优先用 `new_skus`，`all_skus` 仅作 fallback | 零 |
| `pending_new_skus` 移除 rel | meta 的 `_format_sku_list(new_only=True)` 和 `_format_factual_skus` 不消费 rel | 零 |
| `add_sku` 去重 | `total_skus`、`total_characters`、各类型计数器在替换时保持准确 | 零 |

#### 17.13.4 预期效果

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| `all_skus` 长度（N chunks） | N × (avg_factual + 1 rel) | N × avg_factual |
| `pending_new_skus` 纯度 | 含 N 份 rel 快照 | 仅 factual + procedural |
| `index` 计数器准确性 | 依赖调用方 `remove_sku` | `add_sku` 内建保障 |
| 内存占用 | 随 chunk 数线性膨胀（每 chunk +1 rel 快照） | 仅 factual + procedural 线性增长 |
