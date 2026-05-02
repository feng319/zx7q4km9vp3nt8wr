import streamlit as st

st.title("顾问现场作战系统 - 测试版")

# 侧边栏
st.sidebar.header("快捷指令")
manual_input = st.sidebar.text_input("输入内容")
if st.sidebar.button("记录"):
    st.sidebar.write(f"已记录: {manual_input}")

if st.sidebar.button("生成候选"):
    st.sidebar.write("候选生成按钮已点击")

# 主区域
st.header("共识链")
st.write("暂无记录")

if st.button("生成备忘录"):
    st.write("备忘录已生成")