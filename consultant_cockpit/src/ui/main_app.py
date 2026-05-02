# src/ui/main_app.py - 三栏布局版本 + Day 3 作战卡集成
"""顾问现场作战系统主界面

设计文档参考：
- 1.4 节：快捷指令定义
- 4.2 节：/记 指令类型推断
- 4.3 节：阶段切换
- 6.5 节：三栏布局
"""
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
from src.core.battle_card_generator import BattleCardGenerator
from src.core.fallback_handler import FallbackHandler
from src.utils.llm_client import LLMClient
from src.integrations.feishu_client import FeishuClient
from src.integrations.feishu_sync import FeishuSync, FeishuSyncMock
from datetime import datetime


# ============= 阶段定义 =============
STAGES = ["战略梳理", "商业模式", "行业演示"]


def infer_type(content: str) -> str:
    """推断记录类型（fact/consensus）

    设计文档 4.2 节：
    - 包含"客户认可"/"我们决定"等词的判定为 consensus
    - 其余默认为 fact
    """
    consensus_keywords = ["客户认可", "我们决定", "确认", "选择", "同意", "认可"]
    return "consensus" if any(kw in content for kw in consensus_keywords) else "fact"


def get_current_stage() -> str:
    """获取当前阶段"""
    return st.session_state.get("current_stage", "战略梳理")


def set_current_stage(stage: str):
    """设置当前阶段（触发候选预计算重算）"""
    st.session_state.current_stage = stage
    # 触发候选缓存失效
    if "candidate_generator" in st.session_state:
        st.session_state.candidate_generator._cache.invalidate()


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
    """中栏：主对话区

    设计文档 1.4 节快捷指令：
    - /记 <内容>：记录事实或共识
    - /确认：锁定最近一条待确认共识
    - /切 <阶段>：切换阶段
    - /候选：生成候选方案
    - /案例 <关键词>：召回案例（第一层指令召回）
    """
    st.markdown("### 对话区")

    # 显示当前阶段
    current_stage = get_current_stage()
    st.caption(f"当前阶段: **{current_stage}**")

    # 候选方案显示
    if "candidates" in st.session_state:
        render_candidates(st.session_state.candidates)

    # 共识链显示
    render_consensus_chain()

    # 快捷指令区
    st.markdown("---")
    st.markdown("**快捷指令**")

    # 指令输入区
    command_input = st.text_input("输入指令（如：/记、/确认、/切、/候选、/案例）", key="command_input")

    # 解析指令
    if command_input:
        parse_and_execute_command(command_input)

    # 常用指令按钮（备用）
    st.markdown("---")
    col1, col2, col3, col4 = st.columns(4)

    # 检查候选生成条件是否满足（红点徽标提示）
    candidate_generator = st.session_state.candidate_generator
    facts_count = len(st.session_state.consensus_chain.get_confirmed_facts())
    pending_count = len(st.session_state.consensus_chain.get_pending_consensus())
    candidate_ready = facts_count >= 3 and pending_count >= 1

    with col1:
        # 红点徽标（设计文档 3.1 节）
        badge = "🔴 " if candidate_ready else ""
        if st.button(f"{badge}/候选", help="生成候选方案" + (" (条件已满足)" if candidate_ready else "")):
            execute_candidate_command()

    with col2:
        if st.button("/确认", help="锁定最近一条待确认共识"):
            execute_confirm_command()

    with col3:
        if st.button("/切", help="切换到下一阶段"):
            execute_stage_switch_command()

    with col4:
        if st.button("/案例", help="召回案例"):
            execute_case_recall_command()

    # 生成备忘录
    st.markdown("---")
    if st.button("生成备忘录"):
        execute_memo_generation()


