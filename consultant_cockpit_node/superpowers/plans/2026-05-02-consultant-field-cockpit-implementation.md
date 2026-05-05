# 顾问现场作战系统实施计划（Python + Streamlit 版本）

> ⚠️ **本文档为 Python + Streamlit 版本（已完成）的实施记录，对应 git tag: python-v1.0-final。**
> Node.js 改造计划见 `2026-05-03-consultant-field-cockpit-implementation.md`。
> **本文档仅作为迁移参考基线，不作为 Node.js 版本的实施指导。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建顾问现场作战系统,让咨询顾问在客户面前反应快、判断准、记忆全。

**Architecture:** Streamlit本地应用(顾问作战层)+ 飞书多维表格(客户共识层)。采用垂直切片方式,Day 1跑通最小决策链(候选→共识→备忘录),Day 2补全功能+飞书集成,Day 3增强功能+验证。

**Tech Stack:** Python 3.12 (系统安装), Streamlit, OpenAI SDK, python-docx, lark-cli, Pydantic

**重要环境说明:**
- 系统存在多个 Python 版本，必须使用 Python 3.12 (C:/Users/56839/AppData/Local/Programs/Python/Python312/python.exe)
- 不依赖虚拟环境，依赖已安装到系统 Python 3.12
- 启动命令: consultant_cockpit/start.bat 或 npm start (端口 8501)
- 知识副驾: start_chat.bat 或 npm run chat (端口 8502)

---

## 文件结构

```
consultant_cockpit/
├── src/
│   ├── core/
│   │   ├── __init__.py
│   │   ├── consensus_chain.py      # 共识链数据结构和管理
│   │   ├── candidate_generator.py  # 候选生成器(MDU核心)
│   │   ├── knowledge_retriever.py  # 知识召回(关键词+指令)
│   │   └── memo_generator.py       # 备忘录生成(三层架构)
│   ├── ui/
│   │   ├── __init__.py
│   │   ├── main_app.py             # Streamlit主应用
│   │   ├── demo_mode.py            # 演示模式切换
│   │   └── battle_card.py          # 会前作战卡生成
│   ├── integrations/
│   │   ├── __init__.py
│   │   └── feishu_client.py        # 飞书集成(lark-cli封装)
│   └── utils/
│       ├── __init__.py
│       ├── llm_client.py           # LLM客户端封装
│       └── config.py               # 配置管理
├── tests/
│   ├── test_consensus_chain.py
│   ├── test_candidate_generator.py
│   ├── test_knowledge_retriever.py
│   └── test_memo_generator.py
├── templates/
│   ├── memo_template.docx          # 备忘录Word模板
│   └── battle_card_template.docx   # 作战卡Word模板
├── config/
│   ├── service_packages.json       # 服务包定价配置
│   └── keywords.json               # 关键词词典
├── requirements.txt
└── README.md
```

---

## Day 1: 决策链跑通

### Task 1: 项目初始化和依赖安装

**Files:**
- Create: `consultant_cockpit/requirements.txt`
- Create: `consultant_cockpit/src/__init__.py`
- Create: `consultant_cockpit/src/core/__init__.py`
- Create: `consultant_cockpit/src/ui/__init__.py`
- Create: `consultant_cockpit/src/integrations/__init__.py`
- Create: `consultant_cockpit/src/utils/__init__.py`

- [ ] **Step 1: 创建项目目录结构**

```bash
mkdir -p consultant_cockpit/src/{core,ui,integrations,utils}
mkdir -p consultant_cockpit/tests
mkdir -p consultant_cockpit/templates
mkdir -p consultant_cockpit/config
touch consultant_cockpit/src/__init__.py
touch consultant_cockpit/src/core/__init__.py
touch consultant_cockpit/src/ui/__init__.py
touch consultant_cockpit/src/integrations/__init__.py
touch consultant_cockpit/src/utils/__init__.py
```

- [ ] **Step 2: 创建requirements.txt**

```txt
streamlit>=1.28.0
openai>=1.0.0
python-docx>=0.8.11
pydantic>=2.0.0
python-dotenv>=1.0.0
```

- [ ] **Step 3: 安装依赖**

