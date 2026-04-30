"""Step 1: Assemble ontology by copying and reorganizing SKUs."""

import json
import re
import shutil
from pathlib import Path

import structlog

from skus2ontology.schemas.ontology import OntologyManifest

logger = structlog.get_logger(__name__)

# SKU subdirectories to copy
SKU_SUBDIRS = ["factual", "procedural", "relational"]

# Regex to match any prefix before a known SKU subdirectory
# e.g. "test_data/basel_skus/factual/sku_001" → "skus/factual/sku_001"
# e.g. "output/skus/procedural/skill_003" → "skus/procedural/skill_003"
# e.g. "test_data/basel_skus/meta" → "skus/meta" (no trailing slash)
PATH_REWRITE_PATTERN = re.compile(
    r"(?:^|(?<=[\s(/\"']))[\w./\-]+?(?=(?:factual|procedural|relational|meta)(?:/|$|\s|\"|\)|,))"
)


def _rewrite_path(text: str) -> tuple[str, int]:
    """
    Rewrite SKU paths in text, replacing any prefix before
    factual/procedural/relational/meta/ with 'skus/'.

    Returns:
        Tuple of (rewritten text, number of replacements).
    """
    count = 0

    def replacer(match: re.Match) -> str:
        nonlocal count
        count += 1
        return "skus/"

    result = PATH_REWRITE_PATTERN.sub(replacer, text)
    return result, count


