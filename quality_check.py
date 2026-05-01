#!/usr/bin/env python3
"""知识库质量分析脚本 - 分析三个知识库的 Stage 3/4 输出质量"""

import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

# 导入项目内的 spec_validator（避免重复定义检查项）
sys.path.insert(0, str(Path(__file__).resolve().parent / "Anything2Ontology" / "src"))
from skus2ontology.spec_validator import CHECKS as SPEC_CHECKS, SKU_LINE_RE, validate as _validate_spec

BASE = Path(r"G:\Program Files\AI coding\知识萃取")
KBS = ["商业模式资本", "战略分析", "新能源"]
OUTPUT_DIR = BASE / "quality_report"

# ── helpers ──────────────────────────────────────────────────────────

def count_files(d: Path) -> int:
    return len(list(d.iterdir())) if d.exists() else 0


def read_json(p: Path) -> dict | list | None:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""


# ── analysis functions ───────────────────────────────────────────────

def analyze_sku_distribution(kb_dir: Path) -> dict:
    """Stage 3: SKU 数量、分类分布、平均文件大小（SKU 是目录，内含 content.md/header.md）"""
    skus_dir = kb_dir / "输出" / "skus"
    result = {}
    total = 0
    for cls in ["factual", "procedural", "relational"]:
        d = skus_dir / cls
        # SKU entries are directories (sku_001/, skill_001/, etc.)
        dirs = sorted(d.iterdir()) if d.exists() else []
        dirs = [x for x in dirs if x.is_dir() and not x.name.startswith(".")]
        result[f"{cls}_count"] = len(dirs)
        total += len(dirs)
        # Measure content.md or content.json size
        sizes = []
        for sd in dirs:
            for fname in ["content.md", "content.json"]:
                fp = sd / fname
                if fp.exists():
                    sizes.append(fp.stat().st_size)
                    break
        if sizes:
            result[f"{cls}_avg_bytes"] = int(sum(sizes) / len(sizes))
            result[f"{cls}_min_bytes"] = min(sizes)
            result[f"{cls}_max_bytes"] = max(sizes)
        else:
            result[f"{cls}_avg_bytes"] = 0
            result[f"{cls}_min_bytes"] = 0
            result[f"{cls}_max_bytes"] = 0
    result["total"] = total
    return result


def analyze_chunk_coverage(kb_dir: Path) -> dict:
    """Stage 3: chunk_to_sku 覆盖率"""
    c2s_path = kb_dir / "输出" / "ontology" / "chunk_to_sku.json"
    data = read_json(c2s_path)
    if not data:
        return {"chunk_count": 0, "coverage": 0, "empty_chunks": 0}

    chunk_count = len(data)
    empty = sum(1 for v in data.values() if not v)
    covered = chunk_count - empty
    return {
        "chunk_count": chunk_count,
        "chunks_with_skus": covered,
        "chunks_empty": empty,
        "coverage_pct": round(covered / chunk_count * 100, 1) if chunk_count else 0,
    }


def analyze_eureka(kb_dir: Path) -> dict:
    """Stage 3: eureka.md 质量"""
    eureka = kb_dir / "输出" / "ontology" / "eureka.md"
    text = read_text(eureka)
    if not text:
        return {"exists": False}

    # Count chunk references — 实际格式为 [报告-xxx_chunk_001]，非 [chunk: xxx]
    chunk_refs = re.findall(r"\[[^\]]*_chunk_\d+[^\]]*\]", text)
    unique_chunks = set(chunk_refs)

    # Count sections
    h2s = re.findall(r"^## .+", text, re.MULTILINE)

    # Check for prefix drift (report- vs 报告-)
    bad_prefixes = re.findall(r"\breport-\S+", text)

    return {
        "exists": True,
        "chars": len(text),
        "chunk_refs_total": len(chunk_refs),
        "chunk_refs_unique": len(unique_chunks),
        "sections": len(h2s),
        "bad_prefix_drift": len(bad_prefixes),
        "bad_prefix_samples": bad_prefixes[:3],
    }


