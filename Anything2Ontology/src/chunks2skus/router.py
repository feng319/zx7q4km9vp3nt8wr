"""Router for loading chunks and routing to extractors."""

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import structlog

from chunks2skus.config import settings
from chunks2skus.extractors import (
    FactualExtractor,
    MetaExtractor,
    ProceduralExtractor,
    RelationalExtractor,
)
from chunks2skus.extractors.base import BaseExtractor

logger = structlog.get_logger(__name__)


class ChunkInfo:
    """Information about a chunk to be processed."""

    def __init__(
        self,
        chunk_id: str,
        file_path: Path,
        title: str,
        estimated_tokens: int,
        source_file: str,
    ):
        self.chunk_id = chunk_id
        self.file_path = file_path
        self.title = title
        self.estimated_tokens = estimated_tokens
        self.source_file = source_file
        self._content: str | None = None

    @property
    def content(self) -> str:
        """Lazy load chunk content."""
        if self._content is None:
            self._content = self.file_path.read_text(encoding="utf-8")
            # Remove YAML frontmatter if present
            if self._content.startswith("---"):
                parts = self._content.split("---", 2)
                if len(parts) >= 3:
                    self._content = parts[2].strip()
        return self._content


class Router:
    """
    Routes chunks to extractors with parallel execution.

    Processing order: Factual + Relational + Procedural (parallel) -> Meta (sequential)
    - Factual & Procedural: Isolated processing (no dependencies)
    - Relational: Self-contained state (reads own files, not dependent on Factual output)
    - Meta: Depends on all_skus from other extractors
    """

    def __init__(self, output_dir: Path | None = None):
        """
        Initialize router with extractors.

        Args:
            output_dir: Output directory for SKUs (default: settings.skus_output_dir)
        """
        self.output_dir = output_dir or settings.skus_output_dir

        # Initialize extractors
        self.factual_extractor = FactualExtractor(self.output_dir)
        self.relational_extractor = RelationalExtractor(self.output_dir)
        self.procedural_extractor = ProceduralExtractor(self.output_dir)
        self.meta_extractor = MetaExtractor(self.output_dir)

        # Parallel extractors (independent — can run concurrently)
        self.parallel_extractors: list[BaseExtractor] = [
            self.factual_extractor,
            self.relational_extractor,
            self.procedural_extractor,
        ]

        # Sequential extractors (depend on results from parallel phase)
        self.sequential_extractors: list[BaseExtractor] = [
            self.meta_extractor,
        ]

    def load_chunks(self, chunks_dir: Path | None = None) -> list[ChunkInfo]:
        """
        Load chunk information from chunks_index.json.

        Args:
            chunks_dir: Directory containing chunks (default: settings.chunks_dir)

        Returns:
            List of ChunkInfo objects sorted by chunk_id
        """
        chunks_dir = chunks_dir or settings.chunks_dir
        index_path = chunks_dir / "chunks_index.json"

        if not index_path.exists():
            logger.error("chunks_index.json not found", path=str(index_path))
            return []

        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
            chunks = []

            for entry in data.get("chunks", []):
                raw_path = Path(entry["file_path"])
                # If relative, resolve against chunks_dir
                if not raw_path.is_absolute():
                    resolved_path = chunks_dir / raw_path
                else:
                    resolved_path = raw_path
                chunk_info = ChunkInfo(
                    chunk_id=entry["chunk_id"],
                    file_path=resolved_path,
                    title=entry.get("title", ""),
                    estimated_tokens=entry.get("estimated_tokens", 0),
                    source_file=entry.get("source_file", ""),
                )
                chunks.append(chunk_info)

            # Sort by chunk_id to process in order
            chunks.sort(key=lambda c: c.chunk_id)

            logger.info("Loaded chunks", count=len(chunks))
            return chunks

        except Exception as e:
            logger.error("Failed to load chunks index", error=str(e))
            return []

    def process_chunk_parallel(
        self,
        chunk: ChunkInfo,
        accumulated_skus: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Process a single chunk through parallel extractors ONLY (skip meta).

        Meta extraction is deferred to a batch call at the end of the pipeline,
        which is much faster than running it per-chunk.

        Args:
            chunk: Chunk to process
            accumulated_skus: All SKUs created so far

        Returns:
            List of new SKUs created from this chunk
        """
        logger.info(
            "Processing chunk",
            chunk_id=chunk.chunk_id,
            title=chunk.title,
            tokens=chunk.estimated_tokens,
        )

        content = chunk.content
        chunk_id = chunk.chunk_id
        new_skus: list[dict[str, Any]] = []
        context: dict[str, Any] = {}

        # Run parallel extractors (factual + relational + procedural)
        phase1_results: dict[str, list[dict[str, Any]]] = {}
        phase1_contexts: dict[str, dict[str, Any]] = {}

        def _run_extractor(ext: BaseExtractor) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
            try:
                skus = ext.extract(content, chunk_id, {})
                ctx = ext.get_context_for_next()
                return ext.extractor_name, skus, ctx
            except Exception as e:
                logger.error(
                    "Extractor failed",
                    extractor=ext.extractor_name,
                    chunk_id=chunk_id,
                    error=str(e),
                )
                return ext.extractor_name, [], {}

        if len(self.parallel_extractors) > 1:
            with ThreadPoolExecutor(max_workers=len(self.parallel_extractors)) as executor:
                futures = {
                    executor.submit(_run_extractor, ext): ext.extractor_name
                    for ext in self.parallel_extractors
                }
                for future in as_completed(futures):
                    name, skus, ctx = future.result()
                    phase1_results[name] = skus
                    phase1_contexts[name] = ctx
        else:
            for ext in self.parallel_extractors:
                name, skus, ctx = _run_extractor(ext)
                phase1_results[name] = skus
                phase1_contexts[name] = ctx

        # Merge results
        for ext in self.parallel_extractors:
            if ext.extractor_name in phase1_results:
                new_skus.extend(phase1_results[ext.extractor_name])
            if ext.extractor_name in phase1_contexts:
                context.update(phase1_contexts[ext.extractor_name])

        return new_skus

    def process_chunk(
        self,
        chunk: ChunkInfo,
        accumulated_skus: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Process a single chunk through all extractors with parallel execution.

        Phase 1 (parallel): Factual + Relational + Procedural
        Phase 2 (sequential): Meta (needs all_skus from Phase 1)

        Args:
            chunk: Chunk to process
            accumulated_skus: All SKUs created so far (for meta extractor)

        Returns:
            List of new SKUs created from this chunk
        """
        logger.info(
            "Processing chunk",
            chunk_id=chunk.chunk_id,
            title=chunk.title,
            tokens=chunk.estimated_tokens,
        )

        content = chunk.content
        chunk_id = chunk.chunk_id
        new_skus: list[dict[str, Any]] = []
        context: dict[str, Any] = {}

        # ====== Phase 1: Run independent extractors in PARALLEL ======
        phase1_results: dict[str, list[dict[str, Any]]] = {}
        phase1_contexts: dict[str, dict[str, Any]] = {}

        def _run_extractor(ext: BaseExtractor) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
            """Run a single extractor and return (name, skus, context)."""
            try:
                skus = ext.extract(content, chunk_id, {})
                ctx = ext.get_context_for_next()
                return ext.extractor_name, skus, ctx
            except Exception as e:
                logger.error(
                    "Extractor failed",
                    extractor=ext.extractor_name,
                    chunk_id=chunk_id,
                    error=str(e),
                )
                return ext.extractor_name, [], {}

        if len(self.parallel_extractors) > 1:
            # Run parallel extractors concurrently
            with ThreadPoolExecutor(max_workers=len(self.parallel_extractors)) as executor:
                futures = {
                    executor.submit(_run_extractor, ext): ext.extractor_name
                    for ext in self.parallel_extractors
                }
                for future in as_completed(futures):
                    name, skus, ctx = future.result()
                    phase1_results[name] = skus
                    phase1_contexts[name] = ctx
                    logger.debug(
                        "Parallel extractor completed",
                        extractor=name,
                        skus=len(skus),
                        chunk_id=chunk_id,
                    )
        else:
            # Fallback: run sequentially if only 1 parallel extractor
            for ext in self.parallel_extractors:
                name, skus, ctx = _run_extractor(ext)
                phase1_results[name] = skus
                phase1_contexts[name] = ctx

        # Merge Phase 1 results in deterministic order
        for ext in self.parallel_extractors:
            if ext.extractor_name in phase1_results:
                new_skus.extend(phase1_results[ext.extractor_name])
            if ext.extractor_name in phase1_contexts:
                context.update(phase1_contexts[ext.extractor_name])

        # ====== Phase 2: Run dependent extractors SEQUENTIALLY ======
        for extractor in self.sequential_extractors:
            try:
                extractor_context = context.copy()

                # Meta extractor needs all SKUs
                if extractor.extractor_name == "meta":
                    extractor_context["all_skus"] = accumulated_skus + new_skus

                skus = extractor.extract(content, chunk_id, extractor_context)
                new_skus.extend(skus)

                next_context = extractor.get_context_for_next()
                context.update(next_context)

            except Exception as e:
                logger.error(
                    "Extractor failed",
                    extractor=extractor.extractor_name,
                    chunk_id=chunk_id,
                    error=str(e),
                )

        return new_skus

    def process_factual_procedural(
        self,
        chunk: ChunkInfo,
    ) -> list[dict[str, Any]]:
        """
        Process a single chunk through Factual + Procedural extractors ONLY.

        Relational is excluded because it has internal mutable state
        (label_tree, glossary, relationships) that must be consumed serially.

        This method is designed to be called in parallel across chunks,
        while Relational runs as a serial consumer afterward.

        Args:
            chunk: Chunk to process

        Returns:
            List of new SKUs created from Factual + Procedural extraction
        """
        content = chunk.content
        chunk_id = chunk.chunk_id
        new_skus: list[dict[str, Any]] = []

        for ext in [self.factual_extractor, self.procedural_extractor]:
            try:
                skus = ext.extract(content, chunk_id, {})
                new_skus.extend(skus)
            except Exception as e:
                logger.error(
                    "Extractor failed",
                    extractor=ext.extractor_name,
                    chunk_id=chunk_id,
                    error=str(e),
                )

        return new_skus

    def load_single_chunk(self, chunk_path: Path) -> ChunkInfo | None:
        """
        Load a single chunk file.

        Args:
            chunk_path: Path to chunk file

        Returns:
            ChunkInfo or None if failed
        """
        if not chunk_path.exists():
            logger.error("Chunk file not found", path=str(chunk_path))
            return None

        return ChunkInfo(
            chunk_id=chunk_path.stem,
            file_path=chunk_path,
            title=chunk_path.stem,
            estimated_tokens=0,
            source_file=chunk_path.name,
        )
