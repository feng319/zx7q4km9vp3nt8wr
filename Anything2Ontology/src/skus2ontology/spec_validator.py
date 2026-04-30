"""Spec.md pollution validator — maps each check to one of the six mechanism fixes."""

import re
import sys
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)

CHECKS = {
    # Fix 1 / 2: CHUNK_BARE_RE charset + unwrap branch priority
    "extra_chunk_bracket": (
        r"\[chunk:[^\]]+\]\]+",
        "Fix 1/2: [chunk: xxx]] extra closing bracket",
    ),
    # Fix 2 / 6: anchor wrapping resolved refs (compound anchors)
    "anchor_wrapping_chunk": (
        r"【锚点：[^】]*\[chunk:[^】]+】",
        "Fix 2/6: 【锚点：[chunk: ...]...】 compound anchor",
    ),
    "anchor_wrapping_sku": (
        r"【锚点：[^】]*skus/(?:factual|procedural|relational)/[^】]+】",
        "Fix 2/6: 【锚点：skus/...】 compound anchor",
    ),
    # Fix 3: zero-width concatenation in _normalize_reference_format
    "sku_sku_concat": (
        r"skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+skus/",
        "Fix 3: SKU-SKU zero-width concatenation",
    ),
    "sku_chunk_concat": (
        r"skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+\[chunk:",
        "Fix 3: SKU-chunk zero-width concatenation",
    ),
    "chunk_sku_concat": (
        r"\[chunk:[^\]]+\]skus/",
        "Fix 3: chunk-SKU zero-width concatenation",
    ),
    # Fix 4: space-separated refs should be newline-separated
    "sku_space_concat": (
        r"skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+\s+skus/",
        "Fix 4: space-separated SKU refs on same line",
    ),
    # Fix 5: unexpanded SKU ranges after _expand_sku_ranges
    "sku_range": (
        r"skus/(?:factual|procedural|relational)/sku_\d{3}-\d{3}",
        "Fix 5: sku_xxx-yyy unexpanded range",
    ),
    # Chinese bracket variant for chunk refs
    "chinese_chunk_bracket": (
        r"【chunk:[^】]+】",
        "Extra: 【chunk: xxx】 Chinese bracket residue",
    ),
    # Chinese bracket variant for SKU refs
    "chinese_sku_bracket": (
        r"【skus/(?:factual|procedural|relational)/[^】]+】",
        "Extra: 【skus/...】 Chinese bracket residue",
    ),
    # Remaining unresolved anchors (informational only)
    "remaining_anchor": (
        r"【锚点：[^】]+】",
        "Info: remaining unresolved anchors",
    ),
}

# SKU path pattern (standalone line, not inside anchor/bracket)
SKU_LINE_RE = re.compile(
    r"(?m)^skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+$"
)
CHUNK_REF_RE = re.compile(r"\[chunk:\s*[^\]]+\]")


def validate(spec_path: Path) -> bool:
    """
    Validate a spec.md against all six pollution checks.

    Returns True if spec passes (zero critical issues), False otherwise.
    Logs results via structlog for chat_log integration.
    """
    if not spec_path.exists():
        logger.error("spec.md not found", path=str(spec_path))
        return False

    spec = spec_path.read_text(encoding="utf-8")
    failures: list[str] = []
    all_results: list[dict] = []

    for key, (pattern, desc) in CHECKS.items():
        hits = re.findall(pattern, spec)
        count = len(hits)
        is_critical = key != "remaining_anchor"
        status = "PASS" if count == 0 else ("FAIL" if is_critical else "INFO")

        result = {"check": key, "desc": desc, "count": count, "status": status, "samples": hits[:5]}
        all_results.append(result)

        if is_critical and count:
            failures.append(f"{desc}: {count} hits")

        # Log each check result
        log_fn = logger.info if count == 0 or not is_critical else logger.warning
        log_fn(
            "spec_check",
            check=key,
            status=status,
            count=count,
            samples=hits[:3] if hits else [],
        )

    # Reference statistics
    sku_lines = SKU_LINE_RE.findall(spec)
    chunk_refs = CHUNK_REF_RE.findall(spec)
    sku_unique = len(set(sku_lines))
    chunk_unique = len(set(chunk_refs))
    logger.info(
        "spec_stats",
        sku_refs=len(sku_lines),
        sku_unique=sku_unique,
        chunk_refs=len(chunk_refs),
        chunk_unique=chunk_unique,
    )

    passed = len(failures) == 0
    if passed:
        logger.info("spec_validator PASSED")
    else:
        logger.warning("spec_validator FAILED", failures=failures)

    return passed