def validate_spec_detail(spec_text: str) -> list[dict]:
    """对 spec 内容执行污染检查，返回逐项结果（复用 spec_validator.CHECKS）。"""
    results = []
    for key, (pattern, desc) in SPEC_CHECKS.items():
        hits = re.findall(pattern, spec_text)
        count = len(hits)
        is_critical = key != "remaining_anchor"
        status = "PASS" if count == 0 else ("FAIL" if is_critical else "INFO")
        results.append({
            "check": key,
            "desc": desc,
            "count": count,
            "status": status,
            "samples": hits[:5],
        })
    return results


def analyze_spec(kb_dir: Path) -> dict:
    """Stage 4: spec.md 质量（含六项污染检查）"""
    spec_path = kb_dir / "输出" / "ontology" / "spec.md"
    text = read_text(spec_path)
    if not text:
        return {"exists": False}

    anchors = re.findall(r"【锚点[^】]*】", text)
    chunk_refs = re.findall(r"\[chunk:\s*[^\]]+\]", text)
    sku_refs = re.findall(r"skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+", text)
    unique_skus = set(sku_refs)

    h1s = re.findall(r"^# .+", text, re.MULTILINE)
    h2s = re.findall(r"^## .+", text, re.MULTILINE)
    h3s = re.findall(r"^### .+", text, re.MULTILINE)

    # 污染检查（复用 spec_validator.CHECKS）
    checks = validate_spec_detail(text)
    critical_fails = [c for c in checks if c["status"] == "FAIL"]

    return {
        "exists": True,
        "chars": len(text),
        "anchors_remaining": len(anchors),
        "anchors_unique": len(set(anchors)),
        "chunk_refs": len(chunk_refs),
        "chunk_refs_unique": len(set(chunk_refs)),
        "sku_refs": len(sku_refs),
        "sku_refs_unique": len(unique_skus),
        "sku_line_refs": len(SKU_LINE_RE.findall(text)),
        "h1_count": len(h1s),
        "h2_count": len(h2s),
        "h3_count": len(h3s),
        "anchor_free": len(anchors) == 0,
        "checks": checks,
        "critical_fails": len(critical_fails),
        "all_pass": len(critical_fails) == 0,
    }


def analyze_chat_log(kb_dir: Path) -> dict:
    """Stage 4: chat_log 质量"""
    log_path = kb_dir / "输出" / "ontology" / "chat_log.json"
    data = read_json(log_path)
    if not data:
        return {"exists": False}

    messages = data.get("messages", [])
    user_msgs = [m for m in messages if m.get("role") == "user"]
    assistant_msgs = [m for m in messages if m.get("role") == "assistant"]

    return {
        "exists": True,
        "rounds_used": data.get("rounds_used", 0),
        "max_rounds": data.get("max_rounds", 0),
        "confirmed": data.get("confirmed", False),
        "total_messages": len(messages),
        "user_messages": len(user_msgs),
        "assistant_messages": len(assistant_msgs),
        "started_at": data.get("started_at", "?")[:19],
    }


def analyze_sku_duplicates(kb_dir: Path) -> dict:
    """Stage 3: SKU 重复检测"""
    index_path = kb_dir / "输出" / "ontology" / "skus" / "skus_index.json"
    data = read_json(index_path)
    if not data:
        return {"total": 0}

    skus = data.get("skus", []) if isinstance(data, dict) and "skus" in data else []
    names = [s.get("name", "") for s in skus]
    ids = [s.get("sku_id", "") for s in skus]
    name_dups = sum(1 for v in Counter(names).values() if v > 1)
    id_dups = sum(1 for v in Counter(ids).values() if v > 1)

    # Empty fields
    empty_names = sum(1 for n in names if not n)
    empty_descs = sum(1 for s in skus if not s.get("description", ""))

    return {
        "total": len(skus),
        "duplicate_names": name_dups,
        "duplicate_ids": id_dups,
        "empty_names": empty_names,
        "empty_descriptions": empty_descs,
    }


