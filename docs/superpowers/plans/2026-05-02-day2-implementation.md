# Day 2 实施计划：完整功能 + 飞书集成

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Day 2 五大任务，实现知识召回、三栏UI、AI润色、演示模式、飞书集成。

**设计文档:** `docs/superpowers/specs/2026-05-02-consultant-field-cockpit-design.md`

**Tech Stack:** Python 3.12 (系统安装), Streamlit, OpenAI SDK, python-docx, lark-cli, Pydantic

**重要环境说明:**
- 系统存在多个 Python 版本，必须使用 Python 3.12 (C:/Users/56839/AppData/Local/Programs/Python/Python312/python.exe)
- 不依赖虚拟环境，依赖已安装到系统 Python 3.12
- 启动命令: consultant_cockpit/start.bat 或 npm start (端口 8501)

---

## 依赖关系图

```
Task 10a (feishu_client封装) ──┐
                               ├──→ Task 6 (知识召回) ──→ Task 7 (三栏UI) ──┬──→ Task 9 (演示模式)
                               │    [含时间戳召回结果]   [纯展示组件]        │
                               │                                             └──→ Task 10b (飞书整合)
                               └──→ Task 8 (AI润色)
                                    [等第一二层结构冻结后启动]
```

---

## Task 6: 知识召回机制

**设计文档章节:** 二、知识召回机制设计

**Files:**
- Create: `consultant_cockpit/src/core/knowledge_retriever.py`
- Create: `consultant_cockpit/config/keywords.json`
- Create: `consultant_cockpit/tests/test_knowledge_retriever.py`

**核心交付物:**
- `knowledge_retriever.py`: 知识召回模块
- `keywords.json`: 50-80个核心概念词典
- 召回结果必须含时间戳（用于3分钟半透明化逻辑）
- 备弹区数据结构在此冻结

### Task 6.1: 关键词词典

- [ ] **Step 1: 创建关键词词典**

```json
// config/keywords.json
{
  "keywords": [
    {
      "concept": "虚拟电厂",
      "synonyms": ["VPP", "聚合商", "负荷聚合", "调度平台"],
      "stage": "商业模式"
    },
    {
      "concept": "储能",
      "synonyms": ["储能系统", "ESS", "电池储能", "工商业储能"],
      "stage": "战略梳理"
    }
    // ... 50-80个核心概念
  ]
}
```

**词典填充说明：** 词典内容从 `spec.md` 的功能二（场景化对标）和功能三（供应商切入路径）章节手动提取，**最少覆盖 20 个概念后才能运行 Task 6 的测试**。

### Task 6.2: 知识召回模块

- [ ] **Step 2: 实现知识召回器**

```python
# src/core/knowledge_retriever.py
from typing import List, Dict, Optional
from datetime import datetime
from pydantic import BaseModel
import json
from pathlib import Path

class SKUCard(BaseModel):
    """SKU弹药卡片"""
    id: str
    title: str
    summary: str
    confidence: str  # 🟢/🟡/🔴
    stage: str
    recalled_at: datetime  # 召回时间戳，用于3分钟半透明化

class KnowledgeRetriever:
    """知识召回器"""

    def __init__(self, keywords_path: str = "config/keywords.json"):
        self.keywords = self._load_keywords(keywords_path)
        self.sku_cache: List[SKUCard] = []  # 备弹区缓存
        self.last_recall_time: Optional[datetime] = None

    def _load_keywords(self, path: str) -> List[Dict]:
        """加载关键词词典"""
        full_path = Path(__file__).parent.parent.parent / path
        with open(full_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("keywords", [])

    def match_keywords(self, text: str) -> List[str]:
        """从文本中匹配关键词"""
        matched = []
        text_lower = text.lower()
        for kw in self.keywords:
            if kw["concept"] in text:
                matched.append(kw["concept"])
                continue
            for syn in kw.get("synonyms", []):
                if syn.lower() in text_lower:
                    matched.append(kw["concept"])
                    break
        return list(set(matched))

    def recall_by_keywords(self, keywords: List[str], top_k: int = 3) -> List[SKUCard]:
        """根据关键词召回SKU（Day 2使用mock数据，Day 3接入真实知识库）"""
        # Mock SKU数据
        mock_skus = [
            SKUCard(
                id="sku_001",
                title="设备商转运营商路径",
                summary="从设备销售转向运营服务的典型案例",
                confidence="🟢",
                stage="商业模式",
                recalled_at=datetime.now()
            ),
            SKUCard(
                id="sku_002",
                title="储能系统集成商商业模式",
                summary="工商业储能系统集成商的盈利模式分析",
                confidence="🟡",
                stage="商业模式",
                recalled_at=datetime.now()
            ),
            SKUCard(
                id="sku_003",
                title="虚拟电厂聚合商案例",
                summary="负荷聚合商参与电力市场的路径",
                confidence="🟢",
                stage="战略梳理",
                recalled_at=datetime.now()
            )
        ]

        # 按关键词过滤（简化版，实际需要embedding）
        recalled = []
        for sku in mock_skus:
            for kw in keywords:
                if kw in sku.title or kw in sku.summary:
                    recalled.append(sku)
                    break

        # 更新缓存和时间戳
        if recalled:
            self.sku_cache = recalled[:top_k]
            self.last_recall_time = datetime.now()

        return self.sku_cache

    def get_fresh_skus(self, max_age_seconds: int = 180) -> List[SKUCard]:
        """获取新鲜度合格的SKU（3分钟以上的半透明化）"""
        now = datetime.now()
        fresh_skus = []
        for sku in self.sku_cache:
            age = (now - sku.recalled_at).total_seconds()
            if age <= max_age_seconds:
                fresh_skus.append(sku)
        return fresh_skus

    def check_rate_limit(self, min_interval_seconds: int = 5) -> bool:
        """检查召回限流（同一关键词5秒内不重复触发）"""
        if not self.last_recall_time:
            return True
        elapsed = (datetime.now() - self.last_recall_time).total_seconds()
        return elapsed >= min_interval_seconds
```

