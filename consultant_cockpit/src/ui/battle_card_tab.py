# src/ui/battle_card_tab.py
"""作战卡 Tab 组件 - Streamlit UI

根据设计文档 11.4.1.1 节实现：
- 输入区（公司名、顾问名）
- 完整度指示器
- 生成按钮
- 作战卡预览区
- 操作按钮区（下载Word、发送飞书、演示模式）
- 飞书同步状态
"""
import streamlit as st
from typing import Optional, Callable, Dict, Any
from io import BytesIO
from datetime import datetime


def render_battle_card_tab(
    battle_card_generator,
    feishu_sync=None,
    feishu_client=None,
    on_download: Optional[Callable] = None,
    on_send_feishu: Optional[Callable] = None
):
    """渲染作战卡 Tab

    Args:
        battle_card_generator: BattleCardGenerator 实例
        feishu_sync: FeishuSync 实例（可选）
        feishu_client: FeishuClient 实例（可选，用于获取客户列表）
        on_download: 下载回调
        on_send_feishu: 发送飞书回调
    """
    st.subheader("📋 会前作战卡")

    # 1. 输入区
    col1, col2 = st.columns([2, 1])

    with col1:
        # 如果有飞书客户端，提供客户选择
        if feishu_client:
            try:
                records = feishu_client.list_records()
                companies = [r.get("fields", {}).get("客户公司名", "") for r in records if r.get("fields", {}).get("客户公司名")]
                companies = list(set(companies))  # 去重

                if companies:
                    company = st.selectbox(
                        "选择客户公司",
                        options=[""] + companies,
                        index=0,
                        help="从飞书多维表格中选择客户"
                    )
                else:
                    company = st.text_input(
                        "客户公司名称",
                        placeholder="输入客户公司全称",
                        help="用于作战卡标题和知识库召回"
                    )
            except Exception:
                company = st.text_input(
                    "客户公司名称",
                    placeholder="输入客户公司全称",
                    help="用于作战卡标题和知识库召回"
                )
        else:
            company = st.text_input(
                "客户公司名称",
                placeholder="输入客户公司全称",
                help="用于作战卡标题和知识库召回"
            )

    with col2:
        consultant = st.text_input(
            "顾问姓名",
            value=st.session_state.get("consultant_name", ""),
            help="留空则从 session_state 获取"
        )

    # 2. 完整度指示器（预览）
    if company:
        try:
            if feishu_client:
                profile = feishu_client.get_client_profile(company)
                completeness = feishu_client.calc_completeness(profile)
                st.session_state["battle_card_completeness"] = completeness
        except Exception:
            pass

    completeness = st.session_state.get("battle_card_completeness", 0.0)
    completeness_color = "🟢" if completeness >= 0.8 else "🟡" if completeness >= 0.6 else "🔴"

    col_metric, col_mode = st.columns([1, 1])
    with col_metric:
        st.metric(
            "信息完整度",
            f"{completeness_color} {completeness:.0%}",
            help="≥80% 显示绿色，60%-80% 黄色，<60% 红色"
        )
    with col_mode:
        mode_preview = "验证假设版" if completeness >= 0.6 else "信息建立版"
        st.metric("生成模式", mode_preview)

    # 3. 生成按钮
    if st.button("🎯 生成作战卡", disabled=not company, use_container_width=True, type="primary"):
        with st.spinner("正在生成作战卡..."):
            try:
                battle_card = battle_card_generator.generate(
                    company=company,
                    consultant=consultant
                )
                st.session_state["current_battle_card"] = battle_card
                st.session_state["battle_card_completeness"] = battle_card.completeness

                # 预生成 Word 字节流（缓存 key 绑定公司名+日期，避免跨客户污染）
                cache_key = f"battle_card_word_bytes_{battle_card.company}_{battle_card.date}"
                st.session_state[cache_key] = battle_card_generator.render_to_word(battle_card)
                # 同时保存当前缓存 key，供下载按钮使用
                st.session_state["current_word_cache_key"] = cache_key

                st.success(f"作战卡生成成功！模式：{'验证假设版' if battle_card.mode == 'hypothesis' else '信息建立版'}")
                st.rerun()

            except Exception as e:
                st.error(f"生成失败：{e}")

    # 4. 作战卡预览区
    battle_card = st.session_state.get("current_battle_card")
    if battle_card:
        render_battle_card_preview(battle_card)

        # 5. 操作按钮区
        col1, col2, col3 = st.columns(3)

        with col1:
            # 下载 Word（使用绑定的缓存 key）
            cache_key = st.session_state.get("current_word_cache_key")
            word_bytes = st.session_state.get(cache_key) if cache_key else None
            if word_bytes:
                st.download_button(
                    label="📥 下载Word",
                    data=word_bytes,
                    file_name=f"作战卡_{battle_card.company}_{battle_card.date}.docx",
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    use_container_width=True
                )

        with col2:
            # 发送飞书
            if st.button("📤 发送飞书", use_container_width=True):
                if on_send_feishu:
                    on_send_feishu(battle_card)
                else:
                    st.warning("飞书发送功能未配置")

        with col3:
            # 切换演示模式
            demo_mode = st.session_state.get("demo_mode", False)
            if st.button(
                "🎬 进入演示模式" if not demo_mode else "🔙 退出演示模式",
                use_container_width=True
            ):
                st.session_state["demo_mode"] = not demo_mode
                st.rerun()

    # 6. 飞书同步状态（可选）
    if feishu_sync:
        render_sync_status(feishu_sync)


