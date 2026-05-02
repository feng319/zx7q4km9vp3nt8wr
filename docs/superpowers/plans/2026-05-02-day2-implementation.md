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

### Task 9.1: 演示模式模块（CSS注入方案）

**核心原理:** 设计文档5.2节要求通过 `st.session_state.demo_mode` + **CSS类切换**实现，**不重新渲染组件**，只改CSS可见性。

- [ ] **Step 1: 创建演示模式模块（CSS注入版）**

```python
# src/ui/demo_mode.py
import streamlit as st
from typing import Dict, List

# 三级敏感度分区配置
# 第一级：完全隐藏区（CSS display: none）
HIDE_IN_DEMO = [
    "token_count", "api_response_time",
    "sku_id", "debug_log", "model_name",
    "knowledge_base_version_debug", "shortcut_hints"
]

# 第二级：内容替换区（替换显示文本）
REPLACE_IN_DEMO = {
    "当前阶段:战略梳理 Phase 1/3": "诊断进度:战略方向梳理",
    "共识链:7/9 字段已确认": "诊断完成度:78%",
    "候选方案(预计算缓存命中)": "初步建议方向",
    "[新能源-sku_037]": "标杆案例:",
}

def is_demo_mode() -> bool:
    """检查当前是否为演示模式"""
    return st.session_state.get("demo_mode", False)

def toggle_demo_mode():
    """切换演示模式"""
    current = st.session_state.get("demo_mode", False)
    st.session_state.demo_mode = not current

def get_display_text(text: str) -> str:
    """根据模式返回显示文本（第二级：内容替换）"""
    if is_demo_mode():
        for old, new in REPLACE_IN_DEMO.items():
            if old in text:
                text = text.replace(old, new)
    return text

def should_hide(element_id: str) -> bool:
    """判断元素是否应该在演示模式下隐藏（第一级：完全隐藏）"""
    if not is_demo_mode():
        return False
    return element_id in HIDE_IN_DEMO

def inject_demo_mode_css():
    """
    注入CSS样式实现演示模式切换（核心方法）

    设计文档要求：
    - 通过CSS类切换，不重新渲染组件
    - 瞬间完成（0.1秒内）
    - 每次重渲染时优先恢复CSS类
    """
    if is_demo_mode():
        # 演示模式CSS：隐藏第一级元素、放大第三级元素
        st.markdown("""
        <style>
        /* 第一级：完全隐藏 */
        .demo-hide { display: none !important; }

        /* 隐藏token计数、API响应时间等调试信息 */
        [data-testid="stCaption"] .debug-info,
        .element-container:has(.sku-id),
        .element-container:has(.token-count) {
            display: none !important;
        }

        /* 第三级：主动加分设计 */
        /* 四栏状态板字体放大120% */
        .status-board {
            font-size: 1.2em !important;
        }

        /* 候选方案卡片标题加粗加大 */
        .candidate-card h4 {
            font-weight: bold !important;
            font-size: 1.1em !important;
        }

        /* 知识库版本号营销格式 */
        .kb-version {
            font-size: 1.1em !important;
            font-weight: 500 !important;
        }
        </style>
        """, unsafe_allow_html=True)
    else:
        # 工作模式CSS：显示所有调试信息
        st.markdown("""
        <style>
        .demo-hide { display: block !important; }
        .status-board { font-size: 1em !important; }
        .candidate-card h4 { font-weight: normal !important; }
        </style>
        """, unsafe_allow_html=True)

def render_demo_mode_toggle():
    """渲染演示模式切换按钮（支持快捷键）"""
    # 注入CSS（每次渲染优先执行）
    inject_demo_mode_css()

    col1, col2 = st.columns([8, 2])
    with col2:
        current_mode = "🔵 演示模式" if is_demo_mode() else "⚫ 工作模式"
        if st.button(f"🔄 {current_mode}", key="toggle_demo"):
            toggle_demo_mode()
            st.rerun()

    # 快捷键绑定（F11 和 Ctrl+Shift+D）
    st.markdown("""
    <script>
    document.addEventListener('keydown', function(e) {
        // F11 或 Ctrl+Shift+D
        if (e.key === 'F11' || (e.ctrlKey && e.shiftKey && e.key === 'D')) {
            e.preventDefault();
            // 触发按钮点击（Streamlit会处理rerun）
            document.querySelector('[data-testid="baseButton-secondary"]').click();
        }
    });
    </script>
    """, unsafe_allow_html=True)

def render_status_badge():
    """渲染模式状态徽标（屏幕右上角小圆点）"""
    badge = "🔵" if is_demo_mode() else "⚫"
    st.markdown(f"""
    <div style="position: fixed; top: 10px; right: 10px; z-index: 9999;">
        <span style="font-size: 12px;">{badge}</span>
    </div>
    """, unsafe_allow_html=True)

def wrap_with_demo_class(content: str, element_id: str) -> str:
    """
    包装元素，根据敏感度分区添加CSS类

    用法示例：
    - 第一级隐藏：wrap_with_demo_class(content, "token_count")
    - 第二级替换：先调用 get_display_text()，再包装
    """
    css_class = "demo-hide" if should_hide(element_id) else ""
    return f'<div class="{css_class}">{content}</div>'
```

