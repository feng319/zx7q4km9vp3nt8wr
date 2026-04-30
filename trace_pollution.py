"""Trace where ]] pollution is introduced in the post-processing pipeline."""
import re
import json
from pathlib import Path

# Load raw Phase 2 response
log = json.loads(Path("商业模式资本/输出/ontology/chat_log.json").read_text(encoding="utf-8"))
raw = log["anchor_phase"]["response"]

# Strip markdown code block (use raw string to avoid escape issues)
pattern = re.compile(r"```(?:markdown)?\s*\n(.*?)```", re.DOTALL)
m = pattern.search(raw)
spec_draft = m.group(1).strip() if m else raw

CHECK = re.compile(r"\[chunk:[^\]]+\]\]")

print(f"Step 0 (raw extracted): ]] count = {len(CHECK.findall(spec_draft))}")
print(f"  anchors: {len(re.findall(r'【锚点：[^】]+】', spec_draft))}")

# Step 1: _unwrap_resolved_anchors
ANCHOR_PATTERN = re.compile(r"【锚点：[^】]+】")
SKU_PATH_RE = re.compile(r"skus/(?:factual|procedural|relational)/\S+")
CHUNK_REF_RE = re.compile(r"\[chunk:\s*[^\]]+\]")
CHUNK_BARE_RE = re.compile(r"chunk:\s*([^\s（）()\[\]、]+)")

def unwrap(m):
    inner = m.group(0)[4:-1]  # strip 【锚点： and 】
    if SKU_PATH_RE.search(inner) or CHUNK_REF_RE.search(inner):
        parts = [p.strip() for p in inner.split("、") if p.strip()]
        return "\n".join(parts)
    bare = CHUNK_BARE_RE.findall(inner)
    if bare:
        return "\n".join(f"[chunk: {c}]" for c in bare)
    return m.group(0)

spec1 = ANCHOR_PATTERN.sub(unwrap, spec_draft)
print(f"\nStep 1 (unwrap): ]] count = {len(CHECK.findall(spec1))}")
print(f"  anchors: {len(re.findall(r'【锚点：[^】]+】', spec1))}")
for line in spec1.split("\n"):
    if "]]" in line:
        print(f"  FOUND ]]: {line[:150]}")

# Step 2: _normalize_reference_format (first pass)
def normalize(spec):
    spec = re.sub(r"【(chunk:\s*[^】]+)】", r"[\1]", spec)
    spec = re.sub(r"(\[chunk:\s*[^\]]+\])\]+", r"\1", spec)
    spec = re.sub(r"【(skus/(?:factual|procedural|relational)/\S+)】", r"\1", spec)
    spec = re.sub(
        r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)(?=skus/)",
        r"\1\n", spec,
    )
    spec = re.sub(
        r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)(?=\[chunk:)",
        r"\1\n", spec,
    )
    spec = re.sub(
        r"(\[chunk:\s*[^\]]+\])(?=skus/)",
        r"\1\n", spec,
    )
    spec = re.sub(
        r"(skus/(?:factual|procedural|relational)/(?:sku|skill)_\d+)\s+(?=skus/)",
        r"\1\n", spec,
    )
    spec = re.sub(
        r"(\[chunk:\s*[^\]]+\])(?=\[chunk:)",
        r"\1\n", spec,
    )
    return spec

spec2 = normalize(spec1)
print(f"\nStep 2 (normalize 1st): ]] count = {len(CHECK.findall(spec2))}")
for line in spec2.split("\n"):
    if "]]" in line:
        print(f"  FOUND ]]: {line[:150]}")

# Check: what anchor patterns exist in spec_draft that contain [chunk:]?
for line in spec_draft.split("\n"):
    if "【锚点：" in line and "[chunk:" in line:
        print(f"\n  ANCHOR WITH CHUNK: {line[:150]}")