def analyze_readme(kb_dir: Path, actual_sku: dict) -> dict:
    """Stage 3/4: README.md 质量检查"""
    path = kb_dir / "输出" / "ontology" / "README.md"
    text = read_text(path)
    if not text:
        return {"exists": False}

    issues: list[str] = []

    # 1. 不应提及残留锚点（remaining_anchor 已全部清零）
    anchor_mentions = re.findall(r"残留锚点|【锚点", text)
    if anchor_mentions:
        issues.append(f"残留锚点误导信息: {len(anchor_mentions)} 处")

    # 2. Agent 查询协议表应包含 [chunk:] 解析链路
    has_chunk_protocol = "chunk_to_sku.json" in text and ("步骤1" in text or "步骤" in text)

    # 3. spec.md 引用格式应为"两类引用"（非"三类引用"）
    has_three_types = bool(re.search(r"三类引用", text))

    # 4. 统计数据与实际 SKU 数量一致性
    stat_mismatches: list[str] = []
    factual_match = re.search(r"事实型SKU.*?:\s*(\d+)", text)
    procedural_match = re.search(r"程序型SKU.*?:\s*(\d+)", text)
    if factual_match:
        stated = int(factual_match.group(1))
        actual = actual_sku.get("factual_count", 0)
        if stated != actual:
            stat_mismatches.append(f"事实型: README={stated}, 实际={actual}")
    if procedural_match:
        stated = int(procedural_match.group(1))
        actual = actual_sku.get("procedural_count", 0)
        if stated != actual:
            stat_mismatches.append(f"程序型: README={stated}, 实际={actual}")

    return {
        "exists": True,
        "chars": len(text),
        "anchor_mentions": len(anchor_mentions),
        "has_chunk_protocol": has_chunk_protocol,
        "has_three_types_ref": has_three_types,
        "stat_mismatches": stat_mismatches,
        "issues": issues,
        "all_pass": len(issues) == 0 and not has_three_types and not stat_mismatches and has_chunk_protocol,
    }


def analyze_mapping(kb_dir: Path) -> dict:
    """Stage 3/4: mapping.md 质量"""
    path = kb_dir / "输出" / "ontology" / "mapping.md"
    text = read_text(path)
    if not text:
        return {"exists": False}

    h2s = re.findall(r"^## .+", text, re.MULTILINE)
    sku_lines = re.findall(r"^- .+", text, re.MULTILINE)

    return {
        "exists": True,
        "chars": len(text),
        "sections": len(h2s),
        "sku_entries": len(sku_lines),
    }


