"""Configuration management using Pydantic Settings."""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> str | list[str]:
    """Find .env file relative to the project root (where pyproject.toml is)."""
    current = Path(__file__).resolve().parent
    for _ in range(6):
        candidate = current / ".env"
        if candidate.exists():
            return str(candidate)
        if (current / "pyproject.toml").exists():
            return str(current / ".env")
        if current == current.parent:
            break
        current = current.parent
    return ".env"


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # I/O Paths
    input_dir: Path = Field(default=Path("./input"))
    output_dir: Path = Field(default=Path("./output"))
    log_dir: Path = Field(default=Path("./logs"))

    # API Keys
    siliconflow_api_key: str = Field(default="")
    mineru_api_key: str = Field(default="")
    firecrawl_api_key: str = Field(default="")

    # MinerU Configuration
    mineru_api_endpoint: str = Field(default="https://mineru.net/api/v4/extract/task")
    max_pdf_size_mb: int = Field(default=10)
    min_valid_chars: int = Field(default=500)

    # SiliconFlow API
    siliconflow_base_url: str = Field(default="https://api.siliconflow.cn/v1")

    # PaddleOCR-VL Configuration
    paddleocr_model: str = Field(default="PaddlePaddle/PaddleOCR-VL-1.5")
    ocr_dpi: int = Field(default=150)
    ocr_page_timeout: int = Field(default=60)
    ocr_base_url: str = Field(default="")  # Empty = use siliconflow_base_url; set to e.g. http://localhost:8080/v1 for local
    ocr_page_concurrency: int = Field(
        default=4,
        description="Max concurrent pages for OCR parsing. "
                    "Adjust based on API rate limits (SiliconFlow: 4-5 safe, "
                    "local OCR: 8-10).",
    )

    # Bilibili Configuration
    bilibili_cookies_file: str = Field(default="")  # Path to Netscape cookie file
    bilibili_cookies_from_browser: str = Field(default="chrome")  # Browser to extract cookies from (chrome/firefox/safari/edge); empty to disable
    whisperx_model: str = Field(default="large-v2")  # WhisperX model size

    # Processing
    retry_count: int = Field(default=1)
    retry_delay_seconds: int = Field(default=2)

    # Parallel processing concurrency limits
    # API-bound parsers (PaddleOCR, FireCrawl, SiliconFlow)
    max_workers_api: int = Field(default=8)
    # CPU-bound parsers (MarkItDown for DOCX/PPTX)
    max_workers_cpu: int = Field(default=4)
    # Video/WhisperX (memory-heavy)
    max_workers_video: int = Field(default=2)
    # Overall max parallel tasks (0 = auto based on task mix)
    max_workers: int = Field(default=0)

    # URL result cache
    cache_enabled: bool = Field(default=True)
    cache_ttl_days: int = Field(default=7)

    # PDF OCR fallback thresholds
    min_chars_per_page: int = Field(default=100)
    consecutive_low_pages: int = Field(default=3)
    consecutive_low_threshold: int = Field(default=50)

    # Language
    language: Literal["en", "zh"] = Field(default="en")

    # Logging
    log_level: str = Field(default="INFO")
    log_format: Literal["json", "text", "both"] = Field(default="both")


def get_settings() -> Settings:
    """Get settings instance. Creates new instance each time to pick up env changes."""
    return Settings()


# Default singleton for convenience
settings = Settings()
