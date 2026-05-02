#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""调试脚本：检查 CandidateGenerator 导入问题"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pathlib import Path

# 模拟 main_app.py 的路径设置
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

cockpit_dir = current_dir.parent
if str(cockpit_dir) not in sys.path:
    sys.path.insert(0, str(cockpit_dir))

print("=" * 60)
print("调试 CandidateGenerator 导入问题")
print("=" * 60)

print(f"\n[路径设置]")
print(f"  current_dir: {current_dir}")
print(f"  project_root: {project_root}")
print(f"  cockpit_dir: {cockpit_dir}")
print(f"  sys.path[0]: {sys.path[0]}")
print(f"  sys.path[1]: {sys.path[1]}")

# 导入 CandidateGenerator
print(f"\n[导入 CandidateGenerator]")
try:
    from src.core.candidate_generator import CandidateGenerator
    print(f"  导入成功!")
except ImportError as e:
    print(f"  导入失败: {e}")
    sys.exit(1)

# 检查实际加载的文件
import inspect
file_path = inspect.getfile(CandidateGenerator)
print(f"  文件路径: {file_path}")

# 检查 __init__ 签名
sig = inspect.signature(CandidateGenerator.__init__)
print(f"  __init__ 签名: {sig}")

# 打印参数列表
params = list(sig.parameters.keys())
print(f"  参数列表: {params}")

# 检查是否有 knowledge_retriever 参数
if 'knowledge_retriever' in params:
    print(f"\n  ✅ knowledge_retriever 参数存在!")
else:
    print(f"\n  ❌ knowledge_retriever 参数不存在!")

# 尝试创建实例
print(f"\n[尝试创建实例]")
try:
    from src.utils.llm_client import LLMClient
    from src.core.consensus_chain import ConsensusChain
    from src.core.knowledge_retriever import KnowledgeRetriever

    gen = CandidateGenerator(
        llm_client=LLMClient(),
        consensus_chain=ConsensusChain(),
        knowledge_retriever=KnowledgeRetriever()
    )
    print(f"  ✅ 创建成功!")
    print(f"  knowledge_retriever 属性: {gen.knowledge_retriever}")
except TypeError as e:
    print(f"  ❌ 创建失败: {e}")
except Exception as e:
    print(f"  ❌ 其他错误: {e}")