```bash
cd consultant_cockpit
pip install -r requirements.txt
```

- [ ] **Step 4: 验证安装**

```bash
python -c "import streamlit; import openai; import docx; import pydantic; print('All dependencies installed')"
```

Expected: "All dependencies installed"

- [ ] **Step 5: 提交初始化**

```bash
git add consultant_cockpit/
git commit -m "feat: 初始化顾问现场作战系统项目结构

- 创建目录结构(core/ui/integrations/utils)
- 添加requirements.txt依赖
- 安装Streamlit/OpenAI/python-docx/Pydantic

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 共识链数据结构

**Files:**
- Create: `consultant_cockpit/src/core/consensus_chain.py`
- Create: `consultant_cockpit/tests/test_consensus_chain.py`

- [ ] **Step 1: 编写共识链数据模型测试**

```python
# tests/test_consensus_chain.py
import pytest
from datetime import datetime
from src.core.consensus_chain import ConsensusRecord, ConsensusChain

def test_create_consensus_record():
    """测试创建共识记录"""
    record = ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="客户产品线5条",
        source="manual",
        status="recorded"
    )
    assert record.id == "cc_001"
    assert record.type == "fact"
    assert record.status == "recorded"

def test_consensus_chain_add_record():
    """测试共识链添加记录"""
    chain = ConsensusChain()
    record = ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="客户产品线5条",
        source="manual",
        status="recorded"
    )
    chain.add_record(record)
    assert len(chain.records) == 1
    assert chain.get_record("cc_001") == record

def test_consensus_chain_confirm_record():
    """测试确认共识记录"""
    chain = ConsensusChain()
    record = ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="客户认可聚焦储能",
        source="candidate_selected",
        status="pending_client_confirm"
    )
    chain.add_record(record)
    chain.confirm_record("cc_001")
    assert chain.get_record("cc_001").status == "confirmed"

def test_consensus_chain_get_confirmed_facts():
    """测试获取已确认的事实"""
    chain = ConsensusChain()
    chain.add_record(ConsensusRecord(
        id="cc_001",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="事实1",
        source="manual",
        status="confirmed"
    ))
    chain.add_record(ConsensusRecord(
        id="cc_002",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="事实2",
        source="manual",
        status="recorded"
    ))
    facts = chain.get_confirmed_facts()
    assert len(facts) == 1
    assert facts[0].content == "事实1"
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd consultant_cockpit
pytest tests/test_consensus_chain.py -v
```

Expected: FAIL with "ModuleNotFoundError: No module named 'src.core.consensus_chain'"

- [ ] **Step 3: 实现共识链数据模型**

```python
# src/core/consensus_chain.py
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field

class ConsensusRecord(BaseModel):
    """共识链记录"""
    id: str
    timestamp: datetime
    type: Literal["fact", "consensus"]
    stage: Literal["战略梳理", "商业模式", "行业演示"]
    content: str
    source: Literal["manual", "candidate_selected", "ai_suggested", "manual_correction"]
    evidence_sku: List[str] = Field(default_factory=list)
    status: Literal["recorded", "pending_client_confirm", "confirmed", "superseded"] = "recorded"
    confidence: Optional[Literal["high", "medium", "low"]] = None
    replaces: Optional[str] = None
    superseded_by: Optional[str] = None
    feishu_record_id: Optional[str] = None
    recommendation: Optional[str] = None  # 仅consensus类有

class ConsensusChain:
    """共识链管理器"""
    def __init__(self):
        self.records: List[ConsensusRecord] = []

    def add_record(self, record: ConsensusRecord):
        """添加记录"""
        self.records.append(record)

    def get_record(self, record_id: str) -> Optional[ConsensusRecord]:
        """获取记录"""
        for record in self.records:
            if record.id == record_id:
                return record
        return None

    def confirm_record(self, record_id: str):
        """确认记录"""
        record = self.get_record(record_id)
        if record:
            record.status = "confirmed"

    def get_confirmed_facts(self) -> List[ConsensusRecord]:
        """获取已确认的事实"""
        return [
            r for r in self.records
            if r.type == "fact" and r.status == "confirmed"
        ]

    def get_confirmed_consensus(self) -> List[ConsensusRecord]:
        """获取已确认的判断"""
        return [
            r for r in self.records
            if r.type == "consensus" and r.status == "confirmed"
        ]

    def get_pending_consensus(self) -> List[ConsensusRecord]:
        """获取待确认的判断"""
        return [
            r for r in self.records
            if r.status == "pending_client_confirm"
        ]