### Task 9.2: 验收测试（手动测试流程）

**重要:** Streamlit的`st.session_state`无法通过`unittest.mock`有效模拟，需使用手动测试。

- [ ] **Step 2: 手动验收测试流程**

```markdown
## 演示模式验收测试清单

### 测试1: 瞬间切换
1. 启动应用 `npm start`
2. 记录几条事实，触发候选生成
3. 点击"🔄 工作模式"按钮
4. [ ] 验证：切换在0.1秒内完成，无闪烁
5. [ ] 验证：调试信息（token计数、SKU ID）消失

### 测试2: 重渲染恢复
1. 在演示模式下，添加一条新记录
2. [ ] 验证：添加操作触发rerun后，演示模式仍然开启
3. [ ] 验证：右上角蓝色徽标仍然显示
4. 切换回工作模式
5. [ ] 验证：调试信息恢复显示

### 测试3: 内容替换
1. 切换到演示模式
2. [ ] 验证："当前阶段:战略梳理 Phase 1/3" 显示为 "诊断进度:战略方向梳理"
3. [ ] 验证：SKU编号 `[sku_037]` 被替换为 `标杆案例:`

### 测试4: 主动加分设计
1. 切换到演示模式
2. [ ] 验证：四栏状态板字体放大
3. [ ] 验证：候选方案卡片标题加粗
4. 截图对比：演示模式 vs 工作模式
5. [ ] 验证：演示模式明显更专业

### 测试5: 快捷键（可选，Day 3实现）
1. 按 F11
2. [ ] 验证：触发演示模式切换 + 全屏
3. 按 Ctrl+Shift+D
4. [ ] 验证：触发演示模式切换
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

**前提:** 根目录已有完整实现的 `feishu_client.py`（函数式），需要整合到项目目录并封装为类。

- [ ] **Step 1: 整合现有 feishu_client.py 到项目目录**

将根目录的 `feishu_client.py` 复制到 `consultant_cockpit/src/integrations/feishu_client.py`，并封装为类：

```python
# src/integrations/feishu_client.py
"""飞书多维表格客户端 - 基于 lark-cli 子进程封装"""
import subprocess, json, os
from pathlib import Path
from dotenv import load_dotenv
from typing import Dict, Optional, List

load_dotenv()

APP_TOKEN = os.getenv("FEISHU_BITABLE_APP_TOKEN")
TABLE_ID = os.getenv("FEISHU_BITABLE_TABLE_ID")
DOC_TEMPLATE_TOKEN = os.getenv("FEISHU_DOC_TEMPLATE_TOKEN")


def _run_cli(args: list[str], use_format: bool = True) -> dict:
    """统一执行 lark-cli 命令，返回 JSON。"""
    cmd = ["lark-cli.cmd"] + args
    if use_format:
        cmd += ["--format", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, shell=True, encoding='utf-8')
    if result.returncode != 0:
        raise RuntimeError(f"lark-cli failed: {result.stderr}")
    return json.loads(result.stdout) if result.stdout else {}


