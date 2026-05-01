"""
企业增长战略诊断 · 知识副驾 v2.0
新增：持久化对话、客户档案、选项按钮、快捷场景
基于 Anything2Ontology 生成的 knowledge base，使用 LLM 进行问答。

用法:
    pip install streamlit openai
    streamlit run chat_ontology.py
"""

import os
import re
import json
import time
from pathlib import Path
from datetime import datetime

import streamlit as st
from openai import OpenAI

# ── 配置 ──────────────────────────────────────────────
BASE = Path(r"G:\Program Files\AI coding\知识萃取")
ONTOLOGY_ROOTS = {
    "商业模式资本": BASE / "商业模式资本" / "输出" / "ontology",
    "战略分析":     BASE / "战略分析" / "输出" / "ontology",
    "新能源":       BASE / "新能源" / "输出" / "ontology",
}
ARCHIVE_ROOT = BASE / "对话存档"
ARCHIVE_ROOT.mkdir(parents=True, exist_ok=True)
API_KEY      = os.getenv("ARK_API_KEY", "ark-d0608b79-bf7a-4464-9381-60fc43d7476e-83fbd")
BASE_URL     = "https://ark.cn-beijing.volces.com/api/v3"
MODEL        = "doubao-seed-2-0-pro-260215"
MAX_TOKENS   = 4096


# ── 对话存档 ──────────────────────────────────────────
def _archive_dir(kb_name: str) -> Path:
    d = ARCHIVE_ROOT / kb_name
    d.mkdir(parents=True, exist_ok=True)
    return d


def archive_path(client_name: str, kb_name: str) -> Path:
    safe = re.sub(r'[\\/:*?"<>|]', "_", client_name)
    return _archive_dir(kb_name) / f"{safe}.json"


def load_archive(client_name: str, kb_name: str) -> list:
    p = archive_path(client_name, kb_name)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return []