# 注：以上为 Day 1 精简版代码。
# correctRecord / superseded 修正路径已在后续迭代中实现，
# 完整实现见 consensus_chain.py:61-100（correct_record, get_superseded_records, get_correction_history）。
# CandidateCache 预计算缓存见 candidate_generator.py:33-72, 304-401。
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pytest tests/test_consensus_chain.py -v
```

Expected: All tests PASS

- [ ] **Step 5: 提交共识链模块**

```bash
git add consultant_cockpit/src/core/consensus_chain.py consultant_cockpit/tests/test_consensus_chain.py
git commit -m "feat: 实现共识链数据结构

- ConsensusRecord: 共识记录模型(支持fact/consensus两种类型)
- ConsensusChain: 共识链管理器(添加/确认/查询)
- 完整单元测试覆盖

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 候选生成器(MDU核心)

**Files:**
- Create: `consultant_cockpit/src/core/candidate_generator.py`
- Create: `consultant_cockpit/tests/test_candidate_generator.py`
- Create: `consultant_cockpit/src/utils/llm_client.py`
- Create: `consultant_cockpit/src/utils/config.py`

- [ ] **Step 1: 编写配置管理模块**

```python
# src/utils/config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """配置管理"""
    # LLM配置
    LLM_API_KEY = os.getenv("OPENAI_API_KEY", "")
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4")

    # 候选生成配置
    CANDIDATE_MAX_REGENERATE = 2  # 最大重生成次数
    CANDIDATE_MIN_FACTS = 3  # 最少事实数
    CANDIDATE_SIMILARITY_THRESHOLD = 0.85  # 差异度阈值

    # 服务包定价(从配置文件读取)
    SERVICE_PACKAGES = {
        "deep_diagnosis": {"name": "初步诊断深化", "price": 599},
        "business_model": {"name": "商业模式专项咨询", "price": 1999},
        "strategy_workshop": {"name": "战略主线确认工作坊", "price": 19800},
    }
```

- [ ] **Step 2: 编写LLM客户端封装**

```python
# src/utils/llm_client.py
from openai import OpenAI
from .config import Config

class LLMClient:
    """LLM客户端封装"""
    def __init__(self):
        self.client = OpenAI(
            api_key=Config.LLM_API_KEY,
            base_url=Config.LLM_BASE_URL
        )
        self.model = Config.LLM_MODEL

    def generate(self, prompt: str, max_tokens: int = 2000, temperature: float = 0.7) -> str:
        """生成文本"""
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature
        )
        return response.choices[0].message.content
```

- [ ] **Step 3: 编写候选生成器测试**

```python
# tests/test_candidate_generator.py
import pytest
from unittest.mock import Mock, patch
from src.core.candidate_generator import CandidateGenerator, Candidate
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from datetime import datetime

@pytest.fixture
def mock_llm_client():
    """Mock LLM客户端"""
    return Mock()

@pytest.fixture
def consensus_chain():
    """测试用共识链"""
    chain = ConsensusChain()
    # 添加3条已确认事实
    for i in range(3):
        chain.add_record(ConsensusRecord(
            id=f"fact_{i}",
            timestamp=datetime.now(),
            type="fact",
            stage="战略梳理",
            content=f"事实{i}",
            source="manual",
            status="confirmed"
        ))
    # 添加1个待确认假设
    chain.add_record(ConsensusRecord(
        id="hypothesis_1",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="客户需要聚焦储能",
        source="manual",
        status="pending_client_confirm"
    ))
    return chain

def test_check_constraints_success(consensus_chain):
    """测试三约束检查通过"""
    generator = CandidateGenerator(Mock(), consensus_chain)
    # Mock备弹区有🟢SKU
    mock_skus = [{"id": "sku_001", "confidence": "🟢"}]
    result = generator.check_constraints(mock_skus)
    assert result["valid"] == True

def test_check_constraints_insufficient_facts():
    """测试事实数不足"""
    chain = ConsensusChain()
    chain.add_record(ConsensusRecord(
        id="fact_1",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="事实1",
        source="manual",
        status="confirmed"
    ))
    generator = CandidateGenerator(Mock(), chain)
    result = generator.check_constraints([])
    assert result["valid"] == False
    assert "建议先追问" in result["message"]

def test_generate_candidates(mock_llm_client, consensus_chain):
    """测试生成候选"""
    # Mock LLM返回
    mock_llm_client.generate.return_value = """
候选A: 聚焦储能主航道,稳健型策略
候选B: 多元化发展,平衡型策略
候选C: 轻资产转型,激进型策略
"""
    generator = CandidateGenerator(mock_llm_client, consensus_chain)
    candidates = generator.generate_candidates()
    assert len(candidates) == 3
    assert all(isinstance(c, Candidate) for c in candidates)
```

