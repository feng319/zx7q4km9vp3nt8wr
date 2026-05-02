# src/core/candidate_generator.py
"""候选生成器(MDU核心)

设计文档 3.2 节要求：
- 后台持续维护"当前最佳候选"缓存
- 触发条件：共识链新增事实、备弹区召回新SKU、阶段切换
- /候选 指令直接从缓存读取（0.2秒响应）
"""
from typing import List, Dict, Optional, Callable
from datetime import datetime
from pydantic import BaseModel
import threading
import time

from src.core.consensus_chain import ConsensusChain
from src.utils.llm_client import LLMClient
from src.utils.config import Config
from src.core.fallback_handler import FallbackHandler, get_fallback_template


class Candidate(BaseModel):
    """候选方案"""
    id: str
    title: str
    description: str
    risk_level: str  # 稳健/平衡/激进
    evidence_skus: List[str] = []


class CandidateCache:
    """候选缓存（线程安全）"""

    def __init__(self):
        self._candidates: Optional[List[Candidate]] = None
        self._timestamp: Optional[datetime] = None
        self._is_valid: bool = False
        self._lock = threading.Lock()

    def get(self) -> Optional[List[Candidate]]:
        """获取缓存的候选"""
        with self._lock:
            if self._is_valid and self._candidates:
                return self._candidates.copy()
            return None

    def set(self, candidates: List[Candidate]):
        """设置缓存"""
        with self._lock:
            self._candidates = candidates.copy()
            self._timestamp = datetime.now()
            self._is_valid = True

    def invalidate(self):
        """使缓存失效"""
        with self._lock:
            self._is_valid = False

    def is_valid(self) -> bool:
        """检查缓存是否有效"""
        with self._lock:
            return self._is_valid

    def get_age_seconds(self) -> float:
        """获取缓存年龄（秒）"""
        with self._lock:
            if self._timestamp:
                return (datetime.now() - self._timestamp).total_seconds()
            return float('inf')


