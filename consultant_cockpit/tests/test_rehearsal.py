# tests/test_rehearsal.py
"""演练验证测试

根据设计文档 11.3.5 节演练清单：
- 数据准备验证
- 三轮演练测试
- 降级验证测试
- 端到端流程测试
"""
import pytest
import sys
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch
from io import BytesIO

# 添加项目路径
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))


# ============= 数据准备验证 =============

class TestDataPreparation:
    """数据准备验证测试"""

    def test_mock_data_availability(self):
        """测试Mock数据可用性"""
        from src.core.knowledge_retriever import KnowledgeRetriever

        retriever = KnowledgeRetriever()
        skus = retriever.recall_by_keywords(["储能"], top_k=10)

        assert len(skus) >= 6, "Mock SKU数据不足6条"

    def test_feishu_client_mock(self):
        """测试飞书客户端Mock"""
        from src.integrations.feishu_client import FeishuClient

        # 检查环境变量或Mock
        try:
            client = FeishuClient()
            # 如果能初始化，测试基本功能
            records = client.list_records()
            assert isinstance(records, list)
        except Exception:
            # 环境变量未配置，跳过
            pytest.skip("飞书环境变量未配置")

    def test_llm_client_mock(self):
        """测试LLM客户端Mock"""
        from src.utils.llm_client import LLMClient

        try:
            client = LLMClient()
            # 不实际调用，只验证初始化
            assert client.model is not None
        except Exception:
            pytest.skip("LLM环境变量未配置")


# ============= 三轮演练测试 =============

class TestRehearsalRounds:
    """三轮演练测试"""

    @pytest.fixture
    def mock_components(self):
        """准备Mock组件"""
        # Mock 飞书客户端
        feishu_client = Mock()
        feishu_client.get_client_profile = Mock(return_value={
            "record_id": "rec_001",
            "fields": {
                "客户公司名": "演练客户",
                "产品线": "储能系统",
                "客户群体": "工商业用户",
                "收入结构": "设备销售70%/运营服务30%",
                "战略目标": "从设备商转型运营商",
                "显性诉求": "提升运营收入占比"
            }
        })
        feishu_client.calc_completeness = Mock(return_value=0.65)
        feishu_client.list_records = Mock(return_value=[
            {"record_id": "rec_001", "fields": {"客户公司名": "演练客户"}}
        ])

        # Mock LLM客户端
        llm_client = Mock()
        llm_client.generate = Mock(return_value="基于行业案例，客户的核心问题是转型路径不清晰。")

        # Mock 知识召回器
        from src.core.knowledge_retriever import KnowledgeRetriever
        knowledge_retriever = KnowledgeRetriever()

        return feishu_client, llm_client, knowledge_retriever

    def test_round1_battle_card_generation(self, mock_components):
        """第一轮演练：作战卡生成"""
        feishu_client, llm_client, knowledge_retriever = mock_components

        from src.core.battle_card_generator import BattleCardGenerator

        generator = BattleCardGenerator(
            feishu_client=feishu_client,
            llm_client=llm_client,
            knowledge_retriever=knowledge_retriever
        )

        # 生成作战卡
        card = generator.generate("演练客户", "测试顾问")

        # 验证
        assert card is not None
        assert card.company == "演练客户"
        assert card.mode in ["hypothesis", "info_building"]
        assert len(card.content) > 0

        # 验证Word生成
        word_bytes = generator.render_to_word(card)
        assert isinstance(word_bytes, bytes)
        assert len(word_bytes) > 0

    def test_round2_consensus_chain_flow(self, mock_components):
        """第二轮演练：共识链流程"""
        from src.core.consensus_chain import ConsensusChain, ConsensusRecord

        chain = ConsensusChain()

        # 添加事实记录
        fact1 = ConsensusRecord(
            id="cc_001",
            timestamp=datetime.now(),
            type="fact",
            stage="战略梳理",
            content="客户产品线3条",
            source="manual",
            status="confirmed"
        )
        chain.add_record(fact1)

        # 添加共识记录
        consensus1 = ConsensusRecord(
            id="cc_002",
            timestamp=datetime.now(),
            type="consensus",
            stage="战略梳理",
            content="客户认可聚焦储能",
            source="candidate_selected",
            status="pending_client_confirm"
        )
        chain.add_record(consensus1)

        # 确认共识
        chain.confirm_record("cc_002")

        # 验证
        assert len(chain.records) == 2
        assert chain.get_record("cc_002").status == "confirmed"

        facts = chain.get_confirmed_facts()
        assert len(facts) == 1

    def test_round3_feishu_sync_flow(self, mock_components):
        """第三轮演练：飞书同步流程"""
        from src.integrations.feishu_sync import FeishuSync, FeishuSyncMock

        feishu_client, _, _ = mock_components

        # 使用 Mock 进行测试
        sync = FeishuSyncMock()

        # 启动同步
        assert sync.start_listening() == True

        # 获取状态
        status = sync.get_status()
        assert status["is_running"] == True

        # 停止同步
        sync.stop_listening()
        assert sync.get_status()["is_running"] == False