- [ ] **Step 4: 运行测试验证失败**

```bash
pytest tests/test_candidate_generator.py -v
```

Expected: FAIL with "ModuleNotFoundError"

- [ ] **Step 5: 实现候选生成器**

```python
# src/core/candidate_generator.py
from typing import List, Dict, Optional
from pydantic import BaseModel
from .consensus_chain import ConsensusChain
from ..utils.llm_client import LLMClient
from ..utils.config import Config

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

        # 第三约束: 至少1个少1个🟢/🟡SKU
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
                # 简单解析(实际需要更健壮的解析逻辑)
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
```

- [ ] **Step 6: 运行测试验证通过**

```bash
pytest tests/test_candidate_generator.py -v
```

Expected: All tests PASS

- [ ] **Step 7: 提交候选生成器模块**

```bash
git add consultant_cockpit/src/core/candidate_generator.py consultant_cockpit/tests/test_candidate_generator.py consultant_cockpit/src/utils/
git commit -m "feat: 实现候选生成器(MDU核心)

- CandidateGenerator: 候选生成器(三约束检查+差异度保证)
- LLMClient: LLM客户端封装
- Config: 配置管理
- 完整单元测试

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 最小备忘录生成器(纯模板填充)

**Files:**
- Create: `consultant_cockpit/src/core/memo_generator.py`
- Create: `consultant_cockpit/tests/test_memo_generator.py`
- Create: `consultant_cockpit/templates/memo_template.docx`

- [ ] **Step 1: 编写备忘录生成器测试**

```python
# tests/test_memo_generator.py
import pytest
from src.core.memo_generator import MemoGenerator
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from datetime import datetime

@pytest.fixture
def consensus_chain():
    """测试用共识链"""
    chain = ConsensusChain()
    # 添加事实
    chain.add_record(ConsensusRecord(
        id="fact_1",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content="客户产品线5条",
        source="manual",
        status="confirmed"
    ))
    # 添加判断
    chain.add_record(ConsensusRecord(
        id="consensus_1",
        timestamp=datetime.now(),
        type="consensus",
        stage="战略梳理",
        content="客户认可聚焦储能",
        source="candidate_selected",
        status="confirmed",
        recommendation="聚焦储能主航道"
    ))
    return chain

def test_extract_data(consensus_chain):
    """测试数据提取"""
    generator = MemoGenerator(consensus_chain)
    data = generator.extract_data()

    assert "facts" in data
    assert len(data["facts"]) == 1
    assert data["facts"][0]["content"] == "客户产品线5条"

    assert "consensus" in data
    assert len(data["consensus"]) == 1

def test_generate_memo_structure(consensus_chain):
    """测试生成备忘录结构"""
    generator = MemoGenerator(consensus_chain)
    structure = generator.generate_structure()

    assert "chapters" in structure
    assert "关键发现" in structure["chapters"]
    assert "初步建议方向" in structure["chapters"]
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pytest tests/test_memo_generator.py -v
```

Expected: FAIL

- [ ] **Step 3: 实现备忘录生成器(第一层+第二层)**

```python
# src/core/memo_generator.py
from typing import Dict, List
from .consensus_chain import ConsensusChain