class FeishuClient:
    """飞书多维表格客户端"""

    def __init__(self):
        self.app_token = APP_TOKEN
        self.table_id = TABLE_ID
        self.doc_template_token = DOC_TEMPLATE_TOKEN

    def _get_field_names(self) -> List[str]:
        """获取表格字段名列表"""
        fields_data = _run_cli([
            "base", "+field-list",
            "--base-token", self.app_token,
            "--table-id", self.table_id,
        ], use_format=False)
        return [f["name"] for f in fields_data.get("data", {}).get("fields", [])]

    def list_records(self) -> List[Dict]:
        """列出所有客户记录（保留原始结构）"""
        data = _run_cli([
            "base", "+record-list",
            "--base-token", self.app_token,
            "--table-id", self.table_id,
        ], use_format=True)
        if "data" in data and "items" not in data:
            # 返回格式可能是 {"data": {"data": [...], "fields": [...]}}
            # 或 {"data": {"items": [...]}}
            inner = data.get("data", {})
            return inner.get("data", inner.get("items", []))
        return data.get("items", [])

    def get_client_profile(self, company: str) -> Optional[Dict]:
        """
        获取客户档案（按公司名查询）

        注意：需要正确提取 record_id 用于后续更新操作。
        lark-cli +record-list 返回的每条记录结构可能是：
        - dict 格式: {"record_id": "xxx", "fields": {...}}
        - list 格式: [field1_value, field2_value, ...]（record_id 在独立字段）

        建议先运行调试命令确认实际结构。
        """
        field_names = self._get_field_names()
        for r in self.list_records():
            if isinstance(r, dict):
                # dict 格式：fields 在 "fields" 键里
                fields = r.get("fields", {})
                if fields.get("客户公司名") == company:
                    return {"record_id": r.get("record_id"), "fields": fields}
            elif isinstance(r, list):
                # list 格式：按字段顺序解析
                fields_dict = {}
                for i, name in enumerate(field_names):
                    if i < len(r):
                        fields_dict[name] = r[i]
                if fields_dict.get("客户公司名") == company:
                    # list 格式下 record_id 通常不在列表里，需要从其他来源获取
                    # 这种情况需要额外 API 调用或调整 list_records 返回格式
                    return {"record_id": None, "fields": fields_dict}
        return None

    def sync_consensus_record(self, record: Dict) -> bool:
        """
        同步共识记录到飞书

        Args:
            record: ConsensusRecord 的字典表示，包含 id, type, content, status 等字段

        Returns:
            bool: 同步成功返回 True
        """
        company = record.get("company_name", "默认客户")
        content = record.get("content", "")
        record_type = record.get("type", "fact")
        status = record.get("status", "recorded")

        # 构造要更新的字段
        fields = {
            "共识类型": record_type,
            "共识内容": content,
            "状态": status,
        }

        try:
            self.upsert_record(company, fields)
            return True
        except Exception as e:
            print(f"飞书同步失败: {e}")
            return False

    def upsert_record(self, company: str, fields: Dict) -> Dict:
        """新增或更新一条客户记录"""
        fields = {**fields, "客户公司名": company}
        existing = self.get_client_profile(company)

        field_names = list(fields.keys())
        field_values = [fields[k] for k in field_names]

        if existing:
            return _run_cli([
                "base", "+record-upsert",
                "--base-token", self.app_token,
                "--table-id", self.table_id,
                "--record-id", existing["record_id"],
                "--json", json.dumps(fields, ensure_ascii=False),
            ], use_format=False)

        return _run_cli([
            "base", "+record-batch-create",
            "--base-token", self.app_token,
            "--table-id", self.table_id,
            "--json", json.dumps({"fields": field_names, "rows": [field_values]}, ensure_ascii=False),
        ], use_format=False)

    def update_diagnosis_progress(self, progress: float, company: str = None):
        """
        更新诊断进度

        Args:
            progress: 进度值 0.0-1.0
            company: 客户公司名（可选）
        """
        if company is None:
            company = "默认客户"

        fields = {"诊断进度": f"{progress:.0%}"}
        self.upsert_record(company, fields)

    def calc_completeness(self, record: Optional[Dict]) -> float:
        """程序硬规则判断完整度，返回 0.0-1.0"""
        if not record:
            return 0.0
        rules = {
            "产品线": 20, "客户群体": 10, "收入结构": 10,
            "毛利结构": 10, "交付情况": 10, "资源分布": 10, "战略目标": 15,
        }
        fields = record.get("fields", {})
        filled = sum(1 for k, min_len in rules.items()
                     if len(str(fields.get(k, ""))) >= min_len)
        return filled / len(rules)

    def render_to_doc(self, company: str, doc_token: str = None) -> Dict:
        """把多维表格记录渲染到云文档"""
        if doc_token is None:
            doc_token = self.doc_template_token

        record = self.get_client_profile(company)
        if not record:
            raise ValueError(f"找不到客户：{company}")
        f = record["fields"]

        template = Path("doc_template.md").read_text(encoding="utf-8")
        rendered = template
        for key in ["客户公司名", "产品线", "客户群体", "收入结构",
                    "毛利结构", "交付情况", "资源分布", "战略目标"]:
            rendered = rendered.replace(f"{{{{{key}}}}}", str(f.get(key, "（待填充）")))

        return _run_cli([
            "docs", "+update",
            "--doc", doc_token,
            "--markdown", rendered,
        ], use_format=False)


# 模块级函数（向后兼容）
def list_records() -> List[Dict]:
    """列出所有客户记录（模块级函数）"""
    return FeishuClient().list_records()

def get_record_by_company(company: str) -> Optional[Dict]:
    """按公司名查询单条记录（模块级函数）"""
    return FeishuClient().get_client_profile(company)

def upsert_record(company: str, fields: Dict) -> Dict:
    """新增或更新一条客户记录（模块级函数）"""
    return FeishuClient().upsert_record(company, fields)

def calc_completeness(record: Optional[Dict]) -> float:
    """计算完整度（模块级函数）"""
    return FeishuClient().calc_completeness(record)
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
