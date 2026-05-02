# src/core/fallback_handler.py
"""降级处理器

根据设计文档 11.3 节实现：
- 飞书API失败降级
- LLM超时降级
- 知识库召回失败降级
- 统一降级统计
"""
from typing import Optional, Callable, List, Dict, Any
from dataclasses import dataclass, field
from enum import Enum
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime
import json


class FallbackType(Enum):
    """降级类型"""
    FEISHU_API = "feishu_api"
    LARK_CLI = "lark_cli"
    LLM_TIMEOUT = "llm_timeout"
    KNOWLEDGE_RECALL = "knowledge_recall"
    WORD_GENERATION = "word_generation"


@dataclass
class FallbackResult:
    """降级结果"""
    success: bool
    fallback_type: FallbackType
    message: str
    data: Optional[Dict] = None
    original_error: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


class FallbackHandler:
    """统一降级处理器

    处理以下场景的降级：
    1. 飞书API失败 → 本地缓存 + 提示手动同步
    2. LLM超时 → 模板填充 / 跳过润色
    3. 知识库召回失败 → 手动搜索指令
    4. Word生成失败 → 纯文本输出
    """

    # 本地缓存文件路径
    LOCAL_CACHE_FILE = "logs/feishu_local_cache.json"

    def __init__(self, max_workers: int = 3):
        """
        Args:
            max_workers: 线程池最大工作线程数
        """
        self.fallback_counts = {t: 0 for t in FallbackType}
        self.fallback_history: List[FallbackResult] = []
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._local_cache: List[Dict] = self._load_local_cache()

    def _load_local_cache(self) -> List[Dict]:
        """加载本地缓存"""
        from pathlib import Path
        cache_file = Path(self.LOCAL_CACHE_FILE)
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save_local_cache(self):
        """保存本地缓存到文件"""
        from pathlib import Path
        cache_file = Path(self.LOCAL_CACHE_FILE)
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(self._local_cache, f, ensure_ascii=False, indent=2)

    def handle_feishu_failure(self, operation: str, error: Exception, data: Dict = None) -> FallbackResult:
        """处理飞书API失败

        Args:
            operation: 操作名称
            error: 原始异常
            data: 需要缓存的数据（可选）

        Returns:
            FallbackResult: 降级结果
        """
        self.fallback_counts[FallbackType.FEISHU_API] += 1

        # 真正的本地缓存：将失败的操作数据写入本地文件
        cache_entry = {
            "operation": operation,
            "error": str(error),
            "data": data,
            "timestamp": datetime.now().isoformat(),
            "retry_suggested": True
        }
        self._local_cache.append(cache_entry)
        self._save_local_cache()

        result = FallbackResult(
            success=True,
            fallback_type=FallbackType.FEISHU_API,
            message=f"飞书同步失败，已保存到本地缓存（{len(self._local_cache)}条待同步）。会议结束后请手动同步。",
            original_error=str(error),
            data={
                "operation": operation,
                "local_cached": True,
                "cache_size": len(self._local_cache),
                "cache_file": self.LOCAL_CACHE_FILE,
                "retry_suggested": True
            }
        )

        self.fallback_history.append(result)
        return result

    def get_local_cache(self) -> List[Dict]:
        """获取本地缓存内容"""
        return self._local_cache.copy()

    def clear_local_cache(self):
        """清除本地缓存"""
        self._local_cache.clear()
        self._save_local_cache()

    def handle_lark_cli_failure(
        self,
        operation: str,
        error: Exception,
        max_retries: int = 3
    ) -> FallbackResult:
        """处理 lark-cli 失败

        Args:
            operation: 操作名称
            error: 原始异常
            max_retries: 最大重试次数

        Returns:
            FallbackResult: 降级结果
        """
        self.fallback_counts[FallbackType.LARK_CLI] += 1

        result = FallbackResult(
            success=True,
            fallback_type=FallbackType.LARK_CLI,
            message=f"lark-cli 执行失败，已记录错误。建议检查网络连接后重试。",
            original_error=str(error),
            data={
                "operation": operation,
                "retry_available": True,
                "max_retries": max_retries
            }
        )

        self.fallback_history.append(result)
        return result

    def handle_llm_timeout(
        self,
        generator: Callable,
        timeout_seconds: int = 10,
        fallback_value: Any = None,
        fallback_template_name: str = None
    ) -> FallbackResult:
        """处理LLM响应超时（真正的超时控制）

        Args:
            generator: 无参数的可调用对象，返回LLM生成结果
            timeout_seconds: 超时时间（秒），默认10秒
            fallback_value: 超时时的降级值
            fallback_template_name: 降级模板名称（用于返回可用内容）

        Returns:
            FallbackResult: 包含成功/失败状态和结果数据
        """
        self.fallback_counts[FallbackType.LLM_TIMEOUT] += 1

        try:
            # 使用 ThreadPoolExecutor 实现真正的超时控制
            future = self._executor.submit(generator)
            result = future.result(timeout=timeout_seconds)

            return FallbackResult(
                success=True,
                fallback_type=FallbackType.LLM_TIMEOUT,
                message="LLM生成成功",
                data={"result": result}
            )

        except FuturesTimeoutError:
            # 超时降级：返回降级模板内容（设计文档 7.5 节第五条硬约束）
            fallback_content = fallback_value
            if fallback_template_name:
                fallback_content = get_fallback_template(fallback_template_name)
            if fallback_content is None:
                fallback_content = ""

            result = FallbackResult(
                success=False,
                fallback_type=FallbackType.LLM_TIMEOUT,
                message=f"LLM响应超时（>{timeout_seconds}秒），已降级为模板内容",
                original_error="TimeoutError",
                data={
                    "fallback_value": fallback_content,
                    "fallback_template": fallback_template_name,
                    "content_available": bool(fallback_content)
                }
            )
            self.fallback_history.append(result)
            return result

        except Exception as e:
            # 其他错误：同样返回降级内容
            fallback_content = fallback_value
            if fallback_template_name:
                fallback_content = get_fallback_template(fallback_template_name)
            if fallback_content is None:
                fallback_content = ""

            result = FallbackResult(
                success=False,
                fallback_type=FallbackType.LLM_TIMEOUT,
                message=f"LLM生成失败：{e}",
                original_error=str(e),
                data={
                    "fallback_value": fallback_content,
                    "fallback_template": fallback_template_name,
                    "content_available": bool(fallback_content)
                }
            )
            self.fallback_history.append(result)
            return result

    def handle_knowledge_recall_failure(
        self,
        manual_query: str,
        knowledge_retriever,
        top_k: int = 5
    ) -> FallbackResult:
        """处理知识库召回失败

        Args:
            manual_query: 手动输入的查询关键词
            knowledge_retriever: KnowledgeRetriever 实例
            top_k: 返回数量

        Returns:
            FallbackResult: 包含召回结果
        """
        self.fallback_counts[FallbackType.KNOWLEDGE_RECALL] += 1

        try:
            # 使用 recall_by_keywords 接口
            results: List = knowledge_retriever.recall_by_keywords([manual_query], top_k=top_k)

            return FallbackResult(
                success=len(results) > 0,
                fallback_type=FallbackType.KNOWLEDGE_RECALL,
                message=f"手动召回结果：{len(results)}条",
                data={
                    "results": [
                        {
                            "id": sku.id,
                            "title": sku.title,
                            "summary": sku.summary,
                            "confidence": sku.confidence
                        }
                        for sku in results
                    ],
                    "query": manual_query
                }
            )

        except Exception as e:
            result = FallbackResult(
                success=False,
                fallback_type=FallbackType.KNOWLEDGE_RECALL,
                message=f"知识库召回失败：{e}",
                original_error=str(e),
                data={"query": manual_query, "results": []}
            )
            self.fallback_history.append(result)
            return result

    def handle_word_generation_failure(
        self,
        content: Dict,
        error: Exception
    ) -> FallbackResult:
        """处理Word生成失败

        Args:
            content: 原始内容（用于降级为纯文本）
            error: 原始异常

        Returns:
            FallbackResult: 降级结果
        """
        self.fallback_counts[FallbackType.WORD_GENERATION] += 1

        # 降级为纯文本
        text_content = self._convert_to_text(content)

        result = FallbackResult(
            success=True,
            fallback_type=FallbackType.WORD_GENERATION,
            message="Word生成失败，已降级为纯文本输出",
            original_error=str(error),
            data={
                "text_content": text_content,
                "format": "plain_text"
            }
        )

        self.fallback_history.append(result)
        return result

    def _convert_to_text(self, content: Dict) -> str:
        """将内容转换为纯文本"""
        lines = []

        for key, value in content.items():
            if isinstance(value, dict):
                lines.append(f"\n【{key}】")
                for k, v in value.items():
                    lines.append(f"  {k}: {v}")
            elif isinstance(value, list):
                lines.append(f"\n【{key}】")
                for i, item in enumerate(value, 1):
                    if isinstance(item, dict):
                        lines.append(f"  {i}. {json.dumps(item, ensure_ascii=False)}")
                    else:
                        lines.append(f"  {i}. {item}")
            else:
                lines.append(f"{key}: {value}")

        return "\n".join(lines)

    def get_fallback_report(self) -> Dict:
        """获取降级统计报告"""
        return {
            "total_fallbacks": sum(self.fallback_counts.values()),
            "by_type": {t.value: count for t, count in self.fallback_counts.items()},
            "recent_fallbacks": [
                {
                    "type": f.fallback_type.value,
                    "message": f.message,
                    "timestamp": f.timestamp
                }
                for f in self.fallback_history[-10:]  # 最近10条
            ]
        }

    def clear_history(self):
        """清除历史记录"""
        self.fallback_history.clear()
        self.fallback_counts = {t: 0 for t in FallbackType}

    def shutdown(self):
        """关闭线程池"""
        self._executor.shutdown(wait=False)