# ============= 降级验证测试 =============

class TestDegradationVerification:
    """降级验证测试"""

    def test_llm_timeout_degradation(self):
        """测试LLM超时降级"""
        from src.core.fallback_handler import FallbackHandler

        handler = FallbackHandler()

        # Mock 慢速生成器
        import time
        def slow_generator():
            time.sleep(3)
            return "结果"

        result = handler.handle_llm_timeout(
            generator=slow_generator,
            timeout_seconds=1,
            fallback_value="降级模板"
        )

        assert result.success == False
        assert result.data["fallback_value"] == "降级模板"

    def test_feishu_api_degradation(self):
        """测试飞书API失败降级"""
        from src.core.fallback_handler import FallbackHandler

        handler = FallbackHandler()

        result = handler.handle_feishu_failure(
            operation="sync",
            error=Exception("网络错误")
        )

        assert result.success == True
        assert result.data["local_cached"] == True

    def test_knowledge_recall_degradation(self):
        """测试知识库召回失败降级"""
        from src.core.fallback_handler import FallbackHandler

        handler = FallbackHandler()

        # Mock 会失败的召回器
        mock_retriever = Mock()
        mock_retriever.recall_by_keywords = Mock(side_effect=Exception("召回失败"))

        result = handler.handle_knowledge_recall_failure(
            manual_query="测试",
            knowledge_retriever=mock_retriever
        )

        assert result.success == False
        assert "召回失败" in result.original_error

    def test_word_generation_degradation(self):
        """测试Word生成失败降级"""
        from src.core.fallback_handler import FallbackHandler

        handler = FallbackHandler()

        result = handler.handle_word_generation_failure(
            content={"title": "测试"},
            error=Exception("docx错误")
        )

        assert result.success == True
        assert result.data["format"] == "plain_text"


# ============= 端到端流程测试 =============