# ── main ─────────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    report_lines = []
    summary_table = []

    report_lines.append("# 知识库质量分析报告\n")
    report_lines.append(f"分析时间: 2026-05-01\n\n")

    for kb in KBS:
        kb_dir = BASE / kb
        report_lines.append(f"---\n## {kb}\n")

        # Stage 3 analysis
        sku = analyze_sku_distribution(kb_dir)
        coverage = analyze_chunk_coverage(kb_dir)
        eureka = analyze_eureka(kb_dir)
        dup = analyze_sku_duplicates(kb_dir)
        mapping = analyze_mapping(kb_dir)

        # Stage 4 analysis
        spec = analyze_spec(kb_dir)
        chat = analyze_chat_log(kb_dir)

        # README check (needs sku stats)
        readme = analyze_readme(kb_dir, sku)

        # ── SKU Distribution ──
        report_lines.append("### Stage 3: SKU 分布\n")
        report_lines.append(f"| 分类 | 数量 | 平均大小 | 最小 | 最大 |")
        report_lines.append(f"|------|------|---------|------|------|")
        for cls in ["factual", "procedural", "relational"]:
            cnt = sku[f"{cls}_count"]
            avg = sku[f"{cls}_avg_bytes"]
            mn = sku[f"{cls}_min_bytes"]
            mx = sku[f"{cls}_max_bytes"]
            report_lines.append(f"| {cls} | {cnt} | {avg}B | {mn}B | {mx}B |")
        report_lines.append(f"| **总计** | **{sku['total']}** | | | |\n")

        # ── Chunk Coverage ──
        report_lines.append("### Stage 3: Chunk 覆盖率\n")
        report_lines.append(f"- 总 chunks: {coverage['chunk_count']}")
        report_lines.append(f"- 有 SKU 映射: {coverage['chunks_with_skus']}")
        report_lines.append(f"- 空映射: {coverage['chunks_empty']}")
        cov_pct = coverage['coverage_pct']
        cov_status = "PASS" if cov_pct >= 80 else "WARN" if cov_pct >= 50 else "FAIL"
        report_lines.append(f"- 覆盖率: **{cov_pct}%** [{cov_status}]\n")

        # ── Eureka ──
        report_lines.append("### Stage 3: Eureka.md\n")
        if eureka["exists"]:
            report_lines.append(f"- 大小: {eureka['chars']} chars")
            report_lines.append(f"- Chunk 引用: {eureka['chunk_refs_total']} total, {eureka['chunk_refs_unique']} unique")
            report_lines.append(f"- 章节数: {eureka['sections']}")
            if eureka["bad_prefix_drift"]:
                report_lines.append(f"- ⚠ 前缀漂移: {eureka['bad_prefix_drift']} 个 (report- → 报告-)")
                for s in eureka["bad_prefix_samples"]:
                    report_lines.append(f"  - {s}")
            else:
                report_lines.append(f"- 前缀漂移: 0 [PASS]")
        else:
            report_lines.append("- ⚠ 文件不存在\n")

        # ── SKU Duplicates ──
        report_lines.append("### Stage 3: SKU 重复检测\n")
        report_lines.append(f"- 总 SKU: {dup['total']}")
        dup_status = "PASS" if dup["duplicate_names"] == 0 and dup["duplicate_ids"] == 0 else "FAIL"
        report_lines.append(f"- 重复名称: {dup['duplicate_names']} [{dup_status}]")
        report_lines.append(f"- 重复 ID: {dup['duplicate_ids']} [{dup_status}]")
        report_lines.append(f"- 空名称: {dup['empty_names']}")
        report_lines.append(f"- 空描述: {dup['empty_descriptions']}\n")

        # ── Mapping ──
        report_lines.append("### Stage 3/4: Mapping.md\n")
        if mapping["exists"]:
            report_lines.append(f"- 大小: {mapping['chars']} chars")
            report_lines.append(f"- 章节数: {mapping['sections']}")
            report_lines.append(f"- SKU 条目: {mapping['sku_entries']}\n")
        else:
            report_lines.append("- ⚠ 文件不存在\n")

        # ── README ──
        report_lines.append("### Stage 3/4: README.md\n")
        if readme["exists"]:
            report_lines.append(f"- 大小: {readme['chars']} chars")
            anchor_status = "PASS" if readme["anchor_mentions"] == 0 else "FAIL"
            report_lines.append(f"- 残留锚点提及: {readme['anchor_mentions']} [{anchor_status}]")
            chunk_status = "PASS" if readme["has_chunk_protocol"] else "FAIL"
            report_lines.append(f"- [chunk:] 协议链路: {'有' if readme['has_chunk_protocol'] else '无'} [{chunk_status}]")
            three_status = "FAIL" if readme["has_three_types_ref"] else "PASS"
            report_lines.append(f"- 引用类型正确（两类）: {'是' if not readme['has_three_types_ref'] else '否（仍为三类）'} [{three_status}]")
            if readme["stat_mismatches"]:
                report_lines.append(f"- ⚠ 统计不一致:")
                for m in readme["stat_mismatches"]:
                    report_lines.append(f"  - {m}")
            else:
                report_lines.append(f"- 统计一致性: [PASS]")
            readme_status = "PASS" if readme["all_pass"] else "FAIL"
            report_lines.append(f"- **结论: {readme_status}**\n")
        else:
            report_lines.append("- ⚠ 文件不存在 [FAIL]\n")

        # ── Spec ──
        report_lines.append("### Stage 4: Spec.md\n")
        if spec["exists"]:
            report_lines.append(f"- 大小: {spec['chars']} chars")
            report_lines.append(f"- 章节结构: H1={spec['h1_count']}, H2={spec['h2_count']}, H3={spec['h3_count']}")
            anchor_status = "PASS" if spec["anchor_free"] else "FAIL"
            report_lines.append(f"- 剩余锚点: {spec['anchors_remaining']} (unique: {spec['anchors_unique']}) [{anchor_status}]")
            report_lines.append(f"- Chunk 引用: {spec['chunk_refs']} (unique: {spec['chunk_refs_unique']})")
            report_lines.append(f"- SKU 引用: {spec['sku_refs']} (unique: {spec['sku_refs_unique']})")
            if sku["total"] > 0:
                cov = round(spec["sku_refs_unique"] / sku["total"] * 100, 1)
                report_lines.append(f"- SKU 覆盖率: {cov}% (spec引用 / ontology总SKU)")

            # 六项污染检查结果
            report_lines.append(f"\n#### Spec 污染检查\n")
            report_lines.append(f"| 检查项 | 结果 | 数量 |")
            report_lines.append(f"|--------|------|------|")
            for c in spec["checks"]:
                report_lines.append(f"| {c['desc']} | {c['status']} | {c['count']} |")
            pass_fail = "PASS" if spec["all_pass"] else f"FAIL ({spec['critical_fails']}项)"
            report_lines.append(f"\n- **结论: {pass_fail}**\n")
        else:
            report_lines.append("- ⚠ 文件不存在\n")

        # ── Chat Log ──
        report_lines.append("### Stage 4: Chat Log\n")
        if chat["exists"]:
            report_lines.append(f"- 开始时间: {chat['started_at']}")
            report_lines.append(f"- 轮次: {chat['rounds_used']}/{chat['max_rounds']}")
            report_lines.append(f"- 用户确认: {chat['confirmed']}")
            report_lines.append(f"- 消息数: {chat['total_messages']} (user={chat['user_messages']}, assistant={chat['assistant_messages']})\n")
        else:
            report_lines.append("- ⚠ 文件不存在\n")

        # ── Summary row ──
        summary_table.append({
            "name": kb,
            "skus": sku["total"],
            "chunks": coverage["chunk_count"],
            "coverage": coverage["coverage_pct"],
            "spec_size": spec.get("chars", 0),
            "anchors": spec.get("anchors_remaining", -1),
            "sku_refs": spec.get("sku_refs_unique", 0),
            "eureka_chunks": eureka.get("chunk_refs_unique", 0),
            "confirmed": chat.get("confirmed", False),
            "readme_pass": readme.get("all_pass", False),
        })

    # ── Summary table ──
    summary_lines = [
        "---\n",
        "## 总览对比\n",
        "| 指标 | 商业模式资本 | 战略分析 | 新能源 |",
        "|------|------------|---------|--------|",
    ]

    fields = [
        ("SKUs", "skus"),
        ("Chunks", "chunks"),
        ("Chunk 覆盖率", "coverage", "%"),
        ("Spec 大小", "spec_size", " chars"),
        ("剩余锚点", "anchors"),
        ("Spec SKU 引用", "sku_refs"),
        ("Eureka Chunk 引用", "eureka_chunks"),
        ("Phase 1 确认", "confirmed"),
        ("README 质量", "readme_pass"),
    ]

    for label, key, *suffix in fields:
        suffix = suffix[0] if suffix else ""
        vals = []
        for s in summary_table:
            v = s[key]
            if key in ("confirmed", "readme_pass"):
                vals.append("YES" if v else "NO")
            elif key == "anchors" and v == -1:
                vals.append("N/A")
            else:
                vals.append(f"{v}{suffix}")
        summary_lines.append(f"| {label} | {vals[0]} | {vals[1]} | {vals[2]} |")

    # ── Write report ──
    report = "\n".join(summary_lines) + "\n\n" + "\n".join(report_lines)
    report_path = OUTPUT_DIR / "quality_report.md"
    report_path.write_text(report, encoding="utf-8")
    print(f"报告已写入: {report_path}")
    print(f"\n{'='*60}\n")
    print("\n".join(summary_lines))


if __name__ == "__main__":
    main()
