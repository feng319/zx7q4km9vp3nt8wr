"""
One-time validation script: verify all chunk identifiers found in eureka.md
exist in chunk_to_sku.json. Also reports stats on candidate counts per chunk,
keywords coverage, and rank distribution.

Usage:
    python validate_chunk_coverage.py <ontology_dir>

Example:
    python validate_chunk_coverage.py "G:\Program Files\AI coding\知识萃取\战略分析\输出\ontology"
    python validate_chunk_coverage.py "G:\Program Files\AI coding\知识萃取\商业模式资本\输出\ontology"
"""

import json
import re
import sys
from pathlib import Path


def extract_chunks_from_eureka(eureka_path: Path) -> set[str]:
    """Extract all chunk identifiers from eureka.md's square brackets."""
    content = eureka_path.read_text(encoding="utf-8")
    # Match patterns like [xxx_chunk_xxx] or [xxx_chunk_xxx, yyy_chunk_yyy]
    bracket_pattern = re.compile(r"\[([^\]]+)\]")
    chunks: set[str] = set()
    for match in bracket_pattern.finditer(content):
        raw = match.group(1)
        # Split on comma for multi-chunk references
        for part in raw.split(","):
            part = part.strip()
            if "_chunk_" in part:
                chunks.add(part)
    return chunks


def validate_keywords(chunk_map: dict) -> None:
    """Check keywords coverage and quality in chunk_to_sku.json."""
    total_entries = 0
    with_keywords = 0
    empty_keywords = 0
    keyword_samples: list[str] = []

    for chunk_id, entries in chunk_map.items():
        for entry in entries:
            total_entries += 1
            kw = entry.get("keywords", [])
            if kw:
                with_keywords += 1
                if len(keyword_samples) < 5:
                    keyword_samples.append(f"  {entry.get('sku_id','?')}: {kw}")
            else:
                empty_keywords += 1

    print(f"\n=== Keywords Coverage ===")
    print(f"  Total entries: {total_entries}")
    print(f"  With keywords: {with_keywords} ({with_keywords/total_entries*100:.0f}%)" if total_entries else "")
    print(f"  Empty keywords: {empty_keywords}")
    if keyword_samples:
        print(f"  Sample keywords:")
        for s in keyword_samples:
            print(s)


def validate_rank(chunk_map: dict) -> None:
    """Check rank field presence and distribution."""
    has_rank = 0
    no_rank = 0
    rank_distribution: dict[int, int] = {}

    for chunk_id, entries in chunk_map.items():
        for entry in entries:
            rank = entry.get("rank")
            if rank is not None:
                has_rank += 1
                rank_distribution[rank] = rank_distribution.get(rank, 0) + 1
            else:
                no_rank += 1

    print(f"\n=== Rank Field Validation ===")
    print(f"  Entries with rank: {has_rank}")
    print(f"  Entries without rank: {no_rank}")
    if rank_distribution:
        top_ranks = sorted(rank_distribution.items())[:5]
        print(f"  Top rank distribution: {dict(top_ranks)}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python validate_chunk_coverage.py <ontology_dir>")
        sys.exit(1)

    ontology_dir = Path(sys.argv[1])
    eureka_path = ontology_dir / "eureka.md"
    mapping_path = ontology_dir / "chunk_to_sku.json"

    if not eureka_path.exists():
        print(f"ERROR: eureka.md not found at {eureka_path}")
        sys.exit(1)

    if not mapping_path.exists():
        print(f"ERROR: chunk_to_sku.json not found at {mapping_path}")
        sys.exit(1)

    eureka_chunks = extract_chunks_from_eureka(eureka_path)
    chunk_map = json.loads(mapping_path.read_text(encoding="utf-8"))
    mapping_chunks = set(chunk_map.keys())

    print(f"=== Chunk Coverage Validation ===")
    print(f"  eureka.md chunks: {len(eureka_chunks)}")
    print(f"  chunk_to_sku.json keys: {len(mapping_chunks)}")

    # Check coverage
    missing = eureka_chunks - mapping_chunks
    extra = mapping_chunks - eureka_chunks

    if not missing:
        print(f"\n  ✅ ALL eureka chunks are covered in chunk_to_sku.json")
    else:
        print(f"\n  ❌ {len(missing)} chunk(s) in eureka.md but NOT in chunk_to_sku.json:")
        for c in sorted(missing):
            print(f"     - {c}")

    if extra:
        print(f"\n  ℹ️  {len(extra)} chunk(s) in chunk_to_sku.json but NOT referenced in eureka.md:")
        for c in sorted(extra):
            print(f"     - {c}")

    # Stats on candidate counts
    print(f"\n=== Candidate Count Stats ===")
    counts = {k: len(v) for k, v in chunk_map.items() if k in eureka_chunks}
    if counts:
        sorted_counts = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        vals = list(counts.values())
        print(f"  Min candidates per chunk: {min(vals)}")
        print(f"  Max candidates per chunk: {max(vals)}")
        print(f"  Avg candidates per chunk: {sum(vals)/len(vals):.1f}")
        print(f"\n  Top 5 chunks by candidate count:")
        for chunk_id, count in sorted_counts[:5]:
            print(f"     {chunk_id}: {count} SKUs")

    # Report factual vs procedural distribution per chunk
    print(f"\n=== Classification Distribution per Chunk ===")
    for chunk_id in sorted(chunk_map.keys()):
        if chunk_id not in eureka_chunks:
            continue
        entries = chunk_map[chunk_id]
        factual = sum(1 for e in entries if e.get("classification") == "factual")
        procedural = sum(1 for e in entries if e.get("classification") == "procedural")
        relational = sum(1 for e in entries if e.get("classification") == "relational")
        print(f"  {chunk_id}: {len(entries)} total (factual={factual}, procedural={procedural}, relational={relational})")

    # Keywords validation
    validate_keywords(chunk_map)

    # Rank validation
    validate_rank(chunk_map)

    print(f"\nValidation {'PASSED' if not missing else 'FAILED'}")


if __name__ == "__main__":
    main()