def render_battle_card_preview(battle_card):
    """渲染作战卡预览"""
    st.markdown("---")
    st.markdown(f"### {battle_card.company} - 会前作战卡")

    mode_text = '假设验证版' if battle_card.mode == 'hypothesis' else '信息补全版'
    consultant_text = battle_card.consultant or '未填写'
    st.markdown(f"**日期**：{battle_card.date} | **顾问**：{consultant_text} | **模式**：{mode_text}")
    st.markdown(f"**完整度**：{battle_card.completeness:.0%}")

    # 各区块内容
    content = battle_card.content

    if battle_card.mode == "hypothesis":
        # 验证假设版字段
        with st.expander("🎯 诊断假设", expanded=True):
            st.markdown(content.get("diagnosis_hypothesis", "暂无"))

        with st.expander("📌 战略追问", expanded=True):
            st.markdown(content.get("strategy_questions", "暂无"))

        with st.expander("💼 商业模式追问", expanded=False):
            st.markdown(content.get("business_questions", "暂无"))

        with st.expander("🎤 口播台词", expanded=False):
            st.markdown(content.get("demo_scripts", "暂无"))

        with st.expander("🛡️ 风险话术", expanded=False):
            st.markdown(content.get("risk_responses", "暂无"))

    else:
        # 信息建立版字段
        with st.expander("📋 待确认字段", expanded=True):
            missing = content.get("missing_fields", [])
            if missing:
                for field_name in missing:
                    st.markdown(f"- □ {field_name}")
            else:
                st.markdown("所有字段已填充")

        with st.expander("🌲 战略追问树", expanded=True):
            tree = content.get("strategy_tree", {})
            render_question_tree(tree)

        with st.expander("📊 商业模式追问树", expanded=False):
            tree = content.get("business_tree", {})
            render_question_tree(tree)

        with st.expander("🎤 口播台词", expanded=False):
            st.markdown(content.get("demo_scripts", "暂无"))

        with st.expander("🛡️ 风险话术", expanded=False):
            st.markdown(content.get("risk_responses", "暂无"))


def render_question_tree(tree: Dict):
    """渲染追问树"""
    if not tree:
        st.markdown("暂无")
        return

    anchor = tree.get("anchor", "")
    branches = tree.get("branches", {})

    # 锚点问题
    st.markdown(f"**开场锚定**：{anchor}")

    # 分支
    st.markdown("**分支追问**：")
    for key, questions in branches.items():
        st.markdown(f"- 答\"{key}\"")
        for i, q in enumerate(questions):
            prefix = "  └─" if i == len(questions) - 1 else "  ├─"
            st.markdown(f"{prefix} {q}")


def render_sync_status(feishu_sync):
    """渲染飞书同步状态"""
    st.markdown("---")
    st.markdown("#### 🔄 飞书同步状态")

    status = feishu_sync.get_status()

    col1, col2, col3 = st.columns([2, 2, 1])

    with col1:
        if status["is_running"]:
            st.success("🟢 同步中...")
        else:
            st.info("⏸️ 同步已暂停")

    with col2:
        st.caption(f"轮询间隔：{status['poll_interval']}秒 | 队列：{status['queue_size']}")

    with col3:
        if st.button("设置", key="sync_settings_btn"):
            st.session_state["show_sync_settings"] = not st.session_state.get("show_sync_settings", False)

    # 同步设置面板
    if st.session_state.get("show_sync_settings"):
        with st.container():
            st.markdown("---")

            col1, col2 = st.columns([2, 1])

            with col1:
                new_interval = st.slider(
                    "轮询间隔（秒）",
                    min_value=10,
                    max_value=120,
                    value=feishu_sync.poll_interval,
                    step=10
                )

            with col2:
                if st.button("应用设置", use_container_width=True):
                    feishu_sync.poll_interval = new_interval
                    st.session_state["show_sync_settings"] = False
                    st.success("设置已保存")
                    st.rerun()

            # 同步控制
            col1, col2 = st.columns(2)
            with col1:
                if st.button("▶️ 启动同步", use_container_width=True, disabled=status["is_running"]):
                    feishu_sync.start_listening()
                    st.rerun()

            with col2:
                if st.button("⏹️ 停止同步", use_container_width=True, disabled=not status["is_running"]):
                    feishu_sync.stop_listening()
                    st.rerun()

            # 统计信息
            stats = status.get("stats", {})
            if stats.get("poll_count", 0) > 0:
                st.markdown("**统计信息**：")
                st.caption(f"轮询次数：{stats.get('poll_count', 0)} | 变更检测：{stats.get('change_count', 0)} | 错误：{stats.get('error_count', 0)}")
                if stats.get("last_poll_time"):
                    st.caption(f"上次轮询：{stats['last_poll_time']}")


def render_battle_card_quick_actions():
    """渲染作战卡快捷操作（用于主界面侧边栏）"""
    st.markdown("#### 快捷操作")

    if st.button("🔄 刷新客户列表", use_container_width=True):
        st.rerun()

    if st.button("📥 下载当前作战卡", use_container_width=True):
        battle_card = st.session_state.get("current_battle_card")
        if battle_card:
            st.session_state["trigger_download"] = True
        else:
            st.warning("请先生成作战卡")

    # 演示模式切换
    demo_mode = st.session_state.get("demo_mode", False)
    if st.checkbox("演示模式", value=demo_mode):
        st.session_state["demo_mode"] = True
    else:
        st.session_state["demo_mode"] = False