- [ ] **Step 3: 编写测试**

```python
# tests/test_knowledge_retriever.py
import pytest
from datetime import datetime, timedelta
from src.core.knowledge_retriever import KnowledgeRetriever, SKUCard

def test_match_keywords():
    """测试关键词匹配"""
    retriever = KnowledgeRetriever()
    matched = retriever.match_keywords("客户想做虚拟电厂业务")
    assert "虚拟电厂" in matched

def test_recall_by_keywords():
    """测试关键词召回"""
    retriever = KnowledgeRetriever()
    skus = retriever.recall_by_keywords(["虚拟电厂"])
    assert len(skus) <= 3
    assert all(isinstance(sku, SKUCard) for sku in skus)
    # 验证时间戳
    assert all(sku.recalled_at is not None for sku in skus)

def test_sku_timestamp():
    """测试SKU时间戳（用于3分钟半透明化）"""
    retriever = KnowledgeRetriever()
    retriever.recall_by_keywords(["储能"])

    # 模拟3分钟后的SKU
    old_sku = SKUCard(
        id="sku_old",
        title="旧SKU",
        summary="3分钟前的召回",
        confidence="🟢",
        stage="战略梳理",
        recalled_at=datetime.now() - timedelta(minutes=4)
    )
    retriever.sku_cache.append(old_sku)

    fresh = retriever.get_fresh_skus(max_age_seconds=180)
    assert len(fresh) < len(retriever.sku_cache)  # 旧SKU被过滤

def test_rate_limit():
    """测试召回限流"""
    retriever = KnowledgeRetriever()
    retriever.recall_by_keywords(["储能"])

    # 立即再次召回应该被限流
    assert not retriever.check_rate_limit(min_interval_seconds=5)
```

- [ ] **Step 4: 运行测试验证**

```bash
cd consultant_cockpit
pytest tests/test_knowledge_retriever.py -v
```

---

## Task 7: 三栏布局UI

**设计文档章节:** 六.5、会议中追问交互设计

**Files:**
- Modify: `consultant_cockpit/src/ui/main_app.py`

**核心交付物:**
- 三栏布局（左3:中5:右2）
- 左栏状态板（字段完整度实时显示）
- 右栏建议卡（追问建议 + 分支选项）
- **纯展示组件，不含业务逻辑**

**关键约束:**
- 左栏和右栏只读取 `st.session_state`，不包含计算逻辑
- 业务逻辑（完整度计算、追问建议生成）属于其他模块

### Task 7.1: 三栏布局重构

- [ ] **Step 1: 重构 main_app.py 为三栏布局**

