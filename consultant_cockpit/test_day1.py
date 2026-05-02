"""
手动测试脚本 - 验证 Day 1 最小闭环
"""
import sys
sys.path.insert(0, '.')

from datetime import datetime
from src.core.consensus_chain import ConsensusChain, ConsensusRecord
from src.core.memo_generator import MemoGenerator

print("=" * 60)
print("Day 1 功能验证测试")
print("=" * 60)

# 1. 创建共识链
chain = ConsensusChain()
print("\n[OK] 共识链创建成功")

# 2. 添加3条事实
for i in range(3):
    record = ConsensusRecord(
        id=f"fact_{i}",
        timestamp=datetime.now(),
        type="fact",
        stage="战略梳理",
        content=f"测试事实{i+1}",
        source="manual",
        status="confirmed"
    )
    chain.add_record(record)

print(f"[OK] 已添加 {len(chain.records)} 条事实")

# 3. 添加1条判断
consensus_record = ConsensusRecord(
    id="consensus_1",
    timestamp=datetime.now(),
    type="consensus",
    stage="战略梳理",
    content="客户认可聚焦储能",
    source="candidate_selected",
    status="confirmed",
    recommendation="聚焦储能主航道"
)
chain.add_record(consensus_record)
print(f"[OK] 已添加判断，当前共识链总数: {len(chain.records)}")

# 4. 验证共识链方法
confirmed_facts = chain.get_confirmed_facts()
confirmed_consensus = chain.get_confirmed_consensus()
print(f"[OK] 已确认事实数: {len(confirmed_facts)}")
print(f"[OK] 已确认判断数: {len(confirmed_consensus)}")

# 5. 生成备忘录
generator = MemoGenerator(chain)
output_path = "test_memo_output.docx"
generator.generate_word(output_path)
print(f"[OK] 备忘录已生成: {output_path}")

print("\n" + "=" * 60)
print("所有验证通过！Day 1 最小闭环成功")
print("=" * 60)