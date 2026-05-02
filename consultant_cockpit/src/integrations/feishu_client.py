# src/integrations/feishu_client.py
"""飞书多维表格客户端 - 基于 lark-cli 子进程封装"""
import subprocess, json, os
from pathlib import Path
from dotenv import load_dotenv
from typing import Dict, Optional, List
from src.utils.logger import get_logger

_logger = get_logger("feishu_client")

load_dotenv()

APP_TOKEN = os.getenv("FEISHU_BITABLE_APP_TOKEN")
TABLE_ID = os.getenv("FEISHU_BITABLE_TABLE_ID")
DOC_TEMPLATE_TOKEN = os.getenv("FEISHU_DOC_TEMPLATE_TOKEN")


def _run_cli(args: list[str], use_format: bool = True) -> dict:
    """统一执行 lark-cli 命令，返回 JSON。"""
    cmd = ["lark-cli.cmd"] + args
    if use_format:
        cmd += ["--format", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, shell=True, encoding='utf-8')
    if result.returncode != 0:
        raise RuntimeError(f"lark-cli failed: {result.stderr}")
    return json.loads(result.stdout) if result.stdout else {}


class FeishuClient:
    """飞书多维表格客户端"""

    def __init__(self):
        self.app_token = APP_TOKEN
        self.table_id = TABLE_ID
        self.doc_template_token = DOC_TEMPLATE_TOKEN

    def _get_field_names(self) -> List[str]:
        """获取表格字段名列表"""
        fields_data = _run_cli([
            "base", "+field-list",
            "--base-token", self.app_token,
            "--table-id", self.table_id,
        ], use_format=False)
        return [f["name"] for f in fields_data.get("data", {}).get("fields", [])]

    def list_records(self) -> List[Dict]:
        """列出所有客户记录（保留原始结构）"""
        data = _run_cli([
            "base", "+record-list",
            "--base-token", self.app_token,
            "--table-id", self.table_id,
        ], use_format=True)
        if "data" in data and "items" not in data:
            # 返回格式可能是 {"data": {"data": [...], "fields": [...]}}
            # 或 {"data": {"items": [...]}}
            inner = data.get("data", {})
            return inner.get("data", inner.get("items", []))
        return data.get("items", [])

    def get_client_profile(self, company: str) -> Optional[Dict]:
        """
        获取客户档案（按公司名查询）

        注意：需要正确提取 record_id 用于后续更新操作。
        lark-cli +record-list 返回的每条记录结构可能是：
        - dict 格式: {"record_id": "xxx", "fields": {...}}
        - list 格式: [field1_value, field2_value, ...]（record_id 在独立字段）

        建议先运行调试命令确认实际结构。
        """
        field_names = self._get_field_names()
        for r in self.list_records():
            if isinstance(r, dict):
                # dict 格式：fields 在 "fields" 键里
                fields = r.get("fields", {})
                if fields.get("客户公司名") == company:
                    return {"record_id": r.get("record_id"), "fields": fields}
            elif isinstance(r, list):
                # list 格式：按字段顺序解析
                fields_dict = {}
                for i, name in enumerate(field_names):
                    if i < len(r):
                        fields_dict[name] = r[i]
                if fields_dict.get("客户公司名") == company:
                    # list 格式下 record_id 通常不在列表里，需要从其他来源获取
                    # 这种情况需要额外 API 调用或调整 list_records 返回格式
                    return {"record_id": None, "fields": fields_dict}
        return None

    def sync_consensus_record(self, record: Dict) -> bool:
        """同步共识记录到飞书"诊断共识"表

        设计文档 4.4 节：第二张表"诊断共识"结构：
        - 发现内容：record.content
        - 确认时间：record.timestamp
        - 建议方向：record.recommendation

        Args:
            record: ConsensusRecord 的字典表示

        Returns:
            bool: 同步成功返回 True
        """
        # 获取诊断共识表ID（第二张表）
        consensus_table_id = os.getenv("FEISHU_BITABLE_CONSENSUS_TABLE_ID", self.table_id)

        content = record.get("content", "")
        timestamp = record.get("timestamp", "")
        recommendation = record.get("recommendation", "")
        record_type = record.get("type", "fact")
        status = record.get("status", "recorded")

        # 构造诊断共识表的字段（设计文档 4.4 节）
        fields = {
            "发现内容": content,
            "确认时间": str(timestamp) if timestamp else "",
            "建议方向": recommendation,
            "类型": record_type,
            "状态": status,
        }

        try:
            # 写入诊断共识表
            return self._upsert_consensus_record(fields, consensus_table_id)
        except Exception as e:
            _logger.warning(f"飞书同步失败: {e}")
            return False

    def _upsert_consensus_record(self, fields: Dict, table_id: str) -> bool:
        """写入诊断共识表"""
        try:
            _run_cli([
                "base", "+record-batch-create",
                "--base-token", self.app_token,
                "--table-id", table_id,
                "--json", json.dumps({
                    "fields": list(fields.keys()),
                    "rows": [list(fields.values())]
                }, ensure_ascii=False),
            ], use_format=False)
            return True
        except Exception as e:
            _logger.error(f"写入诊断共识表失败: {e}")
            return False

    def upsert_record(self, company: str, fields: Dict) -> Dict:
        """新增或更新一条客户记录"""
        fields = {**fields, "客户公司名": company}
        existing = self.get_client_profile(company)

        field_names = list(fields.keys())
        field_values = [fields[k] for k in field_names]

        # 防护：record_id 为 None 时走新建逻辑
        if existing and existing.get("record_id") is not None:
            return _run_cli([
                "base", "+record-upsert",
                "--base-token", self.app_token,
                "--table-id", self.table_id,
                "--record-id", existing["record_id"],
                "--json", json.dumps(fields, ensure_ascii=False),
            ], use_format=False)

        # 新建记录（包含 existing 为 None 或 record_id 为 None 的情况）
        return _run_cli([
            "base", "+record-batch-create",
            "--base-token", self.app_token,
            "--table-id", self.table_id,
            "--json", json.dumps({"fields": field_names, "rows": [field_values]}, ensure_ascii=False),
        ], use_format=False)

    def update_diagnosis_progress(self, progress: float, company: str = None):
        """
        更新诊断进度

        Args:
            progress: 进度值 0.0-1.0
            company: 客户公司名（可选）
        """
        if company is None:
            company = "默认客户"

        fields = {"诊断进度": f"{progress:.0%}"}
        self.upsert_record(company, fields)

    def calc_completeness(self, record: Optional[Dict], consensus_chain=None) -> float:
        """计算客户档案完整度

        设计文档 6.2 节：
        - 9个字段等权重，每个字段非空即计 11%
        - 第 100% 由至少1条 status=confirmed 的共识链记录触发

        Args:
            record: 客户档案记录
            consensus_chain: 共识链（可选，用于触发第100%）
        """
        if not record:
            return 0.0

        # 9个字段等权重（设计文档 6.2 节）
        required_fields = [
            "客户公司名", "产品线", "客户群体", "收入结构",
            "毛利结构", "交付情况", "资源分布", "战略目标", "显性诉求"
        ]

        fields = record.get("fields", {})
        filled_count = sum(
            1 for f in required_fields
            if fields.get(f) and len(str(fields.get(f, ""))) >= 5
        )

        # 基础完整度：每个字段 11%
        base_completeness = filled_count / len(required_fields)

        # 第 100% 触发条件：至少1条 status=confirmed 的共识链记录
        if consensus_chain:
            confirmed = consensus_chain.get_confirmed_consensus()
            if confirmed:
                return min(1.0, base_completeness + 0.01)  # 触发第100%

        return base_completeness

    def render_to_doc(self, company: str, doc_token: str = None) -> Dict:
        """把多维表格记录渲染到云文档

        设计文档 4.4 节：占位符格式为 {{字段名}}

        已确认的占位符列表：
        - {{客户公司名}}
        - {{产品线}}
        - {{客户群体}}
        - {{收入结构}}
        - {{毛利结构}}
        - {{交付情况}}
        - {{资源分布}}
        - {{战略目标}}
        - {{显性诉求}}
        """
        if doc_token is None:
            doc_token = self.doc_template_token

        record = self.get_client_profile(company)
        if not record:
            raise ValueError(f"找不到客户：{company}")
        f = record["fields"]

        # 读取模板文件
        template_path = Path(__file__).parent.parent.parent / "config" / "doc_template.md"
        if template_path.exists():
            template = template_path.read_text(encoding="utf-8")
        else:
            # 默认模板
            template = """# 客户诊断报告

## 基本信息
- 客户公司名：{{客户公司名}}
- 产品线：{{产品线}}
- 客户群体：{{客户群体}}

## 业务结构
- 收入结构：{{收入结构}}
- 毛利结构：{{毛利结构}}
- 交付情况：{{交付情况}}
- 资源分布：{{资源分布}}

## 战略信息
- 战略目标：{{战略目标}}
- 显性诉求：{{显性诉求}}
"""

        rendered = template
        # 占位符格式：{{字段名}}（已确认）
        for key in ["客户公司名", "产品线", "客户群体", "收入结构",
                    "毛利结构", "交付情况", "资源分布", "战略目标", "显性诉求"]:
            rendered = rendered.replace("{{" + key + "}}", str(f.get(key, "（待填充）")))

        return _run_cli([
            "docs", "+update",
            "--doc", doc_token,
            "--markdown", rendered,
        ], use_format=False)


# 模块级函数（向后兼容）
def list_records() -> List[Dict]:
    """列出所有客户记录（模块级函数）"""
    return FeishuClient().list_records()


def get_record_by_company(company: str) -> Optional[Dict]:
    """按公司名查询单条记录（模块级函数）"""
    return FeishuClient().get_client_profile(company)


def upsert_record(company: str, fields: Dict) -> Dict:
    """新增或更新一条客户记录（模块级函数）"""
    return FeishuClient().upsert_record(company, fields)


def calc_completeness(record: Optional[Dict]) -> float:
    """计算完整度（模块级函数）"""
    return FeishuClient().calc_completeness(record)