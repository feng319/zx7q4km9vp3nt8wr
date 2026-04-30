下面是为你的 `myontology` 项目写的 README，你可以直接在 VS Code 根目录新建 `README.md`，把这段内容粘进去保存，GitDoc 会自动推送到 GitHub。

---

```markdown
# MyOntology — 知识库驱动的智能对话系统

一个将非结构化文档转化为结构化知识库、并通过智能体进行知识检索与对话的完整系统。

## 项目概览

本项目由两个核心部分组成：**知识库构建**（Anything2Ontology）和**知识库对话**（chat_ontology.py）。原始文档经过解析、分块、知识提取后，形成结构化的本体文件；智能体在对话时从本体文件中检索相关知识，生成有依据的回复。

## 目录结构
```

myontology/
├── Anything2Ontology/       # 知识库构建工具（文档转本体）
├── 新能源/
│   └── 输出/                # 新能源领域知识库
├── 战略分析/
│   └── 输出/                # 战略分析领域知识库
├── 商业模式资本/
│   └── 输出/                # 商业模式与资本领域知识库
├── 对话存档/                 # 历史对话记录
├── chat_ontology.py         # 知识库智能体（对话入口）
└── README.md

```

## 核心模块说明

### Anything2Ontology — 知识库构建

负责将各领域的原始文档（PDF、PPTX、Excel、YouTube 视频、GitHub 仓库、网页等）转化为结构化本体，供智能体检索使用。

完整的功能说明和使用方法见 [Anything2Ontology/README.md](./Anything2Ontology/README.md)。

构建流程分为四个模块：

- **Module 1 Anything2Markdown**：将各类文件解析为统一的 Markdown 格式
- **Module 2 Markdown2Chunks**：将长文档按语义分块，适配 LLM 上下文窗口
- **Module 3 Chunks2SKUs**：从分块中提取事实、关系、流程、洞察等结构化知识单元
- **Module 4 SKUs2Ontology**：将知识单元组装为完整本体，生成 `spec.md`、`mapping.md` 等导航文件

### chat_ontology.py — 知识库智能体

对话系统的入口。智能体根据用户输入，从对应领域的知识库（`输出/` 文件夹）中检索相关内容，结合上下文生成回复。

目前支持三个知识领域：

| 领域 | 知识库路径 |
|------|-----------|
| 新能源 | `新能源/输出/` |
| 战略分析 | `战略分析/输出/` |
| 商业模式与资本 | `商业模式资本/输出/` |

### 对话存档

`对话存档/` 目录存储历史对话记录，便于回溯和分析。

## 快速开始

**构建知识库**（以新能源为例）：

```bash
cd Anything2Ontology
# 将原始文档放入 input/ 目录
anything2md run
md2chunks run
chunks2skus run
skus2ontology run --skip-chatbot
# 将 ontology/ 输出复制到 ../新能源/输出/
```

**启动对话智能体**：

```bash
python chat_ontology.py
```

## 环境要求

- Python 3.10+
- SiliconFlow API Key（用于 LLM 功能）
- 详见 `Anything2Ontology/.env.example`
```

---

新建 `README.md` 放在 `G:\Program Files\AI coding\知识萃取\` 根目录，保存后 GitDoc 会自动推送，刷新 GitHub 页面就能看到这个 README 显示在仓库首页了。

如果你后续增加了新的领域知识库（比如"医疗"或"金融"），只需要在表格里加一行，保存，自动同步。