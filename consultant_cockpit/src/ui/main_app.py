# src/ui/main_app.py
import sys
from pathlib import Path

# 动态添加项目根目录到 Python 路径
# 支持从 consultant_cockpit 目录或项目根目录运行
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent  # 知识萃取/
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# 同时添加 consultant_cockpit 目录（用于直接导入 src）
cockpit_dir = current_dir.parent  # consultant_cockpit/
if str(cockpit_dir) not in sys.path:
    sys.path.insert(0, str(cockpit_dir))

import streamlit as st
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from src.core.candidate_generator import CandidateGenerator
from src.core.memo_generator import MemoGenerator
from src.utils.llm_client import LLMClient
from datetime import datetime


def infer_type(content: str) -> str:
    """推断记录类型（fact/consensus）

    规则：包含共识关键词的判定为consensus，否则为fact
    """
    consensus_keywords = ["客户认可", "我们决定", "确认", "选择", "同意", "认可"]
    return "consensus" if any(kw in content for kw in consensus_keywords) else "fact"


# 初始化
if "consensus_chain" not in st.session_state:
    st.session_state.consensus_chain = ConsensusChain()
if "llm_client" not in st.session_state:
    st.session_state.llm_client = LLMClient()

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
            type="fact",
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