class MemoGenerator:
    """备忘录生成器(三层架构)"""

    def __init__(self, consensus_chain: ConsensusChain):
        self.consensus_chain = consensus_chain

    def extract_data(self) -> Dict:
        """第一层: 数据提取(确定性规则)"""
        data = {
            "facts": [],
            "consensus": [],
            "pending": [],
            "client_profile": {}  # 从外部注入
        }

        # 提取已确认事实
        for record in self.consensus_chain.get_confirmed_facts():
            data["facts"].append({
                "stage": record.stage,
                "content": record.content,
                "source": record.source
            })

        # 提取已确认判断
        for record in self.consensus_chain.get_confirmed_consensus():
            data["consensus"].append({
                "content": record.content,
                "source": record.source,
                "recommendation": record.recommendation
            })

        # 提取待确认判断
        for record in self.consensus_chain.get_pending_consensus():
            data["pending"].append({
                "content": record.content
            })

        return data

    def generate_structure(self) -> Dict:
        """第二层: 结构组装(模板+规则)"""
        data = self.extract_data()

        structure = {
            "chapters": {}
        }

        # 一、问题重构
        structure["chapters"]["问题重构"] = {
            "原始诉求": data["client_profile"].get("显性诉求", ""),
            "核心问题": data["consensus"][0]["content"] if data["consensus"] else ""
        }

        # 二、关键发现
        structure["chapters"]["关键发现"] = {
            "战略层面": [f["content"] for f in data["facts"] if f["stage"] == "战略梳理"][:3],
            "商业模式层面": [f["content"] for f in data["facts"] if f["stage"] == "商业模式"][:3]
        }

        # 三、初步建议方向
        structure["chapters"]["初步建议方向"] = [
            {
                "方向": c["recommendation"] or c["content"],
                "来源": "系统生成" if c["source"] == "candidate_selected" else "顾问判断"
            }
            for c in data["consensus"]
        ]

        # 四、需要进一步访谈
        structure["chapters"]["需要进一步访谈"] = [
            p["content"] for p in data["pending"]
        ]

        return structure

    def generate_word(self, output_path: str):
        """生成Word文档(第三层: AI润色在Day 2实现)"""
        from docx import Document

        structure = self.generate_structure()
        doc = Document()

        # 标题
        doc.add_heading('客户初步诊断备忘录', 0)

        # 一、问题重构
        doc.add_heading('一、问题重构', level=1)
        problem = structure["chapters"]["问题重构"]
        doc.add_paragraph(f"原始诉求: {problem['原始诉求']}")
        doc.add_paragraph(f"诊断后的核心问题: {problem['核心问题']}")

        # 二、关键发现
        doc.add_heading('二、关键发现', level=1)
        findings = structure["chapters"]["关键发现"]
        for stage, facts in findings.items():
            if facts:
                doc.add_heading(stage, level=2)
                for fact in facts:
                    doc.add_paragraph(fact, style='List Bullet')

        # 三、初步建议方向
        doc.add_heading('三、初步建议方向', level=1)
        for i, direction in enumerate(structure["chapters"]["初步建议方向"], 1):
            doc.add_paragraph(f"方向{i}: {direction['方向']}")

        doc.save(output_path)
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pytest tests/test_memo_generator.py -v
```

Expected: All tests PASS

- [ ] **Step 5: 提交备忘录生成器**

```bash
git add consultant_cockpit/src/core/memo_generator.py consultant_cockpit/tests/test_memo_generator.py
git commit -m "feat: 实现备忘录生成器(第一层+第二层)

- MemoGenerator: 三层架构(数据提取+结构组装+Word生成)
- 纯模板填充,零AI润色(Day 1最小版本)
- 完整单元测试

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Streamlit主应用(最小版本)

**Files:**
- Create: `consultant_cockpit/src/ui/main_app.py`

- [ ] **Step 1: 实现Streamlit主应用**

