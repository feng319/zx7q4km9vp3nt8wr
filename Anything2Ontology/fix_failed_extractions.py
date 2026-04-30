"""
Fix failed factual, relational and meta extractions caused by 429/JSON-parse errors.

Identifies chunks whose extraction failed and re-runs them.

Usage:
    cd /path/to/Anything2Ontology
    uv run python fix_failed_extractions.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from chunks2skus.config import settings
from chunks2skus.extractors.factual_extractor import FactualExtractor
from chunks2skus.extractors.relational_extractor import RelationalExtractor
from chunks2skus.extractors.meta_extractor import MetaExtractor

import structlog
structlog.configure(processors=[structlog.dev.ConsoleRenderer()])


logger = structlog.get_logger(__name__)

# Chunks whose factual extraction failed (JSON parse error)
FAILED_FACTUAL_CHUNKS = [
    "新资本商业模式与盈利模式_chunk_001",
]

# Chunks whose relational extraction failed (from log analysis)
FAILED_RELATIONAL_CHUNKS = [
    "闭门私董会_chunk_001",
    "清源创业_chunk_001",
    "清源创业_chunk_002",
]

# Chunks whose meta (mapping+eureka) extraction failed
FAILED_META_EUREKA_BATCHES = [
    # Batch 1: the meta batch that failed at 12:29:35
    [
        "新资本商业模式与盈利模式_chunk_047",
        "连锁企业的商业模式和股权模式_chunk_001",
        "清源创业_chunk_003",
        "闭门私董会_chunk_001",
        "清源创业_chunk_001",
    ],
    # Batch 2: 清源创业_chunk_002 (failed at 12:30:56)
    [
        "清源创业_chunk_002",
    ],
]


def load_chunk_content(chunk_id: str) -> tuple[str, str] | None:
    """Load chunk content from chunks directory."""
    chunks_dir = settings.chunks_dir
    for ext in [".md", ".txt"]:
        chunk_file = chunks_dir / f"{chunk_id}{ext}"
        if chunk_file.exists():
            content = chunk_file.read_text(encoding="utf-8")
            return (chunk_id, content)
    logger.warning("Chunk file not found", chunk_id=chunk_id)
    return None


def fix_factual():
    """Re-run factual extraction for chunks where it failed (JSON parse error)."""
    print("\n" + "=" * 60)
    print("STEP 0: Fixing Factual Extraction")
    print("=" * 60)

    extractor = FactualExtractor(settings.skus_output_dir)

    # Load index to check/update
    index_path = settings.skus_output_dir / "skus_index.json"
    idx = json.loads(index_path.read_text(encoding="utf-8"))

    fixed_count = 0
    for chunk_id in FAILED_FACTUAL_CHUNKS:
        print(f"\n  Processing: {chunk_id}")
        result = load_chunk_content(chunk_id)
        if result is None:
            print(f"    SKIP: chunk file not found")
            continue

        cid, content = result

        # Check if this chunk already has factual SKUs
        existing_factual = [s for s in idx["skus"]
                           if s["source_chunk"] == cid and s["classification"] == "factual"]
        print(f"    Existing factual SKUs: {len(existing_factual)}")

        try:
            skus = extractor.extract(content, cid, context=None)
            if skus:
                fixed_count += 1
                print(f"    OK: extracted {len(skus)} factual SKUs")
                # Add new SKUs to index with dedup (replace by sku_id)
                existing_ids = {s["sku_id"] for s in idx["skus"]}
                for sku in skus:
                    if sku.get("sku_id") in existing_ids:
                        idx["skus"] = [s for s in idx["skus"] if s.get("sku_id") != sku.get("sku_id")]
                    idx["skus"].append(sku)
                # Update counters
                idx["factual_count"] = sum(1 for s in idx["skus"] if s["classification"] == "factual")
                idx["total_skus"] = len(idx["skus"])
            else:
                print(f"    WARN: extraction returned empty")
        except Exception as e:
            print(f"    ERROR: {e}")

    # Save updated index
    index_path.write_text(
        json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  Fixed: {fixed_count}/{len(FAILED_FACTUAL_CHUNKS)}")
    print(f"  Index saved.")


def fix_relational():
    """Re-run relational extraction for failed chunks (incremental, safe)."""
    print("\n" + "=" * 60)
    print("STEP 1: Fixing Relational Extraction")
    print("=" * 60)

    extractor = RelationalExtractor(settings.skus_output_dir)

    print(f"  Before fix:")
    print(f"    Glossary entries:  {len(extractor.glossary.entries)}")
    print(f"    Relationships:     {len(extractor.relationships.entries)}")
    label_count = sum(1 for _ in extractor._walk_tree(extractor.label_tree.roots))
    print(f"    Label nodes:       {label_count}")

    fixed_count = 0
    for chunk_id in FAILED_RELATIONAL_CHUNKS:
        print(f"\n  Processing: {chunk_id}")
        result = load_chunk_content(chunk_id)
        if result is None:
            print(f"    SKIP: chunk file not found")
            continue

        cid, content = result
        skus = extractor.extract(content, cid, context=None)
        if skus:
            fixed_count += 1
            print(f"    OK: relational knowledge extracted")
        else:
            print(f"    WARN: extraction returned empty (may have no new relational knowledge)")

    extractor._save_data()

    print(f"\n  After fix:")
    print(f"    Glossary entries:  {len(extractor.glossary.entries)}")
    print(f"    Relationships:     {len(extractor.relationships.entries)}")
    label_count = sum(1 for _ in extractor._walk_tree(extractor.label_tree.roots))
    print(f"    Label nodes:       {label_count}")
    print(f"  Fixed: {fixed_count}/{len(FAILED_RELATIONAL_CHUNKS)}")


def fix_meta():
    """Re-run meta extraction for failed batches."""
    print("\n" + "=" * 60)
    print("STEP 2: Fixing Meta Extraction (mapping + eureka)")
    print("=" * 60)

    extractor = MetaExtractor(settings.skus_output_dir)

    # Load all SKUs from index for context
    index_path = settings.skus_output_dir / "skus_index.json"
    idx = json.loads(index_path.read_text(encoding="utf-8"))
    all_skus = idx.get("skus", [])

    print(f"  Before fix:")
    print(f"    mapping.md: {len(extractor.mapping_path.read_text(encoding='utf-8'))} chars")
    print(f"    eureka.md:  {len(extractor.eureka_path.read_text(encoding='utf-8'))} chars")

    for batch_idx, chunk_ids in enumerate(FAILED_META_EUREKA_BATCHES):
        print(f"\n  Batch {batch_idx + 1}: {chunk_ids}")

        # Load chunk contents
        pending = []
        for cid in chunk_ids:
            result = load_chunk_content(cid)
            if result:
                pending.append(result)

        if not pending:
            print(f"    SKIP: no chunk content found")
            continue

        # Get SKUs for these chunks
        batch_skus = [s for s in all_skus if s.get("source_chunk") in chunk_ids]
        print(f"    Chunks: {len(pending)}, SKUs: {len(batch_skus)}")

        # Prepare content (same format as pipeline._flush_meta)
        chunk_id_list = [cid for cid, _ in pending]
        combined = "\n\n".join(
            f"### {cid}\n{content[:6000]}" for cid, content in pending
        )

        context = {
            "all_skus": all_skus,
            "new_skus": batch_skus,
        }

        try:
            meta_skus = extractor.extract(combined, chunk_id_list, context)
            if meta_skus:
                print(f"    OK: meta extraction succeeded")
                # Update index meta entry
                for sku in meta_skus:
                    sku_id = sku.get("sku_id", "meta-knowledge")
                    # Remove old meta entry
                    idx["skus"] = [s for s in idx["skus"] if s.get("sku_id") != sku_id]
                    idx["skus"].append(sku)
            else:
                print(f"    WARN: meta extraction returned empty")
        except Exception as e:
            print(f"    ERROR: {e}")

    # Save updated index
    index_path.write_text(
        json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n  After fix:")
    print(f"    mapping.md: {len(extractor.mapping_path.read_text(encoding='utf-8'))} chars")
    print(f"    eureka.md:  {len(extractor.eureka_path.read_text(encoding='utf-8'))} chars")
    print(f"  Index saved.")


def main():
    print("Fix Failed Extractions Tool")
    print(f"  Chunks dir: {settings.chunks_dir}")
    print(f"  SKUs dir:   {settings.skus_output_dir}")
    print(f"  API key:    {settings.siliconflow_api_key[:20]}...")

    # Verify chunk files exist
    all_target_chunks = FAILED_FACTUAL_CHUNKS + FAILED_RELATIONAL_CHUNKS
    print(f"\n  Verifying chunk files...")
    all_ok = True
    for chunk_id in all_target_chunks:
        found = (settings.chunks_dir / f"{chunk_id}.md").exists()
        print(f"    {chunk_id}: {'OK' if found else 'MISSING'}")
        if not found:
            all_ok = False

    if not all_ok:
        print("\n  ERROR: Some chunk files are missing. Check .env settings.")
        sys.exit(1)

    fix_factual()
    fix_relational()
    fix_meta()

    print("\n" + "=" * 60)
    print("DONE! Failed extractions have been re-attempted.")
    print("You can now run the downstream skus2ontology pipeline.")
    print("=" * 60)


if __name__ == "__main__":
    main()
