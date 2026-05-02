"""feishu_client.py - lark-cli 子进程封装层"""
import subprocess, json, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

APP_TOKEN = os.getenv("FEISHU_BITABLE_APP_TOKEN")
TABLE_ID = os.getenv("FEISHU_BITABLE_TABLE_ID")
DOC_TEMPLATE_TOKEN = os.getenv("FEISHU_DOC_TEMPLATE_TOKEN")


def _run_cli(args: list[str], use_format: bool = True) -> dict:
    """统一执行 lark-cli 命令，返回 JSON。"""
    # Windows 需要使用 lark-cli.cmd
    cmd = ["lark-cli.cmd"] + args
    if use_format:
        cmd += ["--format", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, shell=True, encoding='utf-8')
    if result.returncode != 0:
        raise RuntimeError(f"lark-cli failed: {result.stderr}")
    return json.loads(result.stdout) if result.stdout else {}


def list_records() -> list[dict]:
    """列出所有客户记录。"""
    data = _run_cli([
        "base", "+record-list",
        "--base-token", APP_TOKEN,
        "--table-id", TABLE_ID,
    ], use_format=True)
    # 适配 lark-cli base +record-list 返回格式
    if "data" in data and "items" not in data:
        # 返回格式: {"data": {"data": [...], "fields": [...], ...}}
        return data.get("data", {}).get("data", [])
    return data.get("items", [])


def get_record_by_company(company: str) -> dict | None:
    """按公司名查询单条记录。"""
    # 首先获取字段映射
    fields_data = _run_cli([
        "base", "+field-list",
        "--base-token", APP_TOKEN,
        "--table-id", TABLE_ID,
    ], use_format=False)

    field_names = [f["name"] for f in fields_data.get("data", {}).get("fields", [])]

    # 遍历记录查找
    for r in list_records():
        # 记录是列表格式，需要转换为字典
        if isinstance(r, list):
            fields_dict = {}
            for i, name in enumerate(field_names):
                if i < len(r):
                    fields_dict[name] = r[i]
            if fields_dict.get("客户公司名") == company:
                return {"record_id": None, "fields": fields_dict}  # 简化版本，record_id 需要从其他 API 获取
    return None


def upsert_record(company: str, fields: dict) -> dict:
    """新增或更新一条客户记录。"""
    fields = {**fields, "客户公司名": company}
    existing = get_record_by_company(company)

    # 构造 fields 和 rows 格式
    field_names = list(fields.keys())
    field_values = [fields[k] for k in field_names]

    if existing:
        # 更新记录 - 使用 record-upsert
        return _run_cli([
            "base", "+record-upsert",
            "--base-token", APP_TOKEN,
            "--table-id", TABLE_ID,
            "--record-id", existing["record_id"],
            "--json", json.dumps(fields, ensure_ascii=False),
        ], use_format=False)

    # 新增记录 - 使用 batch-create
    return _run_cli([
        "base", "+record-batch-create",
        "--base-token", APP_TOKEN,
        "--table-id", TABLE_ID,
        "--json", json.dumps({"fields": field_names, "rows": [field_values]}, ensure_ascii=False),
    ], use_format=False)


def calc_completeness(record: dict) -> float:
    """程序硬规则判断完整度，返回 0.0-1.0。"""
    rules = {
        "产品线": 20, "客户群体": 10, "收入结构": 10,
        "毛利结构": 10, "交付情况": 10, "资源分布": 10, "战略目标": 15,
    }
    fields = record.get("fields", {})
    filled = sum(1 for k, min_len in rules.items()
                 if len(str(fields.get(k, ""))) >= min_len)
    return filled / len(rules)


def render_to_doc(company: str, doc_token: str) -> dict:
    """把多维表格记录渲染到云文档（B.2 模板的填充版）。"""
    record = get_record_by_company(company)
    if not record:
        raise ValueError(f"找不到客户：{company}")
    f = record["fields"]

    template = Path("doc_template.md").read_text(encoding="utf-8")
    rendered = template
    for key in ["客户公司名", "产品线", "客户群体", "收入结构",
                "毛利结构", "交付情况", "资源分布", "战略目标"]:
        rendered = rendered.replace(f"{{{{{key}}}}}", str(f.get(key, "（待填充）")))

    return _run_cli([
        "docs", "+update",
        "--doc", doc_token,
        "--markdown", rendered,
    ], use_format=False)


if __name__ == "__main__":
    # 自测：跑一遍主流程
    upsert_record("测试客户A", {"显性诉求": "想做虚拟电厂", "产品线": "储能、光伏、节能改造三条线"})
    rec = get_record_by_company("测试客户A")
    print(f"完整度：{calc_completeness(rec):.0%}")
    print("✓ 飞书集成跑通")