```python
# src/ui/main_app.py
import streamlit as st
from ..core.consensus_chain import ConsensusChain, ConsensusRecord
from ..core.candidate_generator import CandidateGenerator
from ..core.memo_generator import MemoGenerator
from ..utils.llm_client import LLMClient
from datetime import datetime

# 初始化
if "consensus_chain" not in st.session_state:
    st.session_state.consensus_chain = ConsensusChain()
if "llm_client" not in st.session_state:
    st.session_state.llm_client = LLMClient()

def main():
    st.title("顾问现场作战系统")

    # 侧边栏: 指令输入
    st.sidebar.header("快捷指令")

    # /记 指令
    manual_input = st.sidebar.text_input("/记 <内容>")
    if st.sidebar.button("记录"):
        if manual_input:
            record = ConsensusRecord(
                id=f"cc_{len(st.session_state.consensus_chain.records)}",
                timestamp=datetime.now(),
                type="fact",  # 简化,实际需要判断
                stage="战略梳理",
                content=manual_input,
                source="manual",
                status="recorded"
            )
            st.session_state.consensus_chain.add_record(record)
            st.success("已记录")

    # /候选 指令
    if st.sidebar.button("/候选"):
        generator = CandidateGenerator(
            st.session_state.llm_client,
            st.session_state.consensus_chain
        )
        # Mock备弹区SKU(Day 1使用mock数据)
        mock_skus = [{"id": "sku_001", "confidence": "🟢"}]
        constraints = generator.check_constraints(mock_skus)

        if constraints["valid"]:
            candidates = generator.generate_candidates()
            st.session_state.candidates = candidates
        else:
            st.warning(constraints["message"])

    # 主区域: 显示候选
    if "candidates" in st.session_state:
        st.header("候选方案")
        for i, candidate in enumerate(st.session_state.candidates):
            col1, col2, col3 = st.columns(3)
            with [col1, col2, col3][i]:
                if st.button(f"候选{i+1}: {candidate.title}", key=f"candidate_{i}"):
                    # 选中候选,自动进入共识链
                    record = ConsensusRecord(
                        id=f"cc_{len(st.session_state.consensus_chain.records)}",
                        timestamp=datetime.now(),
                        type="consensus",
                        stage="战略梳理",
                        content=candidate.description,
                        source="candidate_selected",
                        status="pending_client_confirm",
                        recommendation=candidate.title
                    )
                    st.session_state.consensus_chain.add_record(record)
                    st.success(f"已选择候选{i+1}")

    # 显示共识链
    st.header("共识链")
    for record in st.session_state.consensus_chain.records:
        with st.expander(f"{record.id}: {record.content[:30]}..."):
            st.write(f"类型: {record.type}")
            st.write(f"状态: {record.status}")
            st.write(f"内容: {record.content}")
            if record.status == "pending_client_confirm":
                if st.button(f"确认 {record.id}", key=f"confirm_{record.id}"):
                    st.session_state.consensus_chain.confirm_record(record.id)
                    st.rerun()

    # 生成备忘录
    if st.button("生成备忘录"):
        generator = MemoGenerator(st.session_state.consensus_chain)
        output_path = "memo_output.docx"
        generator.generate_word(output_path)
        st.success(f"备忘录已生成: {output_path}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行Streamlit应用**

```bash
cd consultant_cockpit
streamlit run src/ui/main_app.py
```

Expected: 浏览器打开,显示主界面

- [ ] **Step 3: 手动测试最小闭环**

测试步骤:
1. 在侧边栏输入"/记 客户产品线5条",点击"记录"
2. 重复步骤1,添加至少3条事实
3. 点击"/候选"按钮
4. 选择一个候选方案
5. 点击"确认"按钮
6. 点击"生成备忘录"

Expected: 生成memo_output.docx文件

- [ ] **Step 4: 提交Streamlit主应用**

```bash
git add consultant_cockpit/src/ui/main_app.py
git commit -m "feat: 实现Streamlit主应用(最小版本)

- 支持手动/记指令记录共识
- 支持候选生成和选择
- 支持备忘录生成
- Day 1最小闭环可验证

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Day 1验收检查点

- [ ] **验收1: 运行所有测试**

```bash
cd consultant_cockpit
pytest tests/ -v
```

Expected: All tests PASS

> ⚠️ **注意**：Day 1 测试用例未覆盖 `correctRecord/superseded` 修正路径（该功能在后续迭代实现）。
> Node.js 金标准测试集必须补充此场景测试用例。