def parse_and_execute_command(command: str):
    """解析并执行指令

    支持的指令格式：
    - /记 <内容>
    - /确认
    - /切 <阶段名>
    - /候选
    - /案例 <关键词>
    - /框架 <关键词>
    - /对比 <关键词>
    """
    command = command.strip()

    if command.startswith("/记"):
        content = command[3:].strip()
        if content:
            execute_record_command(content)

    elif command == "/确认":
        execute_confirm_command()

    elif command.startswith("/切"):
        stage = command[3:].strip()
        if stage:
            execute_stage_switch_command(stage)
        else:
            # 切换到下一阶段
            execute_stage_switch_command()

    elif command == "/候选":
        execute_candidate_command()

    elif command.startswith("/案例"):
        keywords = command[4:].strip()
        execute_case_recall_command(keywords)

    elif command.startswith("/框架"):
        keywords = command[4:].strip()
        execute_case_recall_command(keywords, mode="framework")

    elif command.startswith("/对比"):
        keywords = command[4:].strip()
        execute_case_recall_command(keywords, mode="comparison")

    else:
        st.warning(f"未知指令: {command}")


def execute_record_command(content: str):
    """执行 /记 指令"""
    record_type = infer_type(content)
    current_stage = get_current_stage()

    record = ConsensusRecord(
        id=f"cc_{len(st.session_state.consensus_chain.records)}",
        timestamp=datetime.now(),
        type=record_type,
        stage=current_stage,
        content=content,
        source="manual",
        status="recorded"
    )
    st.session_state.consensus_chain.add_record(record)
    st.success(f"已记录 (类型: {record_type}, 阶段: {current_stage})")


def execute_confirm_command():
    """执行 /确认 指令

    设计文档 4.2 节：锁定最近一条待确认共识
    """
    pending = st.session_state.consensus_chain.get_pending_consensus()
    if pending:
        # 确认最近一条
        latest = pending[-1]
        st.session_state.consensus_chain.confirm_record(latest.id)
        st.success(f"已确认: {latest.content[:30]}...")
    else:
        st.warning("没有待确认的共识")


def execute_stage_switch_command(stage: str = None):
    """执行 /切 指令

    设计文档 4.3 节：切换阶段，触发候选预计算重算
    """
    current = get_current_stage()

    if stage:
        # 指定阶段
        if stage in STAGES:
            set_current_stage(stage)
            st.success(f"已切换到: {stage}")
        else:
            st.warning(f"无效阶段: {stage}，可选: {STAGES}")
    else:
        # 切换到下一阶段
        current_idx = STAGES.index(current)
        next_idx = (current_idx + 1) % len(STAGES)
        next_stage = STAGES[next_idx]
        set_current_stage(next_stage)
        st.success(f"已切换到: {next_stage}")


def execute_candidate_command():
    """执行 /候选 指令

    设计文档 3.2 节：优先从缓存读取（0.2秒响应）
    """
    generator = st.session_state.candidate_generator
    skus = st.session_state.get("sku_cache", [])

    # 转换 SKU 格式
    sku_dicts = [
        {"id": sku.id, "confidence": sku.confidence, "title": sku.title}
        for sku in skus
    ] if skus else [{"id": "sku_001", "confidence": "🟢"}]

    # 先尝试从缓存获取
    cached = generator.get_cached_candidates()
    if cached:
        st.session_state.candidates = cached
        st.success(f"从缓存获取候选（{generator._cache.get_age_seconds():.1f}秒前预计算）")
        return

    # 缓存无效，检查约束并生成
    constraints = generator.check_constraints(sku_dicts)

    if constraints["valid"]:
        candidates = generator.generate_candidates()
        generator._cache.set(candidates)
        st.session_state.candidates = candidates
        st.success("已生成候选方案")
    else:
        st.warning(constraints["message"])


