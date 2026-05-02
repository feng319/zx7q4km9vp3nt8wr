# src/integrations/feishu_client.py
"""飞书多维表格客户端 - 基于 lark-cli 子进程封装"""
import subprocess, json, os
from pathlib import Path
from dotenv import load_dotenv
from typing import Dict, Optional, List

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
        """
        同步共识记录到飞书

        Args:
            record: ConsensusRecord 的字典表示，包含 id, type, content, status 等字段

        Returns:
            bool: 同步成功返回 True
        """
        company = record.get("company_name", "默认客户")
        content = record.get("content", "")
        record_type = record.get("type", "fact")
        status = record.get("status", "recorded")

        # 构造要更新的字段
        fields = {
            "共识类型": record_type,
            "共识内容": content,
            "状态": status,
        }

        try:
            self.upsert_record(company, fields)
            return True
        except Exception as e:
            print(f"飞书同步失败: {e}")
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

    def calc_completeness(self, record: Optional[Dict]) -> float:
        """程序硬规则判断完整度，返回 0.0-1.0"""
        if not record:
            return 0.0
        rules = {
            "产品线": 20, "客户群体": 10, "收入结构": 10,
            "毛利结构": 10, "交付情况": 10, "资源分布": 10, "战略目标": 15,
        }
        fields = record.get("fields", {})
        filled = sum(1 for k, min_len in rules.items()
                     if len(str(fields.get(k, ""))) >= min_len)
        return filled / len(rules)

    def render_to_doc(self, company: str, doc_token: str = None) -> Dict:
        """把多维表格记录渲染到云文档

        TODO: Day 3 确认 doc_template.md 的占位符格式后完善
        当前假设占位符格式为 {{字段名}}，需实际验证
        """
        if doc_token is None:
            doc_token = self.doc_template_token

        record = self.get_client_profile(company)
        if not record:
            raise ValueError(f"找不到客户：{company}")
        f = record["fields"]

        template = Path("doc_template.md").read_text(encoding="utf-8")
        rendered = template
        # 占位符格式：{{字段名}}（待 Day 3 确认实际格式）
        for key in ["客户公司名", "产品线", "客户群体", "收入结构",
                    "毛利结构", "交付情况", "资源分布", "战略目标"]:
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