- [ ] **验收2: 手动测试最小闭环**

重复Task 5 Step 3的测试步骤,确保完整流程无报错。

- [ ] **验收3: 检查生成的备忘录**

打开memo_output.docx,确认包含:
- 一、问题重构
- 二、关键发现
- 三、初步建议方向

---

**Day 1完成标志**: 最小闭环跑通,可记录共识→生成候选→选择候选→生成备忘录。✅ 已完成

**注意**: Day 1的候选生成器第三约束(SKU验证)使用mock数据占位,Day 2接入真实知识召回后补测。

---

## Day 1 实施状态

> **状态**: ✅ 已完成 (2026-05-02)
> **验收结果**: 最小闭环跑通，所有测试通过

### 已完成任务

- [x] Task 1: 项目初始化和依赖安装
- [x] Task 2: 共识链数据结构（含 correctRecord/superseded 修正路径）
- [x] Task 3: 候选生成器(MDU核心)（含 CandidateCache 预计算缓存）
- [x] Task 4: 最小备忘录生成器(纯模板填充)
- [x] Task 5: Streamlit主应用(最小版本)

### 已实现功能清单（Node.js 迁移可直接参考）

> ⚠️ **重要**：下表代码行号对应**实际源码**，非本文档 Task 步骤中展示的精简版代码。
> Node.js 迁移时请直接阅读源码，本文档代码片段仅作逻辑参考。

| 功能 | 实现文件 | 关键代码行 | 备注 |
|------|---------|-----------|------|
| correctRecord/superseded | consensus_chain.py | 61-100 | ✅ 完整实现 |
| CandidateCache 预计算缓存 | candidate_generator.py | 33-72, 304-401 | ✅ 线程安全、TTL、后台线程 |
| LLM 超时保护 | candidate_generator.py | 163-167 | 通过 FallbackHandler 实现 |
| 补充召回机制 | candidate_generator.py | 125-140 | 第三约束触发时召回 |

### 已知问题（Node.js 版本需修复）

**问题 #1**: `main_app.py` id 生成用数组长度，有冲突风险
- 代码: `f"cc_{len(chain.records)}"`
- 影响: correctRecord 新增记录后 id 可能重复
- 修复: Node.js 改用 `crypto.randomUUID()`

**问题 #2**: `_check_diversity` 是简化版（仅检查风险等级字符串）
- 代码: `len(set(risk_levels)) == 3`
- 影响: 三个候选都写"稳健"会无限重生成
- 修复: Node.js 可维持简化方案，但需在 A 文档明确说明

**问题 #3**: `llm_client.py` 缺失全局并发限流
- 当前: 裸调用 OpenAI SDK，无 p-limit(3) 限制
- 影响: 多候选并发生成时可能触发 API 限流
- 修复: Node.js 使用 `p-limit` 包限制并发为 3

---

## 后续任务(Day 2-3)

> 📌 Day 2-3 的详细实施步骤未文档化。
> 对应代码已在项目中，Node.js 迁移时直接阅读源码：
> - `knowledge_retriever.py` → `knowledgeRetriever.js`
> - `feishu_client.py` → `feishuClient.js`（注意 record_id Bug，见 v1.3 Day 0 验收）
> - `feishu_sync.py` → `feishuSync.js`（仅轮询，WebSocket 未集成）
> - `demo_mode.py` → 前端 `body.classList` 切换（Node.js 版本重新设计）
> - `fallback_handler.py` → `fallbackHandler.js`（降级模板已实现）
> - `battle_card_generator.py` → `battleCardGenerator.js`（双模式作战卡）

由于实施计划篇幅限制,Day 2-3的详细任务将在下一部分继续,包括:

**Day 2任务**:
- Task 6: 知识召回机制(关键词词典+匹配召回)
- Task 7: 三栏布局UI(左栏状态板+右栏建议卡)
- Task 8: 备忘录AI润色层
- Task 9: 演示模式切换
- Task 10: 飞书基础集成

**Day 3任务**:
- Task 11: 会前作战卡生成
- Task 12: 飞书实时同步
- Task 13: 最终演练和降级方案
- Task 14: 文档整理和部署脚本

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-consultant-field-cockpit-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
