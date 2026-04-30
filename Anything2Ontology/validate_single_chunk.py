"""Validate bug fixes by re-running a single chunk (安悦节能).

Checks:
1. sku_078 new description: no "综合能源服务常用的", still has "节能降碳"
2. sku_078 mapping.md entry: contains "节能降碳", not "综合能源服务"
3. _validate_mapping_entries warning logs (if any)
"""
import json
import re
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from chunks2skus.config import settings
from chunks2skus.pipeline import ExtractionPipeline

# The chunk to test
CHUNK_NAME = "报告-安悦节能调研报告：怎样做冷热电综合能源服务？_chunk_001"

print(f"=== Single Chunk Validation: {CHUNK_NAME} ===\n")

# Run pipeline with force_reset on just this chunk
settings.meta_interval = 1  # Run meta after every chunk (we only have 1)

p = ExtractionPipeline(force_reset=True)

# Get all chunks, filter to only the 安悦节能 one
all_chunks = p.router.load_chunks(p.chunks_dir)
target_chunks = [c for c in all_chunks if CHUNK_NAME in c.chunk_id]

if not target_chunks:
    print(f"ERROR: Chunk '{CHUNK_NAME}' not found!")
    print(f"Available chunks: {[c.chunk_id for c in all_chunks]}")
    sys.exit(1)

print(f"Found target chunk: {target_chunks[0].chunk_id}")

# Monkey-patch to only process this chunk
p.router.load_chunks = lambda d: target_chunks

result = p.run()
print(f"\nPipeline complete. Total SKUs: {result.total_skus}")

# --- Validation ---
print("\n" + "=" * 60)
print("VALIDATION RESULTS")
print("=" * 60)

sku_dir = settings.factual_dir
mapping_path = settings.meta_dir / "mapping.md"

# Check 1: sku_078 description (or whatever SKU covers 节能降碳技术)
print("\n--- Check 1: Factual SKU descriptions ---")
found_target = False
for d in sorted(sku_dir.iterdir()):
    if not d.is_dir():
        continue
    header_path = d / "header.md"
    if not header_path.exists():
        continue
    content = header_path.read_text(encoding="utf-8")
    # Look for the SKU about 节能降碳技术
    if "节能降碳" in content or "节能" in content:
        print(f"\n{d.name}/header.md:")
        print(content)
        # Check conditions
        desc_match = re.search(r"\|\s*\*\*描述\*\*\s*[:：]?\s*(.+)", content)
        if not desc_match:
            # Try alternate format
            lines = content.strip().split("\n")
            desc = lines[-1] if lines else ""
        else:
            desc = desc_match.group(1)
        
        has_bad_phrase = "综合能源服务常用的" in content
        has_good_keyword = "节能降碳" in content
        
        print(f"  ❌ Contains '综合能源服务常用的': {has_bad_phrase}" if has_bad_phrase else f"  ✅ No '综合能源服务常用的'")
        print(f"  ✅ Contains '节能降碳': {has_good_keyword}" if has_good_keyword else f"  ❌ Missing '节能降碳'")
        found_target = True

if not found_target:
    print("WARNING: No SKU about 节能降碳 found!")

# Check 2: mapping.md entry
print("\n--- Check 2: mapping.md ---")
if mapping_path.exists():
    mapping = mapping_path.read_text(encoding="utf-8")
    # Find entries related to 节能降碳 or 综合能源服务
    for line in mapping.split("\n"):
        if "节能降碳" in line or "综合能源服务" in line or "节能" in line.lower():
            print(f"  {line}")
    
    has_节能_in_mapping = "节能降碳" in mapping
    has_综合能源_in_mapping = "综合能源服务" in mapping
    print(f"\n  Mapping has '节能降碳': {has_节能_in_mapping}")
    print(f"  Mapping has '综合能源服务': {has_综合能源_in_mapping}")
else:
    print("  mapping.md not found!")

# Check 3: Log output
print("\n--- Check 3: Check logs for _validate_mapping_entries warnings ---")
print("  (Look for 'Low overlap mapping entry' in the log output above)")

print("\n=== Validation Complete ===")
