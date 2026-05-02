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