class FallbackChain:
    """降级链：按顺序尝试多个降级方案"""

    def __init__(self, handler: FallbackHandler):
        self.handler = handler
        self.chain: List[Callable] = []

    def add(self, fallback_func: Callable) -> 'FallbackChain':
        """添加降级方案到链中"""
        self.chain.append(fallback_func)
        return self

    def execute(self, primary_func: Callable, *args, **kwargs) -> Any:
        """执行主函数，失败时按链顺序降级

        Args:
            primary_func: 主函数
            *args, **kwargs: 主函数参数

        Returns:
            执行结果
        """
        try:
            return primary_func(*args, **kwargs)
        except Exception as e:
            # 按链顺序尝试降级
            for fallback_func in self.chain:
                try:
                    return fallback_func(*args, **kwargs)
                except Exception:
                    continue

            # 所有降级方案都失败
            raise e


# 预定义的降级模板
FALLBACK_TEMPLATES = {
    "diagnosis_hypothesis": "基于行业经验，客户的核心问题需要进一步诊断确认。",

    "strategy_questions": """1. 您现在的核心业务是什么？
2. 未来3年的战略目标是什么？
3. 目前最大的挑战是什么？""",

    "business_questions": """1. 主要收入来源是什么？
2. 哪块业务最赚钱？
3. 商业模式有什么特点？""",

    "demo_scripts": """A. 行业案例待补充
B. 行业案例待补充
C. 行业案例待补充""",

    "risk_responses": """▸ 客户说"我们已经有方向了"
  → 那您觉得现在最大的执行障碍是什么？
▸ 客户问超出范围的问题
  → 这是关键问题，列入下阶段专项研究，一周内回复"""
}


def get_fallback_template(template_name: str) -> str:
    """获取降级模板

    Args:
        template_name: 模板名称

    Returns:
        模板内容，如果不存在返回空字符串
    """
    return FALLBACK_TEMPLATES.get(template_name, "")
