# src/integrations/feishu_sync.py
"""飞书实时同步模块

根据设计文档 11.2 节实现：
- 轮询方案（主方案）
- 线程安全队列
- 心跳检测
- 断线重连
"""
import threading
import time
import queue
import json
from typing import Callable, Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path


class FeishuSync:
    """飞书实时同步（轮询方案）

    架构分工：
    - 后台线程：轮询飞书API，检测变更，写入队列
    - 主线程：消费队列，更新 session_state

    这样设计是为了避免后台线程直接操作 Streamlit 的 session_state（非线程安全）。
    """

    def __init__(
        self,
        feishu_client,
        on_record_change: Callable,
        poll_interval: int = 30,
        heartbeat_file: str = "logs/sync_heartbeat.txt"
    ):
        """
        Args:
            feishu_client: 飞书客户端实例
            on_record_change: 变更回调函数 (record_data, session_state) -> None
            poll_interval: 轮询间隔（秒），默认30秒
            heartbeat_file: 心跳文件路径
        """
        self.feishu_client = feishu_client
        self.on_record_change = on_record_change
        self.poll_interval = poll_interval
        self.heartbeat_file = Path(heartbeat_file)

        # 线程安全队列：后台线程只写队列，不直接写 session_state
        self.change_queue: queue.Queue = queue.Queue()

        # 快照缓存：用于检测变更
        self._last_snapshot: Dict[str, str] = {}  # record_id -> JSON序列化后的字符串

        # 已知写入集合：避免自写自触发的假变更
        # 当 Streamlit 侧写入记录后，把 record_id 加入此集合，_check_changes 跳过这些 ID
        self._known_write_ids: set = set()
        self._known_write_lock = threading.Lock()

        # 线程控制
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()  # 保护 _running 和 _thread 的并发访问

        # 统计信息（线程安全）
        self._stats_lock = threading.Lock()
        self.stats = {
            "poll_count": 0,
            "change_count": 0,
            "error_count": 0,
            "last_poll_time": None,
            "last_error": None
        }

        # 确保心跳文件目录存在
        self.heartbeat_file.parent.mkdir(parents=True, exist_ok=True)

    def _update_stats(self, key: str, value: Any = None, increment: int = None):
        """线程安全地更新统计信息

        Args:
            key: 统计项键名
            value: 设置的值（可选）
            increment: 增量值（可选）
        """
        with self._stats_lock:
            if increment is not None:
                self.stats[key] = self.stats.get(key, 0) + increment
            if value is not None:
                self.stats[key] = value

    def _get_stats(self) -> Dict:
        """线程安全地获取统计信息副本"""
        with self._stats_lock:
            return self.stats.copy()

    def start_listening(self) -> bool:
        """启动后台轮询线程

        Returns:
            bool: 启动成功返回 True
        """
        with self._lock:
            if self._running:
                return True  # 已经在运行

            if self._thread is not None and self._thread.is_alive():
                # 旧线程还在运行，等待其结束
                self._running = False
                self._thread.join(timeout=5)

            # 初始化快照：避免首次轮询触发全量变更
            self._initialize_snapshot()

            self._running = True
            self._thread = threading.Thread(target=self._poll_loop, daemon=True)
            self._thread.start()

        self._write_heartbeat("started")
        return True

    def _initialize_snapshot(self):
        """初始化快照，避免首次轮询触发全量变更

        问题修复：_check_changes 首次运行时会把所有现有记录都当作"变更"推入队列。
        解决方案：在启动时先做一次初始化快照，记录所有现有记录的状态。
        """
        try:
            records = self.feishu_client.list_records()
            for record in records:
                rid = record.get("record_id")
                if rid:
                    self._last_snapshot[rid] = json.dumps(record, sort_keys=True, default=str)
            self._write_heartbeat(f"initialized with {len(self._last_snapshot)} records")
        except Exception as e:
            # 初始化失败不影响启动，只是首次轮询会有全量变更
            self._write_heartbeat(f"init failed: {e}")

    def stop_listening(self):
        """停止轮询线程"""
        with self._lock:
            self._running = False
            thread_to_join = self._thread
            self._thread = None

        if thread_to_join is not None:
            thread_to_join.join(timeout=5)

        self._write_heartbeat("stopped")

    def _poll_loop(self):
        """轮询主循环"""
        while self._running:
            try:
                self._check_changes()
                self._write_heartbeat("running")
            except Exception as e:
                self._handle_error(str(e))

            time.sleep(self.poll_interval)

    def _check_changes(self):
        """检查变更（合并 handler）"""
        self._update_stats("poll_count", increment=1)
        self._update_stats("last_poll_time", value=datetime.now().isoformat())

        try:
            records = self.feishu_client.list_records()

            for record in records:
                rid = record.get("record_id")
                if not rid:
                    continue

                # 跳过已知写入的记录（避免自写自触发）
                with self._known_write_lock:
                    if rid in self._known_write_ids:
                        # 更新快照但不触发变更回调
                        self._last_snapshot[rid] = json.dumps(record, sort_keys=True, default=str)
                        self._known_write_ids.discard(rid)  # 一次性使用后移除
                        continue

                # 使用 JSON 序列化进行比较，避免 datetime 等类型的误判
                record_json = json.dumps(record, sort_keys=True, default=str)

                if self._last_snapshot.get(rid) != record_json:
                    # 检测到变更，写入队列
                    self.change_queue.put({
                        "record_id": rid,
                        "data": record,
                        "change_type": "update",
                        "timestamp": datetime.now().isoformat()
                    })

                    self._last_snapshot[rid] = record_json
                    self._update_stats("change_count", increment=1)

        except Exception as e:
            # 异常写入队列，主线程处理
            self.change_queue.put({
                "change_type": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            })
            self.stats["error_count"] += 1
            self.stats["last_error"] = str(e)

    def register_known_write(self, record_id: str):
        """注册已知写入的记录ID

        当 Streamlit 侧写入记录到飞书后，调用此方法注册 record_id，
        避免下次轮询时把这条记录误判为"外部变更"。

        Args:
            record_id: 刚写入的记录ID
        """
        with self._known_write_lock:
            self._known_write_ids.add(record_id)

    def _handle_error(self, error: str):
        """处理错误"""
        self.stats["error_count"] += 1
        self.stats["last_error"] = error

        # 写入错误日志
        self._write_heartbeat(f"error: {error}")

        # 错误也写入队列
        self.change_queue.put({
            "change_type": "error",
            "error": error,
            "timestamp": datetime.now().isoformat()
        })

    def _write_heartbeat(self, status: str):
        """写入心跳文件"""
        try:
            with open(self.heartbeat_file, "w", encoding="utf-8") as f:
                f.write(f"{datetime.now().isoformat()} | {status}\n")
                f.write(f"poll_count: {self.stats['poll_count']}\n")
                f.write(f"change_count: {self.stats['change_count']}\n")
                f.write(f"error_count: {self.stats['error_count']}\n")
        except Exception:
            pass  # 心跳写入失败不影响主流程

    def get_pending_changes(self) -> List[Dict]:
        """获取待处理的变更记录（主线程调用）"""
        changes = []
        while not self.change_queue.empty():
            try:
                changes.append(self.change_queue.get_nowait())
            except queue.Empty:
                break
        return changes

    def process_changes_in_main_thread(self, session_state) -> Dict:
        """在主线程中处理变更（Streamlit回调）

        Args:
            session_state: Streamlit 的 st.session_state

        Returns:
            Dict: 处理结果统计
        """
        changes = self.get_pending_changes()
        result = {
            "processed": 0,
            "errors": 0,
            "changes": []
        }

        for change in changes:
            if change.get("change_type") == "error":
                # 错误处理
                session_state.last_sync_error = change["error"]
                result["errors"] += 1
            else:
                # 正常变更处理
                try:
                    self.on_record_change(change["data"], session_state)
                    result["processed"] += 1
                    result["changes"].append(change["record_id"])
                except Exception as e:
                    session_state.last_sync_error = str(e)
                    result["errors"] += 1

        return result

    def get_status(self) -> Dict:
        """获取同步状态"""
        with self._lock:
            is_running = self._running
            thread_alive = self._thread.is_alive() if self._thread else False

        return {
            "is_running": is_running,
            "thread_alive": thread_alive,
            "queue_size": self.change_queue.qsize(),
            "stats": self.stats.copy(),
            "poll_interval": self.poll_interval
        }

    def force_sync(self, company: str = None) -> Dict:
        """强制同步一次（不等待轮询）

        Args:
            company: 可选，指定客户公司名

        Returns:
            Dict: 同步结果
        """
        result = {
            "success": False,
            "records": [],
            "error": None
        }

        try:
            if company:
                # 同步指定客户
                record = self.feishu_client.get_client_profile(company)
                if record:
                    result["records"].append(record)
                    # 更新快照
                    rid = record.get("record_id")
                    if rid:
                        self._last_snapshot[rid] = json.dumps(record, sort_keys=True, default=str)
            else:
                # 同步所有
                records = self.feishu_client.list_records()
                result["records"] = records
                # 更新快照
                for record in records:
                    rid = record.get("record_id")
                    if rid:
                        self._last_snapshot[rid] = json.dumps(record, sort_keys=True, default=str)

            result["success"] = True

        except Exception as e:
            result["error"] = str(e)

        return result

    def clear_cache(self):
        """清除快照缓存"""
        self._last_snapshot.clear()


class FeishuSyncMock:
    """飞书同步 Mock（用于测试）"""

    def __init__(self):
        self._running = False
        self.poll_interval = 30
        self.stats = {
            "poll_count": 0,
            "change_count": 0,
            "error_count": 0,
            "last_poll_time": None,
            "last_error": None
        }

    def start_listening(self) -> bool:
        self._running = True
        return True

    def stop_listening(self):
        self._running = False

    def get_pending_changes(self) -> List[Dict]:
        return []

    def process_changes_in_main_thread(self, session_state) -> Dict:
        return {"processed": 0, "errors": 0, "changes": []}

    def get_status(self) -> Dict:
        return {
            "is_running": self._running,
            "thread_alive": False,
            "queue_size": 0,
            "stats": self.stats.copy(),
            "poll_interval": self.poll_interval
        }

    def force_sync(self, company: str = None) -> Dict:
        return {"success": True, "records": [], "error": None}

    def clear_cache(self):
        pass