```python
# src/ui/main_app.py - 三栏布局版本
import streamlit as st
from datetime import datetime

# ... imports ...

def render_left_panel():
    """左栏：字段完整度状态板（纯展示）"""
    st.markdown("### 诊断进度")

    # 从 session_state 读取完整度（由其他模块计算）
    completeness = st.session_state.get("client_profile_completeness", 0.0)

    # 进度条
    st.progress(completeness)
    st.caption(f"完整度: {completeness:.0%}")

    # 字段状态列表
    fields_status = st.session_state.get("fields_status", {})
    for field, status in fields_status.items():
        if status == "confirmed":
            st.markdown(f"✓ {field}")
        elif status == "partial":
            st.markdown(f"◑ {field}")
        else:
            st.markdown(f"○ {field}")

def render_center_panel():
    """中栏：主对话区"""
    st.markdown("### 对话区")

    # 候选方案显示
    if "candidates" in st.session_state:
        render_candidates(st.session_state.candidates)

    # 共识链显示
    render_consensus_chain()

def render_right_panel():
    """右栏：追问建议卡（纯展示）"""
    st.markdown("### 建议")

    # 从 session_state 读取当前追问建议
    suggestion = st.session_state.get("current_suggestion")

    if suggestion:
        st.info(suggestion["question"])

        col1, col2, col3 = st.columns(3)
        with col1:
            if st.button("用这个问题", key="use_suggestion"):
                st.session_state.selected_question = suggestion["question"]
        with col2:
            if st.button("跳过", key="skip_suggestion"):
                pass  # 触发下一个建议
        with col3:
            if st.button("我来写", key="custom_question"):
                st.session_state.custom_question_mode = True

    # 备弹区（SKU卡片）
    st.markdown("---")
    st.markdown("**备弹区**")
    skus = st.session_state.get("sku_cache", [])
    for sku in skus:
        with st.expander(f"{sku.confidence} {sku.title}"):
            st.write(sku.summary)

def main():
    st.title("顾问现场作战系统")

    # 三栏布局
    col_left, col_center, col_right = st.columns([3, 5, 2])

    with col_left:
        render_left_panel()

    with col_center:
        render_center_panel()

    with col_right:
        render_right_panel()

if __name__ == "__main__":
    main()
```

---

## Task 8: 备忘录AI润色层

**设计文档章节:** 七.5、语言润色层

**Files:**
- Modify: `consultant_cockpit/src/core/memo_generator.py`

**核心交付物:**
- 第三层AI润色实现
- 五条硬约束验证
- 降级策略（润色失败时使用原始要点）

**前置条件:** Day 1 备忘录第一二层结构已冻结

### Task 8.1: AI润色层实现

- [ ] **Step 1: 实现第三层AI润色**

```python
# src/core/memo_generator.py - 增加第三层

class MemoGenerator:
    """备忘录生成器（三层架构）"""

    def __init__(self, consensus_chain: ConsensusChain, llm_client: LLMClient = None):
        self.consensus_chain = consensus_chain
        self.llm_client = llm_client

    # ... 第一层和第二层保持不变 ...

    def polish_chapter(self, chapter_data: Dict, max_words: int = 200) -> str:
        """第三层：AI润色章节"""
        if not self.llm_client:
            # 降级：无LLM时直接返回要点列表
            return self._format_as_bullets(chapter_data)

        prompt = f"""请将以下要点转化成连贯的段落文字。

要求：
1. 只能用下面的要点，不能添加任何额外信息
2. 字数不超过{max_words}字
3. 所有数字和专有名词必须与原始要点完全一致
4. 语气专业、客观、建设性，不使用夸张词汇

要点：
{json.dumps(chapter_data, ensure_ascii=False, indent=2)}

直接输出润色后的段落，不要其他解释。"""

        try:
            result = self.llm_client.generate(prompt, temperature=0.3)
            # 字数截断
            if len(result) > max_words:
                result = result[:max_words] + "..."
            return result
        except Exception as e:
            # 降级：润色失败时使用原始要点
            return self._format_as_bullets(chapter_data)

    def _format_as_bullets(self, chapter_data: Dict) -> str:
        """降级：格式化为要点列表"""
        lines = []
        for key, value in chapter_data.items():
            if isinstance(value, list):
                for item in value:
                    lines.append(f"- {item}")
            else:
                lines.append(f"- {key}: {value}")
        return "\n".join(lines)
```

---

## Task 9: 演示模式切换

**设计文档章节:** 五、演示模式设计

**Files:**
- Create: `consultant_cockpit/src/ui/demo_mode.py`
- Modify: `consultant_cockpit/src/ui/main_app.py`

**核心交付物:**
- 三级敏感度分区（完全隐藏/内容替换/保留）
- 瞬间切换（0.1秒内完成）
- 重渲染恢复机制（验收条件）

**依赖:** Task 6 + Task 7 完成后才能开始

### Task 9.1: 演示模式模块

- [ ] **Step 1: 创建演示模式模块**

```python
# src/ui/demo_mode.py
import streamlit as st
from typing import Dict, List

# 三级敏感度分区配置
HIDE_IN_DEMO = [
    "token_count", "api_response_time",
    "sku_id", "debug_log", "model_name",
    "knowledge_base_version_debug", "shortcut_hints"
]

REPLACE_IN_DEMO = {
    "当前阶段:战略梳理 Phase 1/3": "诊断进度:战略方向梳理",
    "共识链:7/9 字段已确认": "诊断完成度:78%",
    "候选方案(预计算缓存命中)": "初步建议方向",
}

def is_demo_mode() -> bool:
    """检查当前是否为演示模式"""
    return st.session_state.get("demo_mode", False)

def toggle_demo_mode():
    """切换演示模式"""
    current = st.session_state.get("demo_mode", False)
    st.session_state.demo_mode = not current

def get_display_text(text: str) -> str:
    """根据模式返回显示文本"""
    if is_demo_mode():
        return REPLACE_IN_DEMO.get(text, text)
    return text

def should_hide(element_id: str) -> bool:
    """判断元素是否应该在演示模式下隐藏"""
    if not is_demo_mode():
        return False
    return element_id in HIDE_IN_DEMO

def render_demo_mode_toggle():
    """渲染演示模式切换按钮"""
    col1, col2 = st.columns([8, 2])
    with col2:
        current_mode = "演示模式" if is_demo_mode() else "工作模式"
        if st.button(f"🔄 {current_mode}", key="toggle_demo"):
            toggle_demo_mode()
            st.rerun()

def render_status_badge():
    """渲染模式状态徽标"""
    if is_demo_mode():
        st.markdown("🔵 演示模式", unsafe_allow_html=True)
    else:
        st.markdown("⚫ 工作模式", unsafe_allow_html=True)
```

### Task 9.2: 验收测试

- [ ] **Step 2: 重渲染恢复测试**

```python
# tests/test_demo_mode.py
import pytest
from unittest.mock import patch
from src.ui.demo_mode import is_demo_mode, toggle_demo_mode

def test_demo_mode_persists_after_rerun():
    """测试重渲染后演示模式状态不丢失"""
    # 模拟 session_state
    with patch('streamlit.session_state', new_callable=dict) as mock_state:
        mock_state["demo_mode"] = True

        # 模拟重渲染
        result = is_demo_mode()

        assert result == True  # 状态应该保持
```

---

## Task 10: 飞书集成

**设计文档章节:** 四.4、飞书侧显示设计

**Files:**
- Create: `consultant_cockpit/src/integrations/feishu_client.py`
- Modify: `consultant_cockpit/src/core/consensus_chain.py`

**核心交付物:**
- Task 10a: feishu_client.py 封装（独立，可与 Task 6 并行）
- Task 10b: 整合到 consensus_chain.py（依赖 Task 7 完成）

### Task 10a: 飞书客户端封装

- [ ] **Step 1: 整合现有 feishu_client.py**

将根目录的 `feishu_client.py` 整合到 `consultant_cockpit/src/integrations/feishu_client.py`，并增加共识链同步方法。

```python
# src/integrations/feishu_client.py
import subprocess, json, os
from pathlib import Path
from dotenv import load_dotenv
from typing import Dict, Optional

load_dotenv()

APP_TOKEN = os.getenv("FEISHU_BITABLE_APP_TOKEN")
TABLE_ID = os.getenv("FEISHU_BITABLE_TABLE_ID")

class FeishuClient:
    """飞书多维表格客户端"""

    def __init__(self):
        self.app_token = APP_TOKEN
        self.table_id = TABLE_ID

    def sync_consensus_record(self, record: Dict) -> bool:
        """同步共识记录到飞书"""
        # 实现同步逻辑
        pass

    def get_client_profile(self, company: str) -> Optional[Dict]:
        """获取客户档案"""
        # 实现获取逻辑
        pass

    def update_diagnosis_progress(self, progress: float):
        """更新诊断进度"""
        # 实现更新逻辑
        pass
```

### Task 10b: 整合到共识链

- [ ] **Step 2: 在共识链中集成飞书同步**

```python
# src/core/consensus_chain.py - 增加飞书同步

class ConsensusChain:
    """共识链管理器"""

    def __init__(self, feishu_client=None):
        self.records: List[ConsensusRecord] = []
        self.feishu_client = feishu_client

    def add_record(self, record: ConsensusRecord, sync_to_feishu: bool = True):
        """添加记录（可选同步到飞书）"""
        self.records.append(record)

        if sync_to_feishu and self.feishu_client:
            try:
                self.feishu_client.sync_consensus_record(record.model_dump())
            except Exception as e:
                # 飞书同步失败不影响本地记录
                print(f"飞书同步失败: {e}")
```

---

## Day 2 验收标准

- [ ] **验收1: 所有测试通过**

```bash
cd consultant_cockpit
pytest tests/ -v
```

- [ ] **验收2: lark-cli 写入/读取测试通过**

```bash
python -c "from src.integrations.feishu_client import FeishuClient; c = FeishuClient(); print(c.get_client_profile('测试客户A'))"
```

- [ ] **验收3: 完整流程跑通**

1. 启动 Streamlit: `npm start`
2. 记录3条事实
3. 触发候选生成
4. 选择候选
5. 确认共识
6. 切换演示模式
7. 生成备忘录
8. 验证飞书同步

---

**Day 2 完成标志:** 完整功能可用 + 飞书同步正常 + 演示模式切换正常。