class CandidateGenerator:
    """候选生成器(MDU核心)

    设计文档 3.2 节：
    - 后台预计算缓存，/候选 指令 0.2 秒响应
    - 三约束检查 + 补充召回
    """

    def __init__(self, llm_client: LLMClient, consensus_chain: ConsensusChain,
                 knowledge_retriever=None, fallback_handler: FallbackHandler = None):
        self.llm_client = llm_client
        self.consensus_chain = consensus_chain
        self.knowledge_retriever = knowledge_retriever
        self.fallback_handler = fallback_handler or FallbackHandler()

        # 预计算缓存
        self._cache = CandidateCache()
        self._background_thread: Optional[threading.Thread] = None
        self._stop_background = threading.Event()

        # 记录上次状态用于变更检测
        self._last_facts_count = 0
        self._last_pending_count = 0

    def check_constraints(self, available_skus: List[Dict]) -> Dict:
        """检查三约束（设计文档 3.3 节）

        第三约束：如果备弹区没有🟢/🟡SKU，触发快速补充召回（Top 1）
        """
        # 第一约束: ≥3条已确认事实
        confirmed_facts = self.consensus_chain.get_confirmed_facts()
        if len(confirmed_facts) < Config.CANDIDATE_MIN_FACTS:
            return {
                "valid": False,
                "message": f"当前共识不足以生成高质量候选,建议先追问客户更多背景信息"
            }

        # 第二约束: 至少1个待确认假设或决策问题
        pending = self.consensus_chain.get_pending_consensus()
        if not pending:
            return {
                "valid": False,
                "message": "当前没有待确认的判断,建议先明确诊断方向"
            }

        # 第三约束: 至少1个🟢/🟡SKU（带补充召回）
        valid_skus = [
            sku for sku in available_skus
            if sku.get("confidence") in ["🟢", "🟡"]
        ]

        if not valid_skus:
            # 触发快速补充召回（设计文档 3.3 节）
            if self.knowledge_retriever:
                try:
                    # 从共识链提取关键词
                    keywords = self._extract_keywords_from_facts(confirmed_facts)
                    supplemented_skus = self.knowledge_retriever.recall_by_keywords(keywords, top_k=1)
                    if supplemented_skus:
                        # 补充召回成功，返回通过
                        return {
                            "valid": True,
                            "message": "约束检查通过（已补充召回）",
                            "supplemented_sku": supplemented_skus[0].model_dump() if hasattr(supplemented_skus[0], 'model_dump') else supplemented_skus[0]
                        }
                except Exception as e:
                    print(f"补充召回失败: {e}")

            return {
                "valid": False,
                "message": "当前知识库证据不足,建议先追问具体业务场景"
            }

        return {"valid": True, "message": "约束检查通过"}

    def _extract_keywords_from_facts(self, facts: List) -> List[str]:
        """从事实中提取关键词"""
        keywords = []
        for fact in facts[:3]:
            content = fact.content if hasattr(fact, 'content') else str(fact)
            # 简单分词（实际可用 jieba）
            keywords.extend(content.split()[:3])
        return list(set(keywords))[:5]

    def generate_candidates(self) -> List[Candidate]:
        """生成候选方案"""
        prompt = self._build_prompt()
        response = self.llm_client.generate(prompt, temperature=0.7)

        candidates = self._parse_response(response)

        # 差异度自检
        if not self._check_diversity(candidates):
            # 重新生成(最多2次)
            for _ in range(Config.CANDIDATE_MAX_REGENERATE):
                response = self.llm_client.generate(prompt, temperature=0.8)
                candidates = self._parse_response(response)
                if self._check_diversity(candidates):
                    break

        return candidates

    def _build_prompt(self) -> str:
        """构建候选生成prompt"""
        facts = self.consensus_chain.get_confirmed_facts()
        pending = self.consensus_chain.get_pending_consensus()

        prompt = f"""基于以下已确认事实和待确认判断,生成3个有差异的候选方案:

已确认事实:
{chr(10).join([f'- {f.content}' for f in facts])}

待确认判断:
{chr(10).join([f'- {p.content}' for p in pending])}

要求:
1. 三个候选必须分别对应不同的战略方向(重资产vs轻资产、自建vs合作、聚焦vs多元)
2. 三个候选必须分别对应不同的风险偏好(稳健、平衡、激进)
3. 每个候选用一句话描述,格式:"候选X: [描述], [风险等级]型策略"

直接输出三个候选,不要其他解释。"""
        return prompt

    def _parse_response(self, response: str) -> List[Candidate]:
        """解析LLM响应

        兼容处理：
        - 全角冒号（：）和半角冒号（:）
        - "候选A"、"候选1"、"候选方向A" 等变体
        - 前置空格/制表符
        - 解析失败时返回错误提示候选
        """
        candidates = []
        lines = response.strip().split('\n')

        # 风险等级关键词映射
        risk_keywords = {"稳健": "稳健", "平衡": "平衡", "激进": "激进",
                         "保守": "稳健", "中性": "平衡", "积极": "激进"}

        for i, line in enumerate(lines[:5]):  # 多读几行，容错
            line = line.strip()
            if not line:
                continue

            # 兼容全角/半角冒号，统一替换为半角
            normalized = line.replace('：', ':').replace('：', ':')

            # 匹配候选模式：包含"候选"关键词
            if '候选' in normalized:
                # 按冒号分割
                parts = normalized.split(':', 1)
                if len(parts) >= 2:
                    title = parts[0].strip()
                    description = parts[1].strip()
                else:
                    # 没有冒号，整行作为描述
                    title = f"候选{i+1}"
                    description = normalized

                # 识别风险等级
                risk_level = "平衡"  # 默认
                for keyword, level in risk_keywords.items():
                    if keyword in description or keyword in title:
                        risk_level = level
                        break

                candidates.append(Candidate(
                    id=f"candidate_{len(candidates)}",
                    title=title,
                    description=description,
                    risk_level=risk_level
                ))

                if len(candidates) >= 3:
                    break

        # 解析失败保护：不足3个候选时用错误提示填充
        if len(candidates) < 3:
            while len(candidates) < 3:
                candidates.append(Candidate(
                    id=f"candidate_fallback_{len(candidates)}",
                    title=f"候选{len(candidates)+1}（解析失败）",
                    description="LLM输出格式异常，请重新生成候选",
                    risk_level=["稳健", "平衡", "激进"][len(candidates) % 3]
                ))

        # PRD 3.4 节校验：三个候选描述长度差异不超过 30%
        lengths = [len(c.description) for c in candidates]
        if lengths:
            max_len = max(lengths)
            min_len = min(lengths)
            if max_len > 0 and (max_len - min_len) / max_len > 0.3:
                # 长度差异过大，记录日志但不阻断
                print(f"⚠️ 候选描述长度差异超过30%: {lengths}")

        return candidates

    def _check_diversity(self, candidates: List[Candidate]) -> bool:
        """检查候选差异度

        设计文档 3.4 节：用 embedding 计算两两相似度，> 0.85 判定为伪差异
        当前简化版：检查风险等级是否都不同
        TODO: Day 4+ 接入 embedding 计算真实差异度
        """
        if len(candidates) < 3:
            return False
        # 检查风险等级是否都不同
        risk_levels = [c.risk_level for c in candidates]
        return len(set(risk_levels)) == 3

    # ============= 预计算缓存机制 =============

    def get_cached_candidates(self) -> Optional[List[Candidate]]:
        """从缓存获取候选（0.2秒响应）

        设计文档 3.2 节：/候选 指令直接从缓存读取
        """
        return self._cache.get()

    def check_and_precompute(self, available_skus: List[Dict]) -> Optional[List[Candidate]]:
        """检查变更并触发预计算

        触发条件（设计文档 3.2 节）：
        - 共识链新增事实
        - 待确认判断变化
        - 阶段切换

        Returns:
            缓存的候选（如果有效），或 None
        """
        # 检查是否有变更
        current_facts_count = len(self.consensus_chain.get_confirmed_facts())
        current_pending_count = len(self.consensus_chain.get_pending_consensus())

        changed = (
            current_facts_count != self._last_facts_count or
            current_pending_count != self._last_pending_count
        )

        self._last_facts_count = current_facts_count
        self._last_pending_count = current_pending_count

        if changed:
            self._cache.invalidate()

        # 如果缓存有效，直接返回
        if self._cache.is_valid():
            return self._cache.get()

        # 缓存失效且有变更，尝试预计算
        if changed:
            constraints = self.check_constraints(available_skus)
            if constraints["valid"]:
                try:
                    candidates = self.generate_candidates()
                    self._cache.set(candidates)
                    return candidates
                except Exception as e:
                    print(f"预计算失败: {e}")

        return self._cache.get()

    def start_background_precompute(self, available_skus: List[Dict], interval: float = 30.0):
        """启动后台预计算线程

        Args:
            available_skus: 可用SKU列表
            interval: 检查间隔（秒）
        """
        if self._background_thread and self._background_thread.is_alive():
            return  # 已在运行

        self._stop_background.clear()

        def _background_loop():
            while not self._stop_background.is_set():
                try:
                    self.check_and_precompute(available_skus)
                except Exception as e:
                    print(f"后台预计算异常: {e}")
                self._stop_background.wait(interval)

        self._background_thread = threading.Thread(
            target=_background_loop,
            daemon=True,
            name="candidate-precompute"
        )
        self._background_thread.start()

    def stop_background_precompute(self):
        """停止后台预计算线程"""
        self._stop_background.set()
        if self._background_thread:
            self._background_thread.join(timeout=5)

    def is_precompute_running(self) -> bool:
        """检查后台预计算是否在运行"""
        return self._background_thread is not None and self._background_thread.is_alive()

    def get_cache_status(self) -> Dict:
        """获取缓存状态"""
        return {
            "is_valid": self._cache.is_valid(),
            "age_seconds": self._cache.get_age_seconds(),
            "background_running": self.is_precompute_running(),
            "last_facts_count": self._last_facts_count,
            "last_pending_count": self._last_pending_count
        }
