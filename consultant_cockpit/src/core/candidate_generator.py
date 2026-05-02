# src/core/candidate_generator.py
from typing import List, Dict, Optional
from pydantic import BaseModel
from src.core.consensus_chain import ConsensusChain
from src.utils.llm_client import LLMClient
from src.utils.config import Config

class Candidate(BaseModel):
    """候选方案"""
    id: str
    title: str
    description: str
    risk_level: str  # 稳健/平衡/激进
    evidence_skus: List[str] = []

class CandidateGenerator:
    """候选生成器(MDU核心)"""

    def __init__(self, llm_client: LLMClient, consensus_chain: ConsensusChain):
        self.llm_client = llm_client
        self.consensus_chain = consensus_chain

    def check_constraints(self, available_skus: List[Dict]) -> Dict:
        """检查三约束"""
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

        # 第三约束: 至少1个🟢/🟡SKU
        valid_skus = [
            sku for sku in available_skus
            if sku.get("confidence") in ["🟢", "🟡"]
        ]
        if not valid_skus:
            return {
                "valid": False,
                "message": "当前知识库证据不足,建议先追问具体业务场景"
            }

        return {"valid": True, "message": "约束检查通过"}

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
        """解析LLM响应"""
        candidates = []
        lines = response.strip().split('\n')
        for i, line in enumerate(lines[:3]):
            if '候选' in line:
                parts = line.split(':')
                if len(parts) >= 2:
                    candidates.append(Candidate(
                        id=f"candidate_{i}",
                        title=parts[0].strip(),
                        description=parts[1].strip(),
                        risk_level="稳健" if "稳健" in line else ("平衡" if "平衡" in line else "激进")
                    ))
        return candidates

    def _check_diversity(self, candidates: List[Candidate]) -> bool:
        """检查候选差异度(简化版,实际需要embedding计算)"""
        if len(candidates) < 3:
            return False
        # 检查风险等级是否都不同
        risk_levels = [c.risk_level for c in candidates]
        return len(set(risk_levels)) == 3
