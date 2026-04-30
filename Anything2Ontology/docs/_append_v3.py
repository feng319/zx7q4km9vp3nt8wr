#!/usr/bin/env python3
"""Append v3.0 optimization plan to OPTIMIZATION_PLAN.md"""
import os

target = os.path.join(os.path.dirname(__file__), "OPTIMIZATION_PLAN.md")

v3_content = """

---

## 九、v3.0 优化 — LLM 超时重试 + Pipeline 健壮性

> 版本: v3.0 | 日期: 2026-04-26 | 状态: 待实施

### 9.1 背景与动机

v2.0 实施后，mapping diff 模式将 Phase 2 单次耗时从 ~300s 降至 ~120s，但存在以下隐患：

1. **LLM 调用无超时配置**：`call_llm_full` 未传 `timeout` 参数，完全依赖 OpenAI Python SDK 默认值（60s 连接 + 600s 读取），且无重试逻辑——单次超时即返回 None，导致整个 extractor 结果丢失
2. **504 超时异常未被识别**：当前异常捕获只区分 `json.JSONDecodeError` 和通用 `Exception`，无法区分超时、网络错误、服务端 429/500/502/503/504 等，导致日志中只有 `unexpected error` 无法定位问题
3. **Pipeline `all_skus` 丢失**：`pipeline.py` 的 `all_skus` 列表仅在内存中累积，若进程重启则丢失，而 meta extractor 依赖 `all_skus` 生成 SKU 列表
4. **`_format_sku_list` fallback 逻辑不一致**：当 `context` 传入 `new_skus` 字段时，空列表 `[]` 被当作"无 SKU"跳过，但实际上空列表可能表示"本批次无新增 SKU"而非"未提供信息"

### 9.2 火山引擎 Ark 超时参数（官方数据）

| 维度 | 默认值 |
|------|--------|
| 服务端非流式请求超时 | **600 秒** |
| Python SDK 连接超时 | 60 秒 |
| Python SDK 数据传输超时 | **600 秒** |
| 深度思考模式推荐超时 | 1800 秒+ |

来源：[火山引擎 Ark SDK 常见使用示例](https://www.volcengine.com/docs/82379/1544136#%E8%AE%BE%E7%BD%AE%E8%B6%85%E6%97%B6-%E9%87%8D%E8%AF%95%E6%AC%A1%E6%95%B0)

**关键结论**：
- 服务端 600s 超时与 SDK 默认 600s 读取超时一致，600s 内请求不会被服务端断开
- `llm_timeout_seconds` 默认值应设为 **600**（与当前行为等价），而非 300（会提前中断本来能完成的请求）
- 深度思考模式需 1800s+，但当前未启用，先在配置中预留

### 9.3 实施清单

| # | 文件 | 改动要点 | 优先级 |
|---|------|---------|--------|
| 1 | `pipeline.py` | 从 index 恢复 `all_skus` + description 完整性日志 + `new_skus_in_this_run` 追踪 | P0 |
| 2 | `pipeline.py` | `_flush_meta` 调用改传 `new_skus_in_this_run`，fallback 用 `is not None` | P0 |
| 3 | `config.py` | 新增 `llm_timeout_seconds`（默认 600）、`llm_max_retries`（默认 1）、`llm_retry_delay_seconds`（默认 15） | P0 |
| 4 | `llm_client.py` | `call_llm_full` 添加 timeout 参数 + 重试循环 + 分层异常捕获（含 504 + `__mro__` 日志） | P0 |
| 5 | `meta_extractor.py` | `_format_sku_list` 调用处 fallback 改 `is not None`（配合 #2） | P0 |
| 6 | `meta_extractor.py` | `_merge_mapping_diff` 添加 SKU 路径去重 | P1 |
| 7 | `relational_extractor.py` | merge 后添加谓词分布日志 + `>20` WARNING | P1 |

### 9.4 改动详述

#### 9.4.1 P0-1: pipeline.py — `all_skus` 恢复 + 完整性日志

**问题**：`all_skus` 仅在内存中累积，进程重启后丢失。meta extractor 依赖 `all_skus` 生成 SKU 列表，丢失则 mapping/eureka 无法正常工作。

**方案**：

1. Pipeline 启动时，从 index（已序列化的 SKU 列表）恢复 `all_skus`
2. 每个 chunk 处理后，记录 `all_skus` 总数和 description 完整性
3. 新增 `new_skus_in_this_run` 追踪，用于 meta batch 传参

```python
# pipeline.py — process() 方法开头

# 从 index 恢复 all_skus（支持断点续跑）
all_skus: list[SKU] = []
if os.path.exists(self.index_path):
    try:
        existing_data = json.loads(self.index_path.read_text(encoding="utf-8"))
        for sku_data in existing_data:
            all_skus.append(SKU(**sku_data))
        logger.info("Recovered all_skus from index",
                     count=len(all_skus))
    except Exception as e:
        logger.warning("Failed to recover all_skus from index", error=str(e))

# 追踪本次运行新增的 SKUs
new_skus_in_this_run: list[SKU] = []

# 每个 chunk 后：
new_skus_in_this_run.extend(chunk_new_skus)

# description 完整性日志
described = sum(1 for sku in all_skus if sku.description and len(sku.description) > 10)
logger.info("SKU description completeness",
            total=len(all_skus),
            described=described,
            ratio=f"{described/max(len(all_skus),1)*100:.0f}%")
```

#### 9.4.2 P0-2: pipeline.py — `_flush_meta` 传参修正

**问题**：`_flush_meta` 当前接收 `context` 参数，`context["new_skus"]` 传空列表 `[]` 时，`_format_sku_list` 将其视为"无 SKU"跳过。但空列表和"未提供"是不同语义。

**方案**：

```python
# _flush_meta 调用处
self._flush_meta(
    chunk_id=chunk_id,
    context={
        "all_skus": all_skus,
        "new_skus": new_skus_in_this_run,  # 仅本次运行新增
    },
    content=content,
)

# _format_sku_list fallback 逻辑修正
def _format_sku_list(self, context, new_only=False):
    if new_only:
        # 改为 is not None 判断：空列表 [] 表示"本批次无新增"，应正常处理
        skus = context.get("new_skus") if context is not None else None
        if skus is not None:
            return self._sku_list_to_text(skus)
    # fallback to all_skus
    skus = context.get("all_skus") if context is not None else None
    if skus is not None:
        return self._sku_list_to_text(skus)
    return ""
```

#### 9.4.3 P0-3: config.py — LLM 超时与重试配置

```python
# config.py — 新增配置项

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

**设计说明**：
- `llm_timeout_seconds=600`：与火山引擎 Ark 服务端 600s 超时 + Python SDK 默认 600s 读取超时保持一致，改动后默认行为与当前等价
- `llm_max_retries=1`：超时/网络错误最多重试 1 次（共 2 次尝试），避免无限重试
- `llm_retry_delay_seconds=15`：重试前等待 15 秒，给服务端恢复时间；429 (rate limit) 自动等待 60 秒

#### 9.4.4 P0-4: llm_client.py — `call_llm_full` 超时 + 重试 + 分层异常

**改动范围**：`call_llm_full` 函数

**新增 import**：

```python
import httpx
import time
from openai import APITimeoutError, APIConnectionError, APIStatusError
```

**可重试异常**：

```python
TIMEOUT_EXCEPTIONS = (
    APITimeoutError,          # SDK 包装的客户端超时
    APIConnectionError,       # 连接失败（SDK 包装）
    httpx.TimeoutException,   # httpx 底层超时（兜底）
    httpx.NetworkError,       # 网络层错误
)

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
```

**重试循环核心逻辑**：

```python
def call_llm_full(...) -> Optional[LLMResponse]:
    # ... 前置逻辑（参数构造）不变 ...

    max_attempts = 1 + settings.llm_max_retries

    for attempt in range(max_attempts):
        if attempt > 0:
            logger.warning("[MONITOR] Retrying LLM call",
                           attempt=attempt,
                           max_retries=settings.llm_max_retries)
            time.sleep(settings.llm_retry_delay_seconds)

        try:
            response = client.chat.completions.create(
                **kwargs,
                timeout=settings.llm_timeout_seconds,  # 600s by default
            )
            # ... 正常处理 response（与现有逻辑一致） ...
            return LLMResponse(...)

        except TIMEOUT_EXCEPTIONS as e:
            logger.warning("[MONITOR] LLM call timeout/network error",
                           error_type=type(e).__name__,
                           attempt=attempt,
                           timeout=settings.llm_timeout_seconds)
            continue  # 重试或最终返回 None

        except APIStatusError as e:
            if e.status_code in RETRYABLE_STATUS_CODES:
                delay = 60 if e.status_code == 429 else settings.llm_retry_delay_seconds
                logger.warning("[MONITOR] LLM call retryable API error",
                               status_code=e.status_code,
                               attempt=attempt)
                if attempt < settings.llm_max_retries:
                    time.sleep(delay)
                    continue
            logger.error("[MONITOR] LLM call non-retryable API error",
                         status_code=e.status_code,
                         error=str(e)[:200])
            return None

        except Exception as e:
            logger.error("[MONITOR] LLM call unexpected error",
                         error_type=type(e).__name__,
                         mro=[c.__name__ for c in type(e).__mro__],
                         error=str(e)[:500])
            return None

    # 所有重试都超时
    logger.error("[MONITOR] LLM call timed out after all retries",
                 total_attempts=max_attempts,
                 timeout=settings.llm_timeout_seconds)
    return None
```

**分层异常捕获设计**：

| 异常类型 | 处理策略 | 原因 |
|---------|---------|------|
| `APITimeoutError` | 重试 | 客户端超时，服务端可能仍在处理 |
| `APIConnectionError` | 重试 | 网络抖动，可恢复 |
| `httpx.TimeoutException` | 重试 | 底层超时兜底 |
| `httpx.NetworkError` | 重试 | 底层网络错误兜底 |
| `APIStatusError 429` | 重试（等 60s） | 速率限制，需等待 |
| `APIStatusError 500/502/503/504` | 重试 | 服务端临时错误 |
| `APIStatusError 其他` | 不重试 | 客户端错误（401/403/400），重试无意义 |
| 其他异常 | 不重试 | 未知错误，记录 `__mro__` 便于诊断 |

**`__mro__` 日志**：当遇到未知异常类型时，记录 `type(e).__mro__`（方法解析顺序），便于判断异常是否是某个已知异常的子类（如 504 可能被包装为非 `APIStatusError` 的自定义异常）。

#### 9.4.5 P0-5: meta_extractor.py — `_format_sku_list` fallback 修正

**改动**：将 `_format_sku_list` 中对 `new_skus` / `all_skus` 的判断从 truthy check 改为 `is not None`。

```python
# 旧：if context.get("new_skus"):  → 空列表 [] 被视为 False，跳过
# 新：if context.get("new_skus") is not None:  → 空列表 [] 正常处理
```

这确保当 `new_skus_in_this_run` 为空列表时，diff prompt 正确表达"本批次无新增 SKU"，而不是回退到 `all_skus`。

#### 9.4.6 P1-1: meta_extractor.py — `_merge_mapping_diff` SKU 路径去重

**问题**：`_merge_mapping_diff` 合并 diff 时，可能将已在 mapping.md 中存在的 SKU 路径重复插入。

**方案**：在插入前检查当前 mapping 中是否已包含该 SKU 路径。

```python
def _merge_mapping_diff(self, current_mapping: str, diff_output: str) -> str:
    # ... 现有逻辑 ...

    # 构建已有 SKU 路径集合（用于去重）
    existing_sku_paths = set()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("-") and ("`" in stripped or "/" in stripped):
            # 提取 SKU 路径，如 `factual/vpp-arch`
            match = re.search(r'`([^`]+)`', stripped)
            if match:
                existing_sku_paths.add(match.group(1))

    for header, content in diff_sections.items():
        # 过滤掉已存在的 SKU 条目
        filtered_content = []
        for line in content:
            stripped = line.strip()
            if stripped.startswith("-"):
                match = re.search(r'`([^`]+)`', stripped)
                if match and match.group(1) in existing_sku_paths:
                    logger.debug("Skipping duplicate SKU in diff",
                                 sku_path=match.group(1))
                    continue
            filtered_content.append(line)
        content = filtered_content

        if not content:
            continue

        # ... 后续合并逻辑不变 ...
```

#### 9.4.7 P1-2: relational_extractor.py — 谓词分布日志

**问题**：merge 后缺乏对关系质量的监控，无法发现谓词分布异常（如某个谓词过度使用）。

**方案**：在 `extract()` 方法的 merge 后添加谓词分布统计日志。

```python
# merge 后，记录谓词分布
if self.relationships and self.relationships.relationships:
    from collections import Counter
    predicate_counts = Counter(
        rel.predicate for rel in self.relationships.relationships
    )
    logger.info(
        "Relational predicate distribution",
        total_relationships=len(self.relationships.relationships),
        distribution=dict(predicate_counts.most_common()),
        chunk_id=chunk_id,
    )

    # 对异常高频谓词发出警告
    for predicate, count in predicate_counts.items():
        if count > 20:
            logger.warning(
                "Predicate used more than 20 times, possible over-extraction",
                predicate=predicate,
                count=count,
                chunk_id=chunk_id,
            )
```

### 9.5 综合效果评估

| 指标 | v2.0 | v3.0 |
|------|------|------|
| LLM 超时处理 | 无（单次失败=结果丢失） | 重试 1 次 + 分层异常捕获 |
| 504 诊断 | 只有 `unexpected error` | 精确识别 + `__mro__` 日志 |
| Pipeline 断点续跑 | `all_skus` 丢失，meta 无法工作 | 从 index 恢复，meta 正常 |
| Mapping 重复 SKU | 可能重复插入 | 去重过滤 |
| Relational 质量 | 无监控 | 谓词分布日志 + 高频警告 |
| 超时配置 | 硬编码（SDK 默认 600s） | 可配置（默认 600s，深度思考可设 1800s） |

**对总耗时的影响**：

- 正常运行：无影响（600s 默认值与当前行为等价）
- 超时重试：每次重试额外等待 15s + LLM 处理时间，但避免了整个 extractor 结果丢失
- 429 重试：等待 60s，但避免了因限流导致的级联失败

### 9.6 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| P0-1 | 移除 `all_skus` 恢复逻辑和 `new_skus_in_this_run` 追踪 |
| P0-2 | `_flush_meta` 恢复原来的 context 构造 |
| P0-3 | 移除三个新增配置项 |
| P0-4 | `call_llm_full` 移除 timeout 参数、重试循环、分层异常，恢复原异常捕获 |
| P0-5 | `_format_sku_list` fallback 恢复 truthy check |
| P1-1 | `_merge_mapping_diff` 移除去重逻辑 |
| P1-2 | 移除谓词分布日志 |

所有改动独立，可单独回滚。
"""

with open(target, "a", encoding="utf-8") as f:
    f.write(v3_content)

print(f"Appended v3.0 content to {target}")