def execute_case_recall_command(keywords: str = "", mode: str = "case"):
    """执行 /案例、/框架、/对比 指令

    设计文档 2.1 节第一层召回：
    - 指令召回（Top 5，主对话区弹出）
    - /案例：召回具体案例
    - /框架：召回分析框架
    - /对比：召回对比案例

    Args:
        keywords: 搜索关键词
        mode: 召回模式（case/framework/comparison）
    """
    retriever = st.session_state.knowledge_retriever

    # 提取关键词
    if not keywords:
        # 从共识链提取
        facts = st.session_state.consensus_chain.get_confirmed_facts()
        keywords_list = []
        for fact in facts[:3]:
            keywords_list.extend(fact.content.split()[:2])
        keywords = " ".join(keywords_list[:5]) or "储能"

    # 召回 SKU（Top 5）
    skus = retriever.recall_by_keywords([keywords], top_k=5)

    if skus:
        # 显示在主对话区（弹出）
        st.session_state.sku_cache = skus
        st.success(f"已召回 {len(skus)} 条案例（关键词: {keywords}）")

        # 弹出显示
        for sku in skus[:3]:
            st.info(f"**{sku.confidence} {sku.title}**\n{sku.summary}")
    else:
        st.warning("未找到相关案例")


def execute_memo_generation():
    """执行备忘录生成"""
    # 获取客户档案
    client_profile = {}
    feishu_client = st.session_state.get("feishu_client")
    if feishu_client:
        company = st.session_state.get("current_company", "")
        if company:
            client_profile = feishu_client.get_client_profile(company) or {}

    generator = MemoGenerator(
        st.session_state.consensus_chain,
        llm_client=st.session_state.llm_client,
        client_profile=client_profile
    )
    output_path = "memo_output.docx"
    generator.generate_word(output_path)
    st.success(f"备忘录已生成: {output_path}")


def render_right_panel():
    """右栏：追问建议卡（纯展示）

    设计文档 2.3 节：
    - 新召回内容不直接覆盖，在卡片右上角显示小红点提示"有新备弹"
    - 完整度跨越60%时，从"追问建议"切换为"候选生成就绪"提示
    """
    st.markdown("### 建议")

    # 完整度状态切换（设计文档 6.5 节）
    completeness = st.session_state.get("client_profile_completeness", 0.0)
    if completeness >= 0.6:
        st.success("✓ 候选生成就绪")
    else:
        st.info("追问建议模式")

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

    # 备弹区（SKU卡片）- 渐进式更新设计
    st.markdown("---")

    # 检查是否有新召回（小红点提示）
    has_new_skus = st.session_state.get("has_new_skus", False)
    if has_new_skus:
        st.markdown("""
        <div style="display: inline-block; padding: 5px 10px; background: #ff4444; color: white; border-radius: 15px; font-size: 12px;">
            🔴 有新备弹
        </div>
        """, unsafe_allow_html=True)

    st.markdown("**备弹区**")

    skus = st.session_state.get("sku_cache", [])
    previous_sku_count = st.session_state.get("previous_sku_count", 0)

    for i, sku in enumerate(skus):
        # 新召回的SKU显示小红点
        is_new = i >= previous_sku_count
        badge = "🔴 " if is_new and has_new_skus else ""

        with st.expander(f"{badge}{sku.confidence} {sku.title}"):
            st.write(sku.summary)

    # 更新计数
    st.session_state.previous_sku_count = len(skus)
    if has_new_skus:
        # 30秒后自动清除小红点
        st.session_state.new_sku_timestamp = datetime.now()

    # 检查小红点是否过期（30秒）
    new_sku_time = st.session_state.get("new_sku_timestamp")
    if new_sku_time and (datetime.now() - new_sku_time).total_seconds() > 30:
        st.session_state.has_new_skus = False


def on_feishu_record_change(record_data, session_state):
    """飞书记录变更回调"""
    # 更新客户档案缓存
    if "feishu_records_cache" not in session_state:
        session_state.feishu_records_cache = {}

    record_id = record_data.get("record_id")
    if record_id:
        session_state.feishu_records_cache[record_id] = record_data

    # 触发完整度重算
    session_state.feishu_cache_valid = False


