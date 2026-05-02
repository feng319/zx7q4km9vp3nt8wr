# tests/test_feishu_sync.py
"""飞书同步模块单元测试

根据设计文档 11.2 节测试用例：
- 轮询启动/停止测试
- 变更检测测试
- 队列消费测试
- 心跳文件测试
"""
import pytest
import time
import queue
import threading
from unittest.mock import Mock, MagicMock
from datetime import datetime

from src.integrations.feishu_sync import FeishuSync, FeishuSyncMock


class MockFeishuClientForSync:
    """Mock 飞书客户端（用于同步测试）"""

    def __init__(self):
        self._records = [
            {"record_id": "rec_001", "fields": {"客户公司名": "测试公司A", "版本": 1}},
            {"record_id": "rec_002", "fields": {"客户公司名": "测试公司B", "版本": 1}}
        ]
        self._call_count = 0

    def list_records(self):
        """返回记录列表（模拟变更）"""
        self._call_count += 1

        # 第3次调用时模拟变更
        if self._call_count >= 3:
            self._records[0]["fields"]["版本"] = 2

        return self._records.copy()

    def get_client_profile(self, company: str):
        """返回客户档案"""
        for r in self._records:
            if r["fields"].get("客户公司名") == company:
                return r
        return None


def mock_on_record_change(record_data, session_state):
    """Mock 变更回调"""
    if "processed_records" not in session_state:
        session_state.processed_records = []
    session_state.processed_records.append(record_data.get("record_id"))


# ============= FeishuSyncMock 测试 =============

def test_feishu_sync_mock_basic():
    """测试 Mock 基本功能"""
    sync = FeishuSyncMock()

    assert sync.start_listening() == True
    assert sync.get_status()["is_running"] == True

    sync.stop_listening()
    assert sync.get_status()["is_running"] == False

    assert sync.get_pending_changes() == []
    assert sync.force_sync()["success"] == True


# ============= FeishuSync 测试 =============

def test_feishu_sync_init():
    """测试初始化"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=10,
        heartbeat_file="logs/test_heartbeat.txt"
    )

    assert sync.poll_interval == 10
    assert sync.feishu_client == client
    assert sync.change_queue.empty()


def test_feishu_sync_start_stop():
    """测试启动和停止"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=5
    )

    # 启动
    result = sync.start_listening()
    assert result == True
    assert sync._running == True
    assert sync._thread is not None

    # 等待线程启动
    time.sleep(0.5)

    status = sync.get_status()
    assert status["is_running"] == True

    # 停止
    sync.stop_listening()
    assert sync._running == False

    # 等待线程结束
    time.sleep(1)

    status = sync.get_status()
    assert status["is_running"] == False


def test_feishu_sync_change_detection():
    """测试变更检测"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=1
    )

    # 手动调用变更检测
    sync._check_changes()

    # 第一次检测，所有记录都是新的
    assert sync.stats["poll_count"] == 1
    assert sync.stats["change_count"] == 2  # 两条新记录

    # 再次检测（无变更）
    sync._check_changes()
    assert sync.stats["poll_count"] == 2
    assert sync.stats["change_count"] == 2  # 还是2，无新增

    # 模拟变更
    client._call_count = 2  # 设置为即将变更
    sync._check_changes()
    assert sync.stats["change_count"] == 3  # 检测到1条变更


def test_feishu_sync_queue_operations():
    """测试队列操作"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=10
    )

    # 手动写入队列
    sync.change_queue.put({
        "record_id": "rec_test",
        "data": {"fields": {"测试": "数据"}},
        "change_type": "update",
        "timestamp": datetime.now().isoformat()
    })

    # 获取待处理变更
    changes = sync.get_pending_changes()
    assert len(changes) == 1
    assert changes[0]["record_id"] == "rec_test"

    # 队列应该已清空
    assert sync.change_queue.empty()


def test_feishu_sync_process_changes():
    """测试主线程变更处理"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=10
    )

    # 模拟 session_state
    mock_session_state = {}

    # 写入队列
    sync.change_queue.put({
        "record_id": "rec_001",
        "data": {"record_id": "rec_001", "fields": {"客户公司名": "测试"}},
        "change_type": "update",
        "timestamp": datetime.now().isoformat()
    })

    # 处理变更
    result = sync.process_changes_in_main_thread(mock_session_state)

    assert result["processed"] == 1
    assert "rec_001" in result["changes"]
    assert "processed_records" in mock_session_state
    assert "rec_001" in mock_session_state["processed_records"]


def test_feishu_sync_error_handling():
    """测试错误处理"""
    # Mock 会抛出异常的客户端
    failing_client = Mock()
    failing_client.list_records = Mock(side_effect=Exception("网络错误"))

    sync = FeishuSync(
        feishu_client=failing_client,
        on_record_change=mock_on_record_change,
        poll_interval=10
    )

    # 检查变更（会捕获异常）
    sync._check_changes()

    assert sync.stats["error_count"] == 1
    assert sync.stats["last_error"] == "网络错误"

    # 错误应该写入队列
    changes = sync.get_pending_changes()
    assert len(changes) == 1
    assert changes[0]["change_type"] == "error"


def test_feishu_sync_force_sync():
    """测试强制同步"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=10
    )

    # 强制同步所有
    result = sync.force_sync()
    assert result["success"] == True
    assert len(result["records"]) == 2

    # 强制同步指定客户
    result = sync.force_sync("测试公司A")
    assert result["success"] == True
    assert len(result["records"]) == 1


def test_feishu_sync_clear_cache():
    """测试清除缓存"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=10
    )

    # 先检测一次，建立快照
    sync._check_changes()
    assert len(sync._last_snapshot) > 0

    # 清除缓存
    sync.clear_cache()
    assert len(sync._last_snapshot) == 0


def test_feishu_sync_heartbeat():
    """测试心跳文件"""
    import tempfile
    import os

    # 使用临时文件
    temp_file = tempfile.mktemp(suffix=".txt")

    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=10,
        heartbeat_file=temp_file
    )

    # 写入心跳
    sync._write_heartbeat("test_status")

    # 验证文件存在
    assert os.path.exists(temp_file)

    # 读取内容
    with open(temp_file, "r", encoding="utf-8") as f:
        content = f.read()
        assert "test_status" in content
        assert "poll_count" in content

    # 清理
    os.remove(temp_file)


def test_feishu_sync_thread_safety():
    """测试线程安全"""
    client = MockFeishuClientForSync()
    sync = FeishuSync(
        feishu_client=client,
        on_record_change=mock_on_record_change,
        poll_interval=1
    )

    # 启动线程
    sync.start_listening()

    # 并发访问状态
    def check_status():
        for _ in range(10):
            status = sync.get_status()
            assert "is_running" in status
            time.sleep(0.1)

    # 启动多个检查线程
    threads = [threading.Thread(target=check_status) for _ in range(3)]
    for t in threads:
        t.start()

    # 等待完成
    time.sleep(2)
    sync.stop_listening()

    for t in threads:
        t.join(timeout=2)

    # 验证统计信息正常
    assert sync.stats["poll_count"] > 0