def save_archive(client_name: str, kb_name: str, messages: list):
    archive_path(client_name, kb_name).write_text(
        json.dumps(messages, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_clients(kb_name: str) -> list[str]:
    return [p.stem for p in sorted(_archive_dir(kb_name).glob("*.json"))]


# ── 加载 ontology ─────────────────────────────────────
def _compress_chunk_mapping(raw: dict) -> str:
    """
    从 chunk_to_sku.json 提取紧凑摘要：chunk_key → [(sku_id, path, name, [keywords])]
    只保留语义匹配和文件定位所需字段，大幅减少 token 占用。
    """
    compact = {}
    for chunk_key, entries in raw.items():
        compact[chunk_key] = [
            {"sku_id": e.get("sku_id", ""), "path": e.get("path", ""), "name": e.get("name", ""), "keywords": e.get("keywords", [])}
            for e in entries
        ]
    return json.dumps(compact, ensure_ascii=False, separators=(",", ":"))


@st.cache_resource
def load_ontology(ontology_dir: Path) -> tuple[str, int]:
    parts = []
    for name, label in [
        ("README.md",  "知识库说明"),
        ("spec.md",    "应用规格"),
        ("mapping.md", "SKU 映射"),
        ("eureka.md",  "跨领域创意洞察"),
    ]:
        p = ontology_dir / name
        parts.append(
            f"# {label}\n{p.read_text(encoding='utf-8')}"
            if p.exists() else f"# {name} — 未找到"
        )

    # chunk_to_sku.json: 只注入紧凑摘要（sku_id + name + keywords），不注入全量
    chunk_path = ontology_dir / "chunk_to_sku.json"
    if chunk_path.exists():
        raw = json.loads(chunk_path.read_text(encoding="utf-8"))
        compact = _compress_chunk_mapping(raw)
        parts.append(
            f"# Chunk→SKU 语义索引（紧凑版，完整数据见 chunk_to_sku.json）\n{compact}"
        )
    else:
        parts.append("# chunk_to_sku.json — 未找到")

    full = "\n\n---\n\n".join(parts)
    return full, len(full)


# ── System Prompt ─────────────────────────────────────
SYSTEM_PROMPT_TEMPLATE = """你是一位企业增长战略咨询顾问的智能知识副驾，代号"副驾"。

## 身份定位
服务对象是咨询顾问本人，不是客户。你提供"有据可查的分析素材"，不替顾问做最终判断。

## 场景识别（每次回答前先判断）

**【会前预研模式】** 触发词：明天见/下周拜访/准备见/要去谈
→ 输出：行业关键知识点（3条）+ 5个高价值开场问题 + 痛点假设清单（每条附可用框架SKU）

**【即时诊断模式】** 触发词：客户说/他们的问题/现在面临/刚聊完
→ 先收集背景信息（见下方规则），再给多视角分析框架

**【框架调取模式】** 触发词：有什么框架/怎么分析/用什么方法
→ 直接给2-3个相关框架 + SKU引用 + 各框架适用条件对比

**【模糊记忆模式】** 触发词：之前看过/好像有个/记得有/忘了叫什么
→ 模糊匹配知识库，列出3-5个候选让顾问确认

**【会后整理模式】** 触发词：刚结束/总结一下/整理成/帮我写
→ 按"背景-问题-洞察-推断-建议方向"五段式整理

**【默认模式】** 无法识别时
→ 一句话确认："你现在是在[X]阶段，需要[Y]，对吗？"

## 第一轮信息收集（即时诊断模式）

缺少以下2项及以上时，先提问：
1. 行业和主营业务
2. 企业规模和发展阶段（初创/成长/成熟/衰退）
3. 顾问的具体任务（诊断/战略/投资评估/转型）
4. 客户核心诉求（增长/降本/融资/转型）

提问格式：
> 在调取知识库之前，我需要确认几个关键信息：
> 1. [缺失项一]
> 2. [缺失项二]
> 你可以直接描述背景，我来整理。

已有3项及以上，或顾问说"直接给"，跳过提问。

## 回答结构

**标准格式（即时诊断/框架调取）：**
> **切入角度**：[1-2句，说明分析维度]
>
> **[维度一]** 核心观点 [sku_xxx]
> **[维度二]** 核心观点 [sku_xxx]
>
> **向客户的追问建议：**
> - [具体问题一]
> - [具体问题二]
>
> 你想深入哪个方向？
> A. [方向一]
> B. [方向二]
> C. 其他问题

**会前预研格式：**
> **[行业] 关键背景**（来自知识库）
> - [知识点一] [sku_xxx]
> - [知识点二] [sku_xxx]
> - [知识点三] [sku_xxx]
>
> **建议开场问题：**
> 1-5. [高价值问题]
>
> **痛点假设：**
> - 假设A：[描述]  →  可用框架：[sku_xxx]
> - 假设B：[描述]  →  可用框架：[sku_xxx]

**会后整理格式：**
> **背景**：[整理]
> **核心问题**：[1-2个根本问题]
> **洞察**：[有知识库支撑的结论] [sku_xxx]
> **推断**：⚠️ [超出知识库的判断，建议验证]
> **建议方向**：[2-3个选项，不给唯一答案]

## 知识库使用规范
- 引用时标注编号：[sku_042] 或 [skill_015]
- 事实型数据加注：（来源：知识库，建议核实时效性）
- 无直接覆盖时：明确说明 + 给最接近2-3条 + 问是否需要推断
- 推断内容标注 ⚠️，不与知识库结论混淆
- 有矛盾观点时并列呈现，不强行合并
- 每次回答控制在500字以内（会后整理除外）

## 引用解析规则（必须遵守）
当你看到 spec.md 或其他文件中的引用时，按以下规则解析：

1. `[skus/factual/sku_xxx]` 或 `[skus/procedural/skill_xxx]` → 直接引用该 SKU
2. `[chunk: xxx_chunk_xxx]` → 查 chunk_to_sku.json 中该 chunk 键，先扫描**所有**条目的 `keywords` 和 `name` 字段，找出与当前查询语义最匹配的条目并读取。`rank` 反映的是类型优先级（factual→procedural→relational）和生成顺序，不是语义相关度，仅在多条记录语义相同时作为参考。如无 keywords/name 匹配，则读取 rank 1-3 作为兜底。
3. `【锚点：洞察标题】`（未替换的残留锚点）→ 先在 eureka.md 搜索标题，提取方括号内的 chunk 标识，再按规则2处理。多个 chunk 时合并候选后按 sku_id 去重
4. 主题级查询 → 查 mapping.md 对应分组

## 以下是你的完整知识库

{ontology_content}
"""


# ── 选项按钮解析 ─────────────────────────────────────
def extract_options(text: str) -> list[str]:
    """从回答文本中提取 A./B./C. 格式的选项。"""
    pattern = r'^[A-D][\.、．]\s*(.+)$'
    options = []
    for line in text.split('\n'):
        m = re.match(pattern, line.strip())
        if m:
            options.append(line.strip())
    return options


# ── Streamlit UI ──────────────────────────────────────
def main():
    st.set_page_config(
        page_title="知识副驾 · 咨询助手",
        page_icon="🧭",
        layout="wide",
    )

    # ── 侧边栏 ──
    with st.sidebar:
        st.header("🧭 知识副驾")

        # 知识库选择
        st.subheader("知识库")
        selected_kb = st.selectbox(
            "选择知识库",
            list(ONTOLOGY_ROOTS.keys()),
            key="selected_kb",
        )
        ontology_dir = ONTOLOGY_ROOTS[selected_kb]

        # 切换知识库时清空对话
        if st.session_state.get("_last_kb") != selected_kb:
            st.session_state._last_kb = selected_kb
            st.session_state.messages = []
            st.session_state.response_times = []
            st.rerun()

        ontology_content, char_count = load_ontology(ontology_dir)
        token_est = char_count // 4

        st.divider()

        # 客户档案
        st.subheader("客户档案")
        clients = list_clients(selected_kb)
        client_input = st.text_input(
            "当前客户名称",
            value=st.session_state.get("client_name", ""),
            placeholder="输入客户名，自动归档对话",
        )

        if client_input != st.session_state.get("client_name", ""):
            st.session_state.client_name = client_input
            if client_input:
                st.session_state.messages = load_archive(client_input, selected_kb)
                st.session_state.response_times = []
                st.rerun()

        if clients:
            with st.expander(f"历史客户（{len(clients)}）"):
                for c in clients:
                    if st.button(c, key=f"client_{c}", use_container_width=True):
                        st.session_state.client_name = c
                        st.session_state.messages = load_archive(c, selected_kb)
                        st.session_state.response_times = []
                        st.rerun()

        st.divider()

        # 快捷场景按钮
        st.subheader("快捷场景")
        scenes = [
            ("📋 会前预研", "会前预研模式，客户背景："),
            ("🔍 即时诊断", "即时诊断，客户刚才说："),
            ("📚 框架调取", "有什么框架可以用于："),
            ("🔎 模糊记忆", "记得知识库里有个关于"),
            ("📝 会后整理", "帮我整理刚才的会议内容："),
        ]
        for label, prefix in scenes:
            if st.button(label, use_container_width=True, key=f"scene_{label}"):
                st.session_state.pending_input = prefix

        st.divider()

        # 模型选择
        model_options = {
            "doubao-seed-2-0-pro-260215": "doubao-seed-2-0-pro (默认)",
            "doubao-seed-2-0-lite-260215": "doubao-seed-2-0-lite",
            "doubao-seed-2-0-mini-260215": "doubao-seed-2-0-mini",
        }
        selected_model = st.selectbox(
            "模型",
            list(model_options.keys()),
            index=0,
            format_func=model_options.get,
        )
        temperature = st.slider("Temperature", 0.0, 1.0, 0.3, 0.1)

        st.divider()

        # 知识库状态
        with st.expander("知识库状态"):
            st.metric("字符数", f"{char_count:,}")
            st.metric("估算 token", f"~{token_est:,}")
            if token_est > 100_000:
                st.warning("接近模型上限")
            elif token_est > 60_000:
                st.info("token 较高")
            else:
                st.success("token 正常")

        # 对话统计
        if st.session_state.get("response_times"):
            times = st.session_state.response_times
            st.caption(
                f"本轮 {len(times)} 问 | "
                f"均 {sum(times)/len(times):.0f}s | "
                f"快 {min(times):.0f}s | "
                f"慢 {max(times):.0f}s"
            )

        st.divider()

        # 操作按钮
        col1, col2 = st.columns(2)
        with col1:
            if st.button("🗑️ 清空", use_container_width=True):
                st.session_state.messages = []
                st.session_state.response_times = []
                client = st.session_state.get("client_name", "")
                if client:
                    save_archive(client, [])
                st.rerun()
        with col2:
            if st.session_state.get("messages"):
                conversation = "\n\n".join(
                    f"{'【顾问】' if m['role']=='user' else '【副驾】'} {m['content']}"
                    for m in st.session_state.messages
                )
                client = st.session_state.get("client_name", "对话记录")
                ts = datetime.now().strftime("%m%d_%H%M")
                st.download_button(
                    "💾 导出",
                    data=conversation.encode("utf-8"),
                    file_name=f"{client}_{ts}.txt",
                    mime="text/plain",
                    use_container_width=True,
                )

    # ── 主区域 ──
    client_name = st.session_state.get("client_name", "")
    title = f"🧭 知识副驾 · {client_name}" if client_name else "🧭 知识副驾"
    st.title(title)
    if client_name:
        st.caption(f"~{token_est:,} tokens | 对话自动保存")
    else:
        st.caption(f"~{token_est:,} tokens | 输入客户名后自动归档")

    # 初始化
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "response_times" not in st.session_state:
        st.session_state.response_times = []

    # 显示历史消息 + 选项按钮
    for i, msg in enumerate(st.session_state.messages):
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            # 最后一条 assistant 消息：渲染选项按钮
            if (
                msg["role"] == "assistant"
                and i == len(st.session_state.messages) - 1
            ):
                options = extract_options(msg["content"])
                if options:
                    st.markdown("---")
                    cols = st.columns(len(options))
                    for j, opt in enumerate(options):
                        with cols[j]:
                            if st.button(
                                opt, key=f"opt_{i}_{j}",
                                use_container_width=True,
                            ):
                                st.session_state.pending_input = opt

    # 处理 pending_input（场景按钮 or 选项按钮触发）
    auto_prompt = st.session_state.pop("pending_input", None)
    if auto_prompt:
        st.session_state._auto_send = auto_prompt
        st.rerun()

    auto_send = st.session_state.pop("_auto_send", None)

    # 用户输入框
    user_input = st.chat_input("输入你的问题，或点击上方快捷场景……")
    prompt = auto_send or user_input

    if prompt:
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            ontology_content=ontology_content
        )
        payload = [
            {"role": "system", "content": system_prompt},
            *st.session_state.messages,
        ]

        with st.chat_message("assistant"):
            t0 = time.time()
            collected = ""
            placeholder = st.empty()
            try:
                response = client.chat.completions.create(
                    model=selected_model,
                    messages=payload,
                    stream=True,
                    temperature=temperature,
                    max_tokens=MAX_TOKENS,
                )
                for chunk in response:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        collected += delta
                        placeholder.markdown(collected + "▌")
                placeholder.markdown(collected)
                reply_text = collected
            except Exception as e:
                reply_text = f"❌ 调用失败: {e}"
                placeholder.error(reply_text)

            elapsed = time.time() - t0
            st.session_state.response_times.append(elapsed)
            st.caption(f"响应 {elapsed:.1f}s")

        st.session_state.messages.append({"role": "assistant", "content": reply_text})

        # 自动保存到客户档案
        if st.session_state.get("client_name"):
            save_archive(st.session_state.client_name, st.session_state.messages)

        st.rerun()


if __name__ == "__main__":
    main()