def init_session_state():
    """初始化 session_state"""
    # 核心组件
    if "consensus_chain" not in st.session_state:
        st.session_state.consensus_chain = ConsensusChain()
    if "llm_client" not in st.session_state:
        st.session_state.llm_client = LLMClient()
    if "knowledge_retriever" not in st.session_state:
        st.session_state.knowledge_retriever = KnowledgeRetriever()
    if "sku_cache" not in st.session_state:
        st.session_state.sku_cache = []

    # 候选生成器（带预计算缓存）
    if "candidate_generator" not in st.session_state:
        st.session_state.candidate_generator = CandidateGenerator(
            llm_client=st.session_state.llm_client,
            consensus_chain=st.session_state.consensus_chain,
            knowledge_retriever=st.session_state.knowledge_retriever
        )

    # Day 3 新增组件
    if "feishu_client" not in st.session_state:
        try:
            st.session_state.feishu_client = FeishuClient()
        except Exception:
            st.session_state.feishu_client = None

    if "battle_card_generator" not in st.session_state:
        st.session_state.battle_card_generator = BattleCardGenerator(
            feishu_client=st.session_state.get("feishu_client"),
            llm_client=st.session_state.llm_client,
            knowledge_retriever=st.session_state.knowledge_retriever
        )

    if "fallback_handler" not in st.session_state:
        st.session_state.fallback_handler = FallbackHandler()

    # 飞书同步（可选）
    if "feishu_sync" not in st.session_state:
        feishu_client = st.session_state.get("feishu_client")
        if feishu_client:
            st.session_state.feishu_sync = FeishuSync(
                feishu_client=feishu_client,
                on_record_change=on_feishu_record_change,
                poll_interval=30
            )
        else:
            st.session_state.feishu_sync = FeishuSyncMock()

    # UI 状态
    if "demo_mode" not in st.session_state:
        st.session_state.demo_mode = False
    if "current_company" not in st.session_state:
        st.session_state.current_company = ""
    if "current_stage" not in st.session_state:
        st.session_state.current_stage = "战略梳理"


def render_battle_card_tab_wrapper():
    """渲染作战卡 Tab（封装）"""
    from src.ui.battle_card_tab import render_battle_card_tab

    render_battle_card_tab(
        battle_card_generator=st.session_state.battle_card_generator,
        feishu_sync=st.session_state.feishu_sync,
        feishu_client=st.session_state.get("feishu_client")
    )


def render_main_tab():
    """渲染主界面 Tab（原有三栏布局）"""
    # 三栏布局
    col_left, col_center, col_right = st.columns([3, 5, 2])

    with col_left:
        render_left_panel()

    with col_center:
        render_center_panel()

    with col_right:
        render_right_panel()


def main():
    # 初始化
    init_session_state()

    # 演示模式 CSS 注入（设计文档 5.2 节）
    if st.session_state.get("demo_mode"):
        st.markdown("""
        <style>
        /* 隐藏调试信息 */
        .stDebug { display: none !important; }
        /* 放大字体 */
        .stMarkdown { font-size: 1.2em !important; }
        /* 演示模式下备弹区折叠为小图标（设计文档 2.3 节） */
        .demo-sku-panel {
            position: fixed;
            right: 20px;
            bottom: 20px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #4A90E2;
            cursor: pointer;
            z-index: 1000;
        }
        .demo-sku-panel:hover {
            width: 300px;
            height: auto;
            border-radius: 10px;
        }
        </style>
        """, unsafe_allow_html=True)

        # 知识库版本号营销格式（设计文档 5.3 节）
        st.markdown("""
        <div style="text-align: center; margin: 20px 0; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px;">
            <strong>知识库 v2.0 · 364个新能源行业案例 · 35条跨域洞察</strong>
        </div>
        """, unsafe_allow_html=True)

    st.title("顾问现场作战系统")

    # Tab 布局
    tab1, tab2 = st.tabs(["🎯 会议作战", "📋 会前作战卡"])

    with tab1:
        render_main_tab()

    with tab2:
        render_battle_card_tab_wrapper()

    # 处理飞书同步变更
    if st.session_state.get("feishu_sync"):
        changes = st.session_state.feishu_sync.get_pending_changes()
        if changes:
            st.session_state.feishu_sync.process_changes_in_main_thread(st.session_state)


if __name__ == "__main__":
    main()
