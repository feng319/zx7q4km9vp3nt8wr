"""Main orchestration pipeline for knowledge extraction."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from queue import Queue
from typing import Any

import structlog

from chunks2skus.config import settings
from chunks2skus.router import Router
from chunks2skus.schemas.index import SKUEntry, SKUsIndex
from chunks2skus.schemas.sku import SKUType

logger = structlog.get_logger(__name__)


class ExtractionPipeline:
    """
    Main pipeline for extracting knowledge from chunks.

    Input: Module 2 output (chunks/ directory with chunks_index.json)
    Output: SKUs in output/skus/ with skus_index.json
    """

    def __init__(
        self,
        chunks_dir: Path | None = None,
        output_dir: Path | None = None,
        force_reset: bool = False,
    ):
        """
        Initialize the extraction pipeline.

        Args:
            chunks_dir: Directory with chunks (default: settings.chunks_dir)
            output_dir: Directory for SKU output (default: settings.skus_output_dir)
            force_reset: If True, reset the index and re-process all chunks from scratch
        """
        self.chunks_dir = chunks_dir or settings.chunks_dir
        self.output_dir = output_dir or settings.skus_output_dir
        self.force_reset = force_reset

        self.router = Router(self.output_dir)
        self.index = self._load_or_create_index()
        self._index_lock = threading.Lock()

    def _load_or_create_index(self) -> SKUsIndex:
        """Load existing index or create new one."""
        index_path = self.output_dir / "skus_index.json"
        if not self.force_reset and index_path.exists():
            try:
                data = json.loads(index_path.read_text(encoding="utf-8"))
                return SKUsIndex.model_validate(data)
            except Exception as e:
                logger.warning("Failed to load existing index", error=str(e))
        elif self.force_reset:
            logger.info("Force reset: clearing existing index for full re-extraction")
        return SKUsIndex()

    def run(self) -> SKUsIndex:
        """
        Run the full extraction pipeline.

        Returns:
            SKUsIndex with all SKU information
        """
        start_time = datetime.now()
        logger.info(
            "Starting extraction pipeline",
            chunks_dir=str(self.chunks_dir),
            output_dir=str(self.output_dir),
            force_reset=self.force_reset,
        )

        # Create output directories
        self.output_dir.mkdir(parents=True, exist_ok=True)
        settings.factual_dir.mkdir(parents=True, exist_ok=True)
        settings.relational_dir.mkdir(parents=True, exist_ok=True)
        settings.procedural_dir.mkdir(parents=True, exist_ok=True)
        settings.meta_dir.mkdir(parents=True, exist_ok=True)

        # When force_reset, clear all state files so extractors start fresh
        if self.force_reset:
            self._reset_state_files()

        # Load chunks
        chunks = self.router.load_chunks(self.chunks_dir)
        if not chunks:
            logger.warning("No chunks found to process")
            return self.index

        logger.info("Processing chunks", total=len(chunks))

        # Track all accumulated SKUs
        all_skus: list[dict[str, Any]] = []

        # Track chunks whose content needs to be fed to meta extractor
        pending_meta_content: list[tuple[str, str]] = []  # (chunk_id, content)

        # Track SKUs created in current meta batch (for diff mode efficiency)
        pending_new_skus: list[dict[str, Any]] = []

        # Filter to unprocessed chunks only
        unprocessed = [c for c in chunks if not self.index.is_chunk_processed(c.chunk_id)]

        if not unprocessed:
            logger.info("All chunks already processed")
            return self.index

        # ── Producer-Consumer pattern for chunk parallelism ──
        # Factual + Procedural can run in parallel across chunks
        # Relational must run serially (has mutable internal state)
        relational_queue: Queue[tuple[Any, list[dict[str, Any]]] | None] = Queue()
        meta_executor = ThreadPoolExecutor(max_workers=1)

        # ── Consumer: Relational serial processing ──
        def relational_consumer():
            nonlocal pending_meta_content, pending_new_skus
            while True:
                item = relational_queue.get()
                if item is None:  # Sentinel: all producers done
                    relational_queue.task_done()
                    break

                chunk, factual_procedural_skus = item
                try:
                    # Run Relational extractor serially (state-safe)
                    rel_skus = self.router.relational_extractor.extract(
                        chunk.content, chunk.chunk_id, {}
                    )

                    with self._index_lock:
                        # Accumulate only per-chunk SKUs (factual + procedural).
                        # Relational uses a fixed sku_id updated incrementally;
                        # accumulating snapshots wastes memory and adds noise to meta context.
                        all_skus.extend(factual_procedural_skus)

                        # Add to index
                        for sku in factual_procedural_skus + rel_skus:
                            sku_id = sku.get("sku_id", "")
                            if sku_id in ("relational-knowledge-base", "meta-knowledge"):
                                self.index.remove_sku(sku_id)
                            self._add_sku_to_index(sku)

                        self.index.mark_chunk_processed(chunk.chunk_id)
                        self._save_index()

                    # Meta batch accumulation — only factual + procedural as "new"
                    pending_meta_content.append((chunk.chunk_id, chunk.content))
                    pending_new_skus.extend(factual_procedural_skus)

                    if settings.meta_interval > 0 and len(pending_meta_content) >= settings.meta_interval:
                        # Deep-copy pending data, shallow-copy all_skus (read-only in meta)
                        meta_batch_content = pending_meta_content[:]
                        meta_batch_skus = pending_new_skus[:]
                        meta_all_skus = all_skus[:]
                        meta_executor.submit(
                            self._flush_meta, meta_batch_content, meta_all_skus, meta_batch_skus
                        )
                        pending_meta_content = []
                        pending_new_skus = []

                    logger.info(
                        "Chunk processed",
                        chunk_id=chunk.chunk_id,
                        new_skus=len(factual_procedural_skus) + len(rel_skus),
                        total_skus=self.index.total_skus,
                    )

                except Exception as e:
                    logger.error(
                        "Relational processing failed",
                        chunk_id=chunk.chunk_id,
                        error=str(e),
                    )
                    # Still mark chunk as processed to avoid infinite retry
                    with self._index_lock:
                        all_skus.extend(factual_procedural_skus)
                        for sku in factual_procedural_skus:
                            self._add_sku_to_index(sku)
                        self.index.mark_chunk_processed(chunk.chunk_id)
                        self._save_index()
                finally:
                    relational_queue.task_done()

        # ── Timing instrumentation ──
        fp_submit_time = datetime.now()

        consumer_thread = threading.Thread(target=relational_consumer, daemon=True)
        consumer_thread.start()

        # ── Producer: Factual + Procedural across chunks in parallel ──
        def _on_done(f, c):
            """Callback: put Factual/Procedural results into Relational queue."""
            try:
                result = f.result()
            except Exception as e:
                logger.error(
                    "Factual/Procedural failed",
                    chunk_id=c.chunk_id,
                    error=str(e),
                )
                result = []  # Empty result, consumer will skip Relational for this chunk
            relational_queue.put((c, result))

        max_workers = min(settings.chunk_concurrency, len(unprocessed)) if settings.chunk_concurrency > 0 else len(unprocessed)
        fp_pool = ThreadPoolExecutor(max_workers=max_workers)

        for chunk in unprocessed:
            logger.info(
                "Submitting chunk for Factual/Procedural",
                chunk_id=chunk.chunk_id,
            )
            future = fp_pool.submit(self.router.process_factual_procedural, chunk)
            future.add_done_callback(lambda f, c=chunk: _on_done(f, c))

        # Wait for all Factual/Procedural producers to finish
        fp_pool.shutdown(wait=True)
        fp_done_time = datetime.now()
        fp_duration = (fp_done_time - fp_submit_time).total_seconds()
        logger.info(
            "Factual/Procedural phase complete",
            chunks=len(unprocessed),
            concurrency=max_workers,
            duration_seconds=f"{fp_duration:.1f}",
        )

        # Send sentinel to stop consumer
        relational_queue.put(None)
        consumer_thread.join()
        rel_duration = (datetime.now() - fp_done_time).total_seconds()
        logger.info(
            "Relational consumer phase complete",
            duration_seconds=f"{rel_duration:.1f}",
            note="overlaps with FP phase in pipeline wall-clock",
        )

        # Wait for all in-flight meta tasks to complete before final flush
        meta_executor.shutdown(wait=True)

        # Final meta extraction with all remaining chunks
        if pending_meta_content:
            self._flush_meta(pending_meta_content, all_skus, pending_new_skus)

        duration = (datetime.now() - start_time).total_seconds()
        logger.info(
            "Extraction pipeline complete",
            total_skus=self.index.total_skus,
            total_characters=self.index.total_characters,
            chunks_processed=len(self.index.chunks_processed),
            duration_seconds=f"{duration:.1f}",
        )

        return self.index

    def _flush_meta(
        self,
        pending: list[tuple[str, str]],
        all_skus: list[dict[str, Any]],
        new_skus: list[dict[str, Any]] | None = None,
    ) -> None:
        """
        Run meta extractor on accumulated chunk content.

        Instead of calling meta once per chunk, we concatenate all pending
        chunks into a single LLM call, dramatically reducing the number of
        expensive meta extraction rounds.

        Args:
            pending: List of (chunk_id, content) tuples
            all_skus: All accumulated SKUs for mapping context
            new_skus: Only the SKUs created in this batch (for diff mode).
                      If None, falls back to all_skus.
        """
        if not pending:
            return

        chunk_ids = [cid for cid, _ in pending]
        # Concatenate content with chunk_id headers so the LLM knows sources
        combined = "\n\n".join(
            f"### {cid}\n{content[:6000]}" for cid, content in pending
        )

        logger.info(
            "Running meta extraction batch",
            chunks=len(pending),
            total_content_chars=len(combined),
            new_skus=len(new_skus) if new_skus else len(all_skus),
        )

        try:
            context = {
                "all_skus": all_skus,
                "new_skus": new_skus if new_skus else all_skus,
            }
            meta_skus = self.router.meta_extractor.extract(combined, chunk_ids, context)
            # Add/update meta SKU in index (remove old entry to avoid duplicates)
            with self._index_lock:
                for sku in meta_skus:
                    self.index.remove_sku(sku.get("sku_id", "meta-knowledge"))
                    self._add_sku_to_index(sku)
                self._save_index()
        except Exception as e:
            logger.error("Meta extraction batch failed", error=str(e))

    def _add_sku_to_index(self, sku: dict[str, Any]) -> None:
        """Add an SKU to the index."""
        # Handle classification as string or enum
        classification = sku.get("classification")
        if isinstance(classification, str):
            classification = SKUType(classification)
        elif isinstance(classification, SKUType):
            pass
        else:
            classification = SKUType.FACTUAL

        entry = SKUEntry(
            sku_id=sku.get("sku_id", "unknown"),
            name=sku.get("name", "unknown"),
            classification=classification,
            path=sku.get("path", ""),
            source_chunk=sku.get("source_chunk", ""),
            character_count=sku.get("character_count", 0),
            description=sku.get("description", ""),
        )
        self.index.add_sku(entry)

    def _reset_state_files(self) -> None:
        """Reset all state files and SKU directories for a full re-extraction.

        Deletes the index file, all extractor state files, and all SKU content
        directories so that extractors re-initialize from scratch on next access.
        """
        import shutil

        # Reset index
        index_path = self.output_dir / "skus_index.json"
        if index_path.exists():
            index_path.unlink()
            logger.info("Deleted index file for force reset")

        # Relational extractor state files
        relational_state = [
            settings.relational_dir / "label_tree.json",
            settings.relational_dir / "glossary.json",
            settings.relational_dir / "relationships.json",
        ]
        for f in relational_state:
            if f.exists():
                f.unlink()
                logger.info("Deleted state file for force reset", path=str(f))

        # Meta extractor state files
        meta_state = [
            settings.meta_dir / "mapping.md",
            settings.meta_dir / "eureka.md",
        ]
        for f in meta_state:
            if f.exists():
                f.unlink()
                logger.info("Deleted state file for force reset", path=str(f))

        # Clean old SKU content directories (factual/sku_*, procedural/skill_*)
        for sku_dir in [settings.factual_dir, settings.procedural_dir]:
            if sku_dir.exists():
                for child in list(sku_dir.iterdir()):
                    if child.is_dir():
                        shutil.rmtree(child)
                        logger.info("Deleted SKU directory for force reset", path=str(child))

        # Clean non-state files in relational/ and meta/ (keep header.md)
        for extra_dir in [settings.relational_dir, settings.meta_dir]:
            for child in list(extra_dir.iterdir()):
                if child.is_dir():
                    shutil.rmtree(child)
                    logger.info("Deleted subdirectory for force reset", path=str(child))

        # Reload router extractors so they pick up the missing state files
        self.router = Router(self.output_dir)

    def _save_index(self) -> None:
        """Save index to disk with dedup safety net.

        Although add_sku() already deduplicates by sku_id, this method
        adds a belt-and-suspenders dedup pass before writing to catch
        any duplicates that might slip through (e.g. fix scripts
        bypassing SKUsIndex, or race conditions).
        """
        # Dedup: keep last occurrence of each sku_id (newest wins)
        seen: dict[str, int] = {}
        deduped: list = []
        for entry in self.index.skus:
            if entry.sku_id in seen:
                # Replace previous entry with this newer one
                deduped[seen[entry.sku_id]] = entry
            else:
                seen[entry.sku_id] = len(deduped)
                deduped.append(entry)

        if len(deduped) != len(self.index.skus):
            removed = len(self.index.skus) - len(deduped)
            logger.warning(
                "Dedup removed duplicate entries from index",
                removed=removed,
                before=len(self.index.skus),
                after=len(deduped),
            )
            self.index.skus = deduped
            self.index.total_skus = len(deduped)
            # Recount by type
            self.index.factual_count = sum(1 for s in deduped if s.classification == SKUType.FACTUAL)
            self.index.relational_count = sum(1 for s in deduped if s.classification == SKUType.RELATIONAL)
            self.index.procedural_count = sum(1 for s in deduped if s.classification == SKUType.PROCEDURAL)
            self.index.meta_count = sum(1 for s in deduped if s.classification == SKUType.META)

        # Fix backslash paths (Windows safety net)
        for entry in self.index.skus:
            if "\\" in entry.path:
                entry.path = entry.path.replace("\\", "/")

        index_path = self.output_dir / "skus_index.json"
        index_path.write_text(
            self.index.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def extract_single_chunk(self, chunk_path: Path) -> list[dict[str, Any]]:
        """
        Extract SKUs from a single chunk file.

        Args:
            chunk_path: Path to chunk file

        Returns:
            List of created SKUs
        """
        chunk = self.router.load_single_chunk(chunk_path)
        if not chunk:
            return []

        # Get existing SKUs for context
        existing_skus = [
            {
                "sku_id": s.sku_id,
                "name": s.name,
                "classification": s.classification.value,
                "path": s.path,
                "description": s.description,
            }
            for s in self.index.skus
        ]

        new_skus = self.router.process_chunk(chunk, existing_skus)

        # Add to index
        with self._index_lock:
            for sku in new_skus:
                self._add_sku_to_index(sku)

            self.index.mark_chunk_processed(chunk.chunk_id)
            self._save_index()

        return new_skus

    def show_index_summary(self) -> str:
        """Get a summary of the current index."""
        return self.index.summary()
