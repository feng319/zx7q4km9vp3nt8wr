"""Main pipeline orchestration for Anything2Markdown."""

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import Lock

import structlog

from .config import settings
from .router import Router
from .schemas.result import ParseResult
from .utils.file_utils import ensure_directory, read_url_list, walk_directory

logger = structlog.get_logger(__name__)


class Anything2MarkdownPipeline:
    """
    Main pipeline orchestrating the parsing of files and URLs.
    Supports parallel processing with adaptive concurrency.
    """

    def __init__(self, no_cache: bool = False):
        """Initialize the pipeline."""
        self.router = Router()
        self.results: list[ParseResult] = []
        self._results_lock = Lock()
        self._no_cache = no_cache

        # Ensure output directory exists
        ensure_directory(settings.output_dir)

    def _get_max_workers(self, task_type: str) -> int:
        """
        Get max_workers for a given task type.

        If settings.max_workers > 0, use that (explicit override).
        Otherwise use the type-specific default.

        Args:
            task_type: One of 'api', 'cpu', 'video', 'mixed'
        """
        if settings.max_workers > 0:
            return settings.max_workers

        mapping = {
            "api": settings.max_workers_api,
            "cpu": settings.max_workers_cpu,
            "video": settings.max_workers_video,
            "mixed": min(settings.max_workers_api, 6),
        }
        return mapping.get(task_type, settings.max_workers_api)

    def run(self) -> list[ParseResult]:
        """
        Execute the full pipeline.

        Processes:
        1. All files in input directory (recursively) — in parallel
        2. All URLs from urls.txt — in parallel

        Returns:
            List of ParseResult for all processed items
        """
        logger.info(
            "Starting Anything2Markdown pipeline",
            input_dir=str(settings.input_dir),
            output_dir=str(settings.output_dir),
        )

        start_time = datetime.now()
        self.results = []

        # Process files in input directory
        file_paths = list(walk_directory(settings.input_dir))
        file_count = self._process_files_parallel(file_paths)

        logger.info("File processing complete", files_processed=file_count)

        # Process URLs from urls.txt
        url_file = settings.input_dir / "urls.txt"
        url_count = 0
        if url_file.exists():
            urls = read_url_list(url_file)
            url_count = self._process_urls_parallel(urls)

        logger.info("URL processing complete", urls_processed=url_count)

        # Log summary
        duration = (datetime.now() - start_time).total_seconds()
        self._log_summary(duration)

        # Persist parse results index for downstream provenance
        self._save_results_index(duration)

        return self.results

    # ------------------------------------------------------------------
    # Parallel processing
    # ------------------------------------------------------------------

    def _process_files_parallel(self, file_paths: list[Path]) -> int:
        """
        Process files with ThreadPoolExecutor.

        Classifies each file by parser type and uses appropriate concurrency.
        """
        if not file_paths:
            return 0

        # Classify files by parser type for optimal concurrency
        api_files: list[Path] = []  # PDF → PaddleOCR fallback path
        cpu_files: list[Path] = []  # DOCX/PPTX/etc → MarkItDown CPU path
        other_files: list[Path] = []  # CSV/XLSX → tabular

        for fp in file_paths:
            ext = fp.suffix.lower()
            if ext == ".pdf":
                # PDFs may fallback to OCR (API), so use api pool
                api_files.append(fp)
            elif ext in (".xlsx", ".xls", ".csv"):
                other_files.append(fp)
            else:
                cpu_files.append(fp)

        # Process each group with appropriate concurrency
        total = 0
        total += self._run_parallel(
            api_files, self._process_file_with_retry, "api"
        )
        total += self._run_parallel(
            cpu_files, self._process_file_with_retry, "cpu"
        )
        total += self._run_parallel(
            other_files, self._process_file_with_retry, "cpu"
        )
        return total

    def _process_urls_parallel(self, urls: list[str]) -> int:
        """
        Process URLs with ThreadPoolExecutor.

        Video URLs use lower concurrency (memory-heavy WhisperX).
        Web URLs use API concurrency.
        """
        if not urls:
            return 0

        video_urls: list[str] = []
        web_urls: list[str] = []

        for url in urls:
            url_lower = url.lower()
            if any(p in url_lower for p in ["youtube.com", "youtu.be", "bilibili.com", "b23.tv"]):
                video_urls.append(url)
            else:
                web_urls.append(url)

        total = 0
        total += self._run_parallel(
            video_urls, self._process_url_with_retry, "video"
        )
        total += self._run_parallel(
            web_urls, self._process_url_with_retry, "api"
        )
        return total

    def _run_parallel(
        self,
        items: list,
        process_fn,
        task_type: str,
    ) -> int:
        """
        Run items through process_fn using ThreadPoolExecutor.

        Args:
            items: List of items (Path or str) to process
            process_fn: Callable that takes one item and returns ParseResult
            task_type: Concurrency category ('api', 'cpu', 'video')

        Returns:
            Number of items processed
        """
        if not items:
            return 0

        max_workers = self._get_max_workers(task_type)
        logger.info(
            "Processing items in parallel",
            count=len(items),
            task_type=task_type,
            max_workers=max_workers,
        )

        count = 0
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_item = {
                executor.submit(process_fn, item): item for item in items
            }
            for future in as_completed(future_to_item):
                item = future_to_item[future]
                try:
                    result = future.result()
                except Exception as exc:
                    logger.error(
                        "Parallel task failed",
                        item=str(item),
                        error=str(exc),
                    )
                    result = ParseResult(
                        source_path=Path(str(item)),
                        output_path=Path(""),
                        source_type="file" if isinstance(item, Path) else "url",
                        parser_used="none",
                        status="failed",
                        started_at=datetime.now(),
                        completed_at=datetime.now(),
                        duration_seconds=0,
                        output_format="markdown",
                        error_message=str(exc),
                    )
                with self._results_lock:
                    self.results.append(result)
                count += 1

        return count

    # ------------------------------------------------------------------
    # Single-item processing (called by parallel executor)
    # ------------------------------------------------------------------

    def _process_file_with_retry(self, file_path: Path) -> ParseResult:
        """
        Process a single file with retry logic.

        Wraps _process_file with retry decorator behavior.
        """
        try:
            return self._process_file_impl(file_path)
        except Exception as e:
            # Retry once
            logger.warning("First attempt failed, retrying", file=file_path.name, error=str(e))
            try:
                return self._process_file_impl(file_path)
            except Exception as retry_error:
                logger.error(
                    "All attempts failed",
                    file=file_path.name,
                    error=str(retry_error),
                )
                return ParseResult(
                    source_path=file_path,
                    output_path=Path(""),
                    source_type="file",
                    parser_used="none",
                    status="failed",
                    started_at=datetime.now(),
                    completed_at=datetime.now(),
                    duration_seconds=0,
                    output_format="markdown",
                    error_message=str(retry_error),
                    retry_count=1,
                )

    def _process_file_impl(self, file_path: Path) -> ParseResult:
        """
        Process a single file.

        Handles:
        1. Skip if output already exists (resume support)
        2. Route to appropriate parser
        3. Parse file
        4. Check for OCR fallback (PDFs with low quality)

        Args:
            file_path: Path to the file

        Returns:
            ParseResult from parsing
        """
        logger.info("Processing file", file=file_path.name)

        try:
            # Route to appropriate parser
            parser = self.router.route_file(file_path)

            # Skip if non-empty output already exists (resume after interruption)
            from .utils.file_utils import flatten_path
            flat_stem = flatten_path(file_path, settings.input_dir)
            expected_output = settings.output_dir / (flat_stem + ".md")
            if not expected_output.exists():
                expected_output = settings.output_dir / (flat_stem + ".json")
            if expected_output.exists() and expected_output.stat().st_size > 0:
                logger.info("Skipping already-processed file", file=file_path.name, output=expected_output.name)
                content = expected_output.read_text(encoding="utf-8")
                return ParseResult(
                    source_path=file_path,
                    output_path=expected_output,
                    source_type="file",
                    parser_used=parser.parser_name,
                    status="success",
                    started_at=datetime.now(),
                    completed_at=datetime.now(),
                    duration_seconds=0,
                    output_format="markdown",
                    character_count=len(content),
                    metadata={"resumed": True},
                )

            # Parse the file
            result = parser.parse(file_path, settings.output_dir)

            # Check for OCR fallback (only for PDFs parsed by MarkItDown)
            if (
                file_path.suffix.lower() == ".pdf"
                and result.status == "success"
                and parser.parser_name == "markitdown"
                and result.output_path.exists()
            ):
                # Read output and check quality
                output_content = result.output_path.read_text(encoding="utf-8")

                # Empty output → immediate fallback
                if not output_content.strip():
                    logger.info("Empty output, falling back to PaddleOCR-VL", file=file_path.name)
                    result.output_path.unlink(missing_ok=True)
                    ocr_parser = self.router.get_ocr_fallback_parser()
                    result = ocr_parser.parse(file_path, settings.output_dir)
                elif self.router.should_fallback_to_ocr(output_content, file_path):
                    logger.info("Falling back to PaddleOCR-VL", file=file_path.name)

                    # Remove low-quality output
                    result.output_path.unlink(missing_ok=True)

                    # Re-parse with PaddleOCR-VL
                    ocr_parser = self.router.get_ocr_fallback_parser()
                    result = ocr_parser.parse(file_path, settings.output_dir)

            return result

        except ValueError as e:
            # Unsupported file type
            logger.warning("Skipping unsupported file", file=file_path.name, error=str(e))
            return ParseResult(
                source_path=file_path,
                output_path=Path(""),
                source_type="file",
                parser_used="none",
                status="skipped",
                started_at=datetime.now(),
                completed_at=datetime.now(),
                duration_seconds=0,
                output_format="markdown",
                error_message=str(e),
            )

    def _process_url_with_retry(self, url: str) -> ParseResult:
        """
        Process a single URL with retry logic.

        Wraps _process_url_impl with retry behavior.
        """
        try:
            return self._process_url_impl(url)
        except Exception as e:
            # Retry once
            logger.warning("First attempt failed, retrying", url=url, error=str(e))
            try:
                return self._process_url_impl(url)
            except Exception as retry_error:
                logger.error("All attempts failed", url=url, error=str(retry_error))
                return ParseResult(
                    source_path=Path(url),
                    output_path=Path(""),
                    source_type="url",
                    parser_used="none",
                    status="failed",
                    started_at=datetime.now(),
                    completed_at=datetime.now(),
                    duration_seconds=0,
                    output_format="markdown",
                    error_message=str(retry_error),
                    retry_count=1,
                )

    def _process_url_impl(self, url: str) -> ParseResult:
        """
        Process a single URL with cache support.

        Args:
            url: URL to process

        Returns:
            ParseResult from parsing
        """
        logger.info("Processing URL", url=url)

        try:
            # Route to appropriate parser
            parser = self.router.route_url(url)

            # Check cache (unless --no-cache)
            if not self._no_cache:
                from .url_cache import check_cache
                model_name = getattr(parser, "_cache_model_name", "")
                cached_path, cached_meta = check_cache(
                    url, parser.parser_name, settings.output_dir, model_name
                )
                if cached_path and cached_meta:
                    content = cached_path.read_text(encoding="utf-8")
                    original_output = Path(cached_meta.get("output_path", ""))
                    return ParseResult(
                        source_path=Path(url),
                        output_path=original_output if original_output.exists() else cached_path,
                        source_type="url",
                        parser_used=parser.parser_name,
                        status="success",
                        started_at=datetime.now(),
                        completed_at=datetime.now(),
                        duration_seconds=0,
                        output_format="markdown",
                        character_count=len(content),
                        metadata={"from_cache": True, **cached_meta},
                    )

            # Parse the URL
            result = parser.parse(url, settings.output_dir)

            # Save to cache on success
            if result.status == "success" and not self._no_cache and result.output_path.exists():
                from .url_cache import save_cache
                content = result.output_path.read_text(encoding="utf-8")
                model_name = getattr(parser, "_cache_model_name", "")
                save_cache(
                    url=url,
                    parser_name=parser.parser_name,
                    content=content,
                    output_dir=settings.output_dir,
                    output_path=result.output_path,
                    model_name=model_name,
                )

            return result

        except Exception as e:
            logger.error("URL processing failed", url=url, error=str(e))
            raise

    def _save_results_index(self, duration: float) -> None:
        """
        Persist all ParseResults to parse_results_index.json.

        Preserves the provenance chain (parser used, timing, JIT metadata)
        so downstream modules can reference it.
        """
        index_path = settings.output_dir / "parse_results_index.json"
        index_data = {
            "created_at": datetime.now().isoformat(),
            "duration_seconds": round(duration, 2),
            "total": len(self.results),
            "success": sum(1 for r in self.results if r.status == "success"),
            "failed": sum(1 for r in self.results if r.status == "failed"),
            "skipped": sum(1 for r in self.results if r.status == "skipped"),
            "results": [],
        }
        for r in self.results:
            entry = {
                "source_path": str(r.source_path.name),
                "source_type": r.source_type,
                "output_path": str(r.output_path.name),
                "output_format": r.output_format,
                "parser_used": r.parser_used,
                "status": r.status,
                "started_at": r.started_at.isoformat(),
                "completed_at": r.completed_at.isoformat(),
                "duration_seconds": round(r.duration_seconds, 2),
                "character_count": r.character_count,
                "error_message": r.error_message,
                "retry_count": r.retry_count,
                "metadata": r.metadata,
            }
            index_data["results"].append(entry)

        try:
            index_path.write_text(
                json.dumps(index_data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            logger.info("Saved parse results index", path=str(index_path))
        except Exception as e:
            logger.error("Failed to save parse results index", error=str(e))

    def _log_summary(self, duration: float):
        """
        Log pipeline execution summary.

        Args:
            duration: Total execution time in seconds
        """
        success = sum(1 for r in self.results if r.status == "success")
        failed = sum(1 for r in self.results if r.status == "failed")
        skipped = sum(1 for r in self.results if r.status == "skipped")

        logger.info(
            "Pipeline completed",
            duration_seconds=f"{duration:.2f}",
            total_processed=len(self.results),
            success=success,
            failed=failed,
            skipped=skipped,
        )

    def get_summary(self) -> dict:
        """
        Get pipeline execution summary as dict.

        Returns:
            Summary statistics
        """
        return {
            "total": len(self.results),
            "success": sum(1 for r in self.results if r.status == "success"),
            "failed": sum(1 for r in self.results if r.status == "failed"),
            "skipped": sum(1 for r in self.results if r.status == "skipped"),
            "results": self.results,
        }