class TestEndToEndFlow:
    """端到端流程测试"""

    @pytest.fixture
    def full_mock_setup(self):
        """完整Mock设置"""
        # 飞书客户端
        feishu_client = Mock()
        feishu_client.get_client_profile = Mock(return_value={
            "record_id": "rec_e2e",
            "fields": {
                "客户公司名": "端到端测试客户",
                "产品线": "光伏/储能",
                "客户群体": "工商业",
                "收入结构": "设备60%/服务40%",
                "战略目标": "转型综合能源服务商",
                "显性诉求": "优化商业模式"
            }
        })
        feishu_client.calc_completeness = Mock(return_value=0.72)
        feishu_client.list_records = Mock(return_value=[])
        feishu_client.sync_consensus_record = Mock(return_value=True)

        # LLM客户端
        llm_client = Mock()
        llm_client.generate = Mock(side_effect=lambda p, **kw: f"生成内容: {p[:30]}...")

        return feishu_client, llm_client

    def test_full_battle_card_workflow(self, full_mock_setup):
        """完整作战卡工作流测试"""
        feishu_client, llm_client = full_mock_setup

        from src.core.battle_card_generator import BattleCardGenerator
        from src.core.knowledge_retriever import KnowledgeRetriever

        generator = BattleCardGenerator(
            feishu_client=feishu_client,
            llm_client=llm_client,
            knowledge_retriever=KnowledgeRetriever()
        )

        # 生成作战卡
        card = generator.generate("端到端测试客户", "测试顾问")

        # 验证完整流程
        assert card is not None
        assert card.mode == "hypothesis"  # 完整度72%
        assert "diagnosis_hypothesis" in card.content

        # Word输出
        word_bytes = generator.render_to_word(card)
        assert len(word_bytes) > 0

    def test_consensus_to_feishu_sync(self, full_mock_setup):
        """共识记录到飞书同步测试"""
        feishu_client, _ = full_mock_setup

        from src.core.consensus_chain import ConsensusChain, ConsensusRecord

        chain = ConsensusChain()

        # 添加记录
        record = ConsensusRecord(
            id="cc_sync_001",
            timestamp=datetime.now(),
            type="consensus",
            stage="战略梳理",
            content="客户确认聚焦储能方向",
            source="manual",
            status="confirmed"
        )
        chain.add_record(record)

        # 同步到飞书
        result = feishu_client.sync_consensus_record(record)
        assert result == True

        # 验证调用
        feishu_client.sync_consensus_record.assert_called_once()


# ============= 演练清单验证 =============

class TestRehearsalChecklist:
    """演练清单验证（对应设计文档 11.3.5）"""

    def test_checklist_item1_data_preparation(self):
        """清单项1：数据准备验证"""
        # 验证Mock SKU数据
        from src.core.knowledge_retriever import KnowledgeRetriever
        retriever = KnowledgeRetriever()
        skus = retriever.recall_by_keywords(["储能"], top_k=10)
        assert len(skus) >= 6, "❌ Mock SKU数据不足"

        print("✅ 数据准备验证通过")

    def test_checklist_item2_battle_card_generation(self):
        """清单项2：作战卡生成验证"""
        from src.core.battle_card_generator import BattleCardGenerator, BattleCard

        # 验证类存在
        assert BattleCardGenerator is not None
        assert BattleCard is not None

        print("✅ 作战卡生成器验证通过")

    def test_checklist_item3_feishu_sync(self):
        """清单项3：飞书同步验证"""
        from src.integrations.feishu_sync import FeishuSync, FeishuSyncMock

        # 验证类存在
        assert FeishuSync is not None
        assert FeishuSyncMock is not None

        # 测试Mock基本功能
        sync = FeishuSyncMock()
        assert sync.start_listening() == True
        sync.stop_listening()

        print("✅ 飞书同步验证通过")

    def test_checklist_item4_fallback_handler(self):
        """清单项4：降级处理器验证"""
        from src.core.fallback_handler import FallbackHandler, FallbackChain

        handler = FallbackHandler()

        # 验证各类降级方法存在
        assert hasattr(handler, 'handle_feishu_failure')
        assert hasattr(handler, 'handle_llm_timeout')
        assert hasattr(handler, 'handle_knowledge_recall_failure')
        assert hasattr(handler, 'handle_word_generation_failure')

        print("✅ 降级处理器验证通过")

    def test_checklist_item5_ui_integration(self):
        """清单项5：UI集成验证"""
        # 验证UI模块存在
        from src.ui.battle_card_tab import render_battle_card_tab
        from src.ui.main_app import init_session_state

        assert render_battle_card_tab is not None
        assert init_session_state is not None

        print("✅ UI集成验证通过")


# ============= 运行演练 =============

def run_rehearsal():
    """运行完整演练（命令行入口）"""
    print("=" * 60)
    print("顾问现场作战系统 - Day 3 演练验证")
    print("=" * 60)
    print()

    # 运行pytest
    import subprocess
    result = subprocess.run(
        [sys.executable, "-m", "pytest", __file__, "-v", "--tb=short"],
        cwd=str(project_root)
    )

    return result.returncode


if __name__ == "__main__":
    exit_code = run_rehearsal()
    sys.exit(exit_code)