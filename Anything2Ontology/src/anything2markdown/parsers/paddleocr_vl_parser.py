"""Parser using PaddleOCR-VL via SiliconFlow API or local mlx-vlm for scanned PDF OCR."""

import base64
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import fitz
import httpx
import structlog
from openai import OpenAI

from ..config import settings
from ..schemas.result import ParseResult
from ..utils.file_utils import flatten_path
from .base import BaseParser

logger = structlog.get_logger(__name__)

OCR_PROMPT = "Convert this document page to markdown. Preserve all text content faithfully."

# PaddleOCR-VL emits bounding-box location tokens like <|LOC_401|> — strip them
_LOC_TOKEN_RE = re.compile(r"<\|LOC_\d+\|>")

# Thread-local storage for OpenAI client.
# Each thread gets its own client to avoid httpx.Client race conditions.
_thread_local = threading.local()


class PaddleOCRVLParser(BaseParser):
    """
    Parser using PaddleOCR-VL vision-language model for scanned PDF OCR.
    Supports two backends:
    - SiliconFlow API (default): set SILICONFLOW_API_KEY
    - Local mlx-vlm server: set OCR_BASE_URL=http://localhost:8080

    Saves progress incrementally to a .jsonl temp file so that OCR can
    resume from the last completed page if the process is interrupted.

    Thread safety: OpenAI/httpx clients are thread-local to support
    parallel page processing within a single PDF.
    """

    supported_extensions = [".pdf"]
    parser_name = "paddleocr_vl"

    # Cache model name for URL cache key versioning
    _cache_model_name: str = ""

    def __init__(self):
        """Initialize parser configuration (client is lazily created per-thread)."""
        # Determine base URL: ocr_base_url overrides siliconflow_base_url (for local deployment)
        self._base_url = settings.ocr_base_url or settings.siliconflow_base_url
        self._api_key = settings.siliconflow_api_key or "local"
        self._cache_model_name = settings.paddleocr_model
        self._is_local = bool(
            self._base_url and ("localhost" in self._base_url or "127.0.0.1" in self._base_url)
        )

    @property
    def client(self) -> OpenAI:
        """Return a thread-local OpenAI client."""
        if not hasattr(_thread_local, "client"):
            if self._base_url:
                if self._is_local:
                    http_client = httpx.Client(trust_env=False)
                else:
                    timeout = httpx.Timeout(
                        connect=30.0,
                        read=float(settings.ocr_page_timeout),
                        write=30.0,
                        pool=30.0,
                    )
                    http_client = httpx.Client(timeout=timeout)
                _thread_local.client = OpenAI(
                    api_key=self._api_key,
                    base_url=self._base_url,
                    timeout=float(settings.ocr_page_timeout),
                    max_retries=0,
                    http_client=http_client,
                )
            else:
                _thread_local.client = None
        return _thread_local.client

    def can_handle(self, file_path: Path) -> bool:
        """Check if file extension is supported."""
        return file_path.suffix.lower() in self.supported_extensions

    def parse(self, file_path: Path, output_dir: Path) -> ParseResult:
        """
        Parse a scanned PDF by rendering pages to images and running OCR.

        Args:
            file_path: Path to the input PDF
            output_dir: Directory to save output

        Returns:
            ParseResult with conversion details
        """
        started_at = datetime.now()

        if not self.client:
            completed_at = datetime.now()
            logger.error("PaddleOCR-VL: no OCR backend configured")
            return ParseResult(
                source_path=file_path,
                output_path=Path(""),
                source_type="file",
                parser_used=self.parser_name,
                status="failed",
                started_at=started_at,
                completed_at=completed_at,
                duration_seconds=(completed_at - started_at).total_seconds(),
                output_format="markdown",
                error_message="No OCR backend configured (set SILICONFLOW_API_KEY or OCR_BASE_URL)",
            )

        logger.info("PaddleOCR-VL parsing", file=file_path.name)

        try:
            doc = fitz.open(file_path)
        except Exception as e:
            completed_at = datetime.now()
            logger.error("PaddleOCR-VL: failed to open PDF", error=str(e))
            return ParseResult(
                source_path=file_path,
                output_path=Path(""),
                source_type="file",
                parser_used=self.parser_name,
                status="failed",
                started_at=started_at,
                completed_at=completed_at,
                duration_seconds=(completed_at - started_at).total_seconds(),
                output_format="markdown",
                error_message=f"Failed to open PDF: {e}",
            )

        page_count = len(doc)
        pages_failed = 0

        # --- Incremental save / resume support ---
        # Temp file stores one JSON line per page: {"page": 1, "text": "..."}
        output_name = flatten_path(file_path, settings.input_dir) + ".md"
        output_path = output_dir / output_name
        # Ensure parent directory exists (for grouped outputs)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = output_dir / (output_name + ".progress.jsonl")

        # Check for existing progress to resume from
        page_markdowns: dict[int, str] = {}
        start_page = 0
        if temp_path.exists():
            try:
                for line in temp_path.read_text(encoding="utf-8").strip().splitlines():
                    rec = json.loads(line)
                    page_markdowns[rec["page"]] = rec["text"]
                start_page = max(page_markdowns.keys()) + 1 if page_markdowns else 0
                # Count failures from resumed data
                pages_failed = sum(
                    1 for t in page_markdowns.values() if t.startswith("<!-- OCR failed")
                )
                logger.info(
                    "PaddleOCR-VL resuming from progress file",
                    file=file_path.name,
                    resumed_pages=len(page_markdowns),
                    start_page=start_page + 1,
                    total=page_count,
                )
            except Exception as e:
                logger.warning("PaddleOCR-VL: corrupt progress file, starting fresh", error=str(e))
                page_markdowns = {}
                start_page = 0
                temp_path.unlink(missing_ok=True)

        logger.info(
            "PaddleOCR-VL starting OCR",
            file=file_path.name,
            pages=page_count,
            start_page=start_page + 1,
            dpi=settings.ocr_dpi,
            model=settings.paddleocr_model,
        )

        # Open temp file in append mode for incremental writes
        with open(temp_path, "a", encoding="utf-8") as progress_f:
            # Thread-safe lock for progress file writes
            progress_lock = threading.Lock()
            remaining_pages = page_count - start_page

            if remaining_pages <= 1 or settings.ocr_page_concurrency <= 1:
                # Serial mode: single page or concurrency disabled
                for page_num in range(start_page, page_count):
                    page_md = self._ocr_page(doc[page_num], page_num + 1)
                    if page_md is None:
                        pages_failed += 1
                        text = f"<!-- OCR failed: page {page_num + 1} -->"
                    else:
                        text = page_md

                    page_markdowns[page_num] = text
                    progress_f.write(json.dumps({"page": page_num, "text": text}, ensure_ascii=False) + "\n")
                    progress_f.flush()

                    if (page_num + 1) % 10 == 0:
                        logger.info(
                            "PaddleOCR-VL progress",
                            file=file_path.name,
                            page=page_num + 1,
                            total=page_count,
                            failed_so_far=pages_failed,
                        )
            else:
                # Parallel mode: process multiple pages concurrently
                max_workers = min(settings.ocr_page_concurrency, remaining_pages)

                def _ocr_page_wrapper(pn: int) -> tuple[int, str | None]:
                    """OCR one page, return (page_num, text_or_None)."""
                    return pn, self._ocr_page(doc[pn], pn + 1)

                with ThreadPoolExecutor(max_workers=max_workers) as page_pool:
                    futures = {
                        page_pool.submit(_ocr_page_wrapper, pn): pn
                        for pn in range(start_page, page_count)
                    }
                    pages_done = 0
                    for future in as_completed(futures):
                        pn, page_md = future.result()
                        if page_md is None:
                            pages_failed += 1
                            text = f"<!-- OCR failed: page {pn + 1} -->"
                        else:
                            text = page_md

                        page_markdowns[pn] = text
                        # Lock-protected progress write (guarantees .jsonl line integrity)
                        with progress_lock:
                            progress_f.write(
                                json.dumps({"page": pn, "text": text}, ensure_ascii=False) + "\n"
                            )
                            progress_f.flush()

                        pages_done += 1
                        if pages_done % 10 == 0:
                            logger.info(
                                "PaddleOCR-VL progress",
                                file=file_path.name,
                                pages_done=pages_done,
                                total=remaining_pages,
                                failed_so_far=pages_failed,
                            )

        doc.close()

        # Assemble final output from all pages in order
        all_pages = [page_markdowns.get(i, f"<!-- OCR missing: page {i + 1} -->") for i in range(page_count)]
        content = "\n\n---\n\n".join(all_pages)

        output_path.write_text(content, encoding="utf-8")

        # Clean up progress file on successful completion
        temp_path.unlink(missing_ok=True)

        completed_at = datetime.now()

        logger.info(
            "PaddleOCR-VL complete",
            file=file_path.name,
            pages=page_count,
            pages_failed=pages_failed,
            chars=len(content),
            duration=f"{(completed_at - started_at).total_seconds():.1f}s",
        )

        return ParseResult(
            source_path=file_path,
            output_path=output_path,
            source_type="file",
            parser_used=self.parser_name,
            status="success",
            started_at=started_at,
            completed_at=completed_at,
            duration_seconds=(completed_at - started_at).total_seconds(),
            output_format="markdown",
            character_count=len(content),
            metadata={
                "page_count": page_count,
                "pages_failed": pages_failed,
                "ocr_model": settings.paddleocr_model,
                "dpi": settings.ocr_dpi,
            },
        )

    def _ocr_page(self, page: fitz.Page, page_num: int) -> str | None:
        """
        OCR a single PDF page via the vision API.

        Args:
            page: PyMuPDF page object
            page_num: 1-based page number (for logging)

        Returns:
            Extracted markdown text, or None on failure
        """
        try:
            pix = page.get_pixmap(dpi=settings.ocr_dpi)
            png_bytes = pix.tobytes("png")
            b64 = base64.b64encode(png_bytes).decode("ascii")
        except Exception as e:
            logger.warning("PaddleOCR-VL: failed to render page", page=page_num, error=str(e))
            return None

        # Try up to 2 attempts (initial + 1 retry)
        for attempt in range(2):
            try:
                response = self.client.chat.completions.create(
                    model=settings.paddleocr_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": OCR_PROMPT},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{b64}",
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=4000,
                    temperature=0.1,
                )
                text = response.choices[0].message.content
                if text and text.strip():
                    # Strip <|LOC_xxx|> bounding-box tokens from PaddleOCR-VL output
                    clean = _LOC_TOKEN_RE.sub("", text).strip()
                    return clean if clean else None
                logger.warning("PaddleOCR-VL: empty response", page=page_num, attempt=attempt + 1)
            except Exception as e:
                logger.warning(
                    "PaddleOCR-VL: API call failed",
                    page=page_num,
                    attempt=attempt + 1,
                    error=str(e),
                )

        return None
