# src/ui/main_app.py - 三栏布局版本
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
from src.core.knowledge_retriever import KnowledgeRetriever, SKUCard
from src.utils.llm_client import LLMClient
from datetime import datetime


def infer_type(content: str) -> str:
    """推断记录类型（fact/consensus）

    规则：包含共识关键词的判定为consensus，否则为fact
    """
    consensus_keywords = ["客户认可", "我们决定", "确认", "选择", "同意", "认可"]
    return "consensus" if any(kw in content for kw in consensus_keywords) else "fact"


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


def render_candidates(candidates):
    """渲染候选方案"""
    st.header("候选方案")
    for i, candidate in enumerate(candidates):
        col1, col2, col3 = st.columns(3)
        cols = [col1, col2, col3]
        with cols[i % 3]:
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


def render_consensus_chain():
    """渲染共识链"""
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


def render_center_panel():
    """中栏：主对话区"""
    st.markdown("### 对话区")

    # 候选方案显示
    if "candidates" in st.session_state:
        render_candidates(st.session_state.candidates)

    # 共识链显示
    render_consensus_chain()

    # 快捷指令区
    st.markdown("---")
    st.markdown("**快捷指令**")

    # /记 指令
    manual_input = st.text_input("/记 <内容>", key="manual_input")
    col1, col2 = st.columns(2)
    with col1:
        if st.button("记录"):
            if manual_input:
                record_type = infer_type(manual_input)
                record = ConsensusRecord(
                    id=f"cc_{len(st.session_state.consensus_chain.records)}",
                    timestamp=datetime.now(),
                    type=record_type,
                    stage="战略梳理",
                    content=manual_input,
                    source="manual",
                    status="recorded"
                )
                st.session_state.consensus_chain.add_record(record)
                st.success(f"已记录 (类型: {record_type})")

    with col2:
        # /候选 指令
        if st.button("/候选"):
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

    # 生成备忘录
    if st.button("生成备忘录"):
        generator = MemoGenerator(st.session_state.consensus_chain)
        output_path = "memo_output.docx"
        generator.generate_word(output_path)
        st.success(f"备忘录已生成: {output_path}")


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
                # 清空当前建议，触发下一次知识召回
                st.session_state.pop("current_suggestion", None)
                st.rerun()
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
    # 初始化
    if "consensus_chain" not in st.session_state:
        st.session_state.consensus_chain = ConsensusChain()
    if "llm_client" not in st.session_state:
        st.session_state.llm_client = LLMClient()
    if "knowledge_retriever" not in st.session_state:
        st.session_state.knowledge_retriever = KnowledgeRetriever()
    if "sku_cache" not in st.session_state:
        st.session_state.sku_cache = []

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
