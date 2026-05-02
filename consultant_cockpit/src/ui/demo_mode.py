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