class OntologyAssembler:
    """Copies and reorganizes SKUs into a self-contained ontology."""

    def __init__(self, skus_dir: Path, ontology_dir: Path):
        self.skus_dir = Path(skus_dir).resolve()
        self.ontology_dir = Path(ontology_dir).resolve()

        # Prevent destructive copy: source must not be inside destination
        skus_dest = self.ontology_dir / "skus"
        if self.skus_dir == skus_dest:
            raise ValueError(
                f"skus_dir cannot be the same as ontology_dir/skus (would delete source): "
                f"skus_dir={self.skus_dir}"
            )
        try:
            self.skus_dir.relative_to(self.ontology_dir)
            raise ValueError(
                f"skus_dir must not be inside ontology_dir (would destroy source during copy): "
                f"skus_dir={self.skus_dir}, ontology_dir={self.ontology_dir}"
            )
        except ValueError as e:
            # Re-raise our own ValueError, let other ValueErrors (from relative_to) pass
            if "must not be inside" in str(e):
                raise

    def assemble(self) -> OntologyManifest:
        """
        Run the full assembly process.

        Returns:
            OntologyManifest with counts and status.
        """
        logger.info(
            "Starting ontology assembly",
            skus_dir=str(self.skus_dir),
            ontology_dir=str(self.ontology_dir),
        )

        manifest = OntologyManifest(
            source_skus_dir="output/skus",
            ontology_dir="output/ontology",
        )

        # Validate source
        if not self.skus_dir.exists():
            logger.error("SKUs directory does not exist", path=str(self.skus_dir))
            raise FileNotFoundError(f"SKUs directory not found: {self.skus_dir}")

        mapping_path = self.skus_dir / "meta" / "mapping.md"
        if not mapping_path.exists():
            logger.warning("mapping.md not found in meta/", path=str(mapping_path))

        # Create ontology
        skus_dest = self.ontology_dir / "skus"
        skus_dest.mkdir(parents=True, exist_ok=True)

        total_files = 0

        # 1. Copy SKU subdirectories
        for subdir in SKU_SUBDIRS:
            src = self.skus_dir / subdir
            dst = skus_dest / subdir
            if src.exists():
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
                file_count = sum(1 for _ in dst.rglob("*") if _.is_file())
                total_files += file_count
                logger.info("Copied directory", subdir=subdir, files=file_count)

        # Count SKUs
        factual_dir = skus_dest / "factual"
        procedural_dir = skus_dest / "procedural"
        if factual_dir.exists():
            manifest.factual_count = sum(1 for d in factual_dir.iterdir() if d.is_dir())
        if procedural_dir.exists():
            manifest.procedural_count = sum(1 for d in procedural_dir.iterdir() if d.is_dir())
        manifest.has_relational = (skus_dest / "relational").exists()

        # 2. Copy postprocessing/ if exists
        postproc_src = self.skus_dir / "postprocessing"
        if postproc_src.exists():
            postproc_dst = skus_dest / "postprocessing"
            if postproc_dst.exists():
                shutil.rmtree(postproc_dst)
            shutil.copytree(postproc_src, postproc_dst)
            pp_count = sum(1 for _ in postproc_dst.rglob("*") if _.is_file())
            total_files += pp_count
            logger.info("Copied postprocessing", files=pp_count)

        # 3. Copy skus_index.json → ontology/skus/skus_index.json (with path rewriting)
        index_src = self.skus_dir / "skus_index.json"
        if index_src.exists():
            index_dst = skus_dest / "skus_index.json"
            rewrite_count = self._rewrite_skus_index(index_src, index_dst)
            manifest.paths_rewritten += rewrite_count
            total_files += 1
            logger.info("Copied and rewrote skus_index.json", paths_rewritten=rewrite_count)

            # Generate chunk→sku mapping from skus_index.json
            chunk_map_count = self._generate_chunk_to_sku(index_src, self.ontology_dir / "chunk_to_sku.json")
            if chunk_map_count > 0:
                manifest.has_chunk_mapping = True
                total_files += 1
                logger.info("Generated chunk_to_sku.json", chunk_count=chunk_map_count)

        # 4. Copy eureka.md → ontology/eureka.md (root)
        eureka_src = self.skus_dir / "meta" / "eureka.md"
        if eureka_src.exists():
            eureka_dst = self.ontology_dir / "eureka.md"
            shutil.copy2(eureka_src, eureka_dst)
            manifest.has_eureka = True
            total_files += 1
            logger.info("Copied eureka.md to ontology root")

        # 4.5 Validate chunk coverage (eureka chunks ↔ chunk_to_sku keys)
        if manifest.has_chunk_mapping and manifest.has_eureka:
            manifest.chunk_coverage_ok = self._validate_chunk_coverage(self.ontology_dir)

        # 5. Rewrite mapping.md → ontology/mapping.md (root)
        if mapping_path.exists():
            mapping_dst = self.ontology_dir / "mapping.md"
            content = mapping_path.read_text(encoding="utf-8").replace("\\", "/")
            rewritten, rewrite_count = _rewrite_path(content)
            mapping_dst.write_text(rewritten, encoding="utf-8")
            manifest.has_mapping = True
            manifest.paths_rewritten += rewrite_count
            total_files += 1
            logger.info("Rewrote mapping.md", paths_rewritten=rewrite_count)

        manifest.total_files_copied = total_files

        logger.info(
            "Assembly complete",
            total_files=total_files,
            factual=manifest.factual_count,
            procedural=manifest.procedural_count,
            paths_rewritten=manifest.paths_rewritten,
        )

        return manifest

    def _rewrite_skus_index(self, src: Path, dst: Path) -> int:
        """
        Load skus_index.json, rewrite path fields to relative, save to dst.

        - Absolute paths are stripped to relative (e.g. "factual/sku_001")
        - Relative paths get "skus/" prefix (e.g. "skus/factual/sku_001")

        Returns:
            Number of paths rewritten.
        """
        data = json.loads(src.read_text(encoding="utf-8"))
        count = 0

        for entry in data.get("skus", []):
            old_path = entry.get("path", "")
            if not old_path:
                continue

            # Normalize backslashes (Windows)
            normalized = old_path.replace("\\", "/")

            # If absolute, extract the relative part
            if normalized != old_path or "/" in normalized:
                # Extract the last 2-3 segments (classification/sku_id or classification)
                parts = Path(normalized).parts
                # Find the classification segment
                for i, p in enumerate(parts):
                    if p in ("factual", "procedural", "relational", "meta"):
                        relative = "/".join(parts[i:])
                        entry["path"] = f"skus/{relative}"
                        count += 1
                        break
                else:
                    # Already relative, just add prefix
                    entry["path"] = f"skus/{normalized}"
                    count += 1

        dst.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        return count

    def _extract_keywords(self, name: str, description: str, max_keywords: int = 5) -> list[str]:
        """
        Extract keywords from SKU name and description for semantic filtering.

        Strategy:
        - Chinese: split on punctuation and keep segments of 2-6 chars
        - English: split on spaces/underscores, keep lowercase words of 3+ chars
        - Deduplicate and return top N unique keywords
        """
        # Combine and clean
        combined = f"{name} {description}"
        keywords: list[str] = []
        seen: set[str] = set()

        # Chinese segments: split on common delimiters
        for seg in re.split(r"[,，。、：:；;（）()【】\[\]\s\-—_/]+", combined):
            seg = seg.strip()
            if not seg:
                continue
            # Chinese segment: keep if 2-8 chars (meaningful phrases)
            if re.search(r"[\u4e00-\u9fff]", seg):
                # For long Chinese segments, try to extract 2-4 char sub-phrases
                if len(seg) <= 8:
                    if seg not in seen:
                        seen.add(seg)
                        keywords.append(seg)
                else:
                    # Sliding window for 4-char phrases from long segments
                    cn_chars = re.findall(r"[\u4e00-\u9fff]+", seg)
                    for phrase in cn_chars:
                        if len(phrase) >= 2 and phrase not in seen:
                            seen.add(phrase)
                            keywords.append(phrase)
            else:
                # English: split on underscores and spaces
                for word in re.split(r"[_\s]+", seg):
                    word = word.strip().lower()
                    if len(word) >= 3 and word not in seen:
                        seen.add(word)
                        keywords.append(word)

        return keywords[:max_keywords]

    def _generate_chunk_to_sku(self, index_src: Path, dst: Path) -> int:
        """
        Build a chunk→sku mapping from skus_index.json and save it.

        Maps each source_chunk value to a sorted list of SKU entries.
        Each entry includes sku_id, classification, path, name, description,
        keywords, and rank (1-based position after sorting).
        Entries are sorted: factual first, then procedural, then relational;
        within same classification, by sku_id number (lower = more core).

        The keywords field enables Agent to do semantic filtering when a chunk
        maps to many SKUs. The rank field tells Agent which entries to read first.

        Returns:
            Number of unique chunk keys in the mapping.
        """
        CLASSIFICATION_ORDER = {"factual": 0, "procedural": 1, "relational": 2}

        def _sku_sort_key(entry: dict) -> tuple:
            """Sort key: classification priority, then numeric sku_id."""
            cls_pri = CLASSIFICATION_ORDER.get(entry.get("classification", ""), 9)
            # Extract numeric part from sku_id (e.g. "sku_018" → 18, "skill_003" → 3)
            sku_id = entry.get("sku_id", "")
            num_match = re.search(r"\d+", sku_id)
            num = int(num_match.group()) if num_match else 999
            return (cls_pri, num)

        data = json.loads(index_src.read_text(encoding="utf-8"))
        chunk_map: dict[str, list[dict]] = {}

        for entry in data.get("skus", []):
            source_chunk = entry.get("source_chunk", "")
            if not source_chunk:
                continue
            if source_chunk not in chunk_map:
                chunk_map[source_chunk] = []
            name = entry.get("name", "")
            desc = entry.get("description", "")
            chunk_map[source_chunk].append({
                "sku_id": entry.get("sku_id", ""),
                "classification": entry.get("classification", ""),
                "path": entry.get("path", ""),
                "name": name,
                "description": desc,
                "keywords": self._extract_keywords(name, desc),
            })

        # Sort each chunk's SKU list by relevance, then assign rank
        for chunk_id in chunk_map:
            chunk_map[chunk_id].sort(key=_sku_sort_key)
            for rank, entry in enumerate(chunk_map[chunk_id], start=1):
                entry["rank"] = rank

        if chunk_map:
            dst.write_text(
                json.dumps(chunk_map, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

        return len(chunk_map)

    def _validate_chunk_coverage(self, ontology_dir: Path) -> bool:
        """
        Validate that all chunk identifiers in eureka.md exist in chunk_to_sku.json.

        Returns:
            True if all eureka chunks are covered, False otherwise.
        """
        eureka_path = ontology_dir / "eureka.md"
        mapping_path = ontology_dir / "chunk_to_sku.json"

        if not eureka_path.exists() or not mapping_path.exists():
            logger.warning(
                "Cannot validate chunk coverage: missing eureka.md or chunk_to_sku.json"
            )
            return False

        eureka_chunks = self._extract_chunks_from_eureka(eureka_path)
        chunk_map = json.loads(mapping_path.read_text(encoding="utf-8"))
        mapping_chunks = set(chunk_map.keys())

        missing = eureka_chunks - mapping_chunks
        if missing:
            logger.error(
                "Chunk coverage validation FAILED: eureka.md has chunks not in chunk_to_sku.json",
                missing_count=len(missing),
                missing=sorted(missing),
            )
            return False

        logger.info(
            "Chunk coverage validation passed",
            eureka_chunks=len(eureka_chunks),
            mapping_chunks=len(mapping_chunks),
            extra_chunks=len(mapping_chunks - eureka_chunks),
        )
        return True

    @staticmethod
    def _extract_chunks_from_eureka(eureka_path: Path) -> set[str]:
        """Extract all chunk identifiers from eureka.md's square brackets."""
        content = eureka_path.read_text(encoding="utf-8")
        bracket_pattern = re.compile(r"\[([^\]]+)\]")
        chunks: set[str] = set()
        for match in bracket_pattern.finditer(content):
            raw = match.group(1)
            for part in raw.split(","):
                part = part.strip()
                if "_chunk_" in part:
                    chunks.add(part)
        return chunks
