"""Configuration management for knowledge extraction module."""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> str | list[str]:
    """Find .env file relative to the project root (where pyproject.toml is)."""
    from pathlib import Path as P

    # Walk up from this file's location to find pyproject.toml
    current = P(__file__).resolve().parent
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
    """Knowledge extraction configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # I/O Paths (shared with upstream modules)
    input_dir: Path = Field(default=Path("./input"))
    output_dir: Path = Field(default=Path("./output"))
    log_dir: Path = Field(default=Path("./logs"))

    # LLM Configuration (SiliconFlow)
    siliconflow_api_key: str = Field(default="")
    siliconflow_base_url: str = Field(default="https://api.siliconflow.cn/v1")
    extraction_model: str = Field(
        default="Pro/zai-org/GLM-5",
        description="Model for knowledge extraction (complex tasks)",
    )

    # Postprocessing
    max_bucket_tokens: int = Field(default=100000)
    embedding_model: str = Field(default="Pro/BAAI/bge-m3")
    jina_api_key: str = Field(default="")
    similarity_weight_literal: float = Field(default=0.2)
    similarity_weight_label: float = Field(default=0.3)
    similarity_weight_vector: float = Field(default=0.5)
    dedup_scan_model: str = Field(
        default="Qwen/Qwen3-VL-235B-A22B-Instruct",
        description="Fast model for dedup header scanning",
    )

    # Meta extractor frequency: run meta after every N chunks (0 = only at end)
    meta_interval: int = Field(
        default=5,
        description="Run meta extractor every N chunks. 0 = only at pipeline end.",
    )

    # Chunk-level parallelism for Factual + Procedural extractors
    chunk_concurrency: int = Field(
        default=4,
        description="Max concurrent chunks for Factual/Procedural extraction. "
                    "Relational runs serially via consumer queue regardless of this setting. "
                    "Adjust based on API rate limits and LLM concurrency tolerance.",
    )

    # Dedup Tier1 bucket concurrency
    dedup_concurrency: int = Field(
        default=4,
        description="Max concurrent buckets for Tier1 dedup scanning. "
                    "Tier2 judgment remains serial (mutates shared index). "
                    "Adjust based on dedup_scan_model API rate limits.",
    )

    # LLM timeout and retry (v2.1 — aligned with Volcengine Ark defaults)
    llm_timeout_seconds: int = Field(
        default=600,
        description="Timeout for a single LLM API call (seconds). "
                    "Volcengine Ark default: 600s for non-streaming. "
                    "Set to 1800+ for deep thinking mode.",
    )
    llm_max_retries: int = Field(
        default=1,
        description="Max retries on timeout/network error (0 = no retry)",
    )
    llm_retry_delay_seconds: int = Field(
        default=15,
        description="Delay in seconds before retry after timeout",
    )

    # Language
    language: Literal["en", "zh"] = Field(default="en")

    # Logging
    log_level: str = Field(default="INFO")
    log_format: Literal["json", "text", "both"] = Field(default="both")

    @property
    def skus_output_dir(self) -> Path:
        """Directory for SKU output (auto-derived from output_dir)."""
        return self.output_dir / "skus"

    @property
    def chunks_dir(self) -> Path:
        """Directory containing chunks from Module 2."""
        return self.output_dir / "chunks"

    @property
    def chunks_index_path(self) -> Path:
        """Path to chunks_index.json from Module 2."""
        return self.chunks_dir / "chunks_index.json"

    @property
    def factual_dir(self) -> Path:
        """Directory for factual SKUs."""
        return self.skus_output_dir / "factual"

    @property
    def relational_dir(self) -> Path:
        """Directory for relational knowledge."""
        return self.skus_output_dir / "relational"

    @property
    def procedural_dir(self) -> Path:
        """Directory for procedural SKUs (skills)."""
        return self.skus_output_dir / "procedural"

    @property
    def meta_dir(self) -> Path:
        """Directory for meta knowledge."""
        return self.skus_output_dir / "meta"

    @property
    def postprocessing_dir(self) -> Path:
        """Directory for postprocessing outputs."""
        return self.skus_output_dir / "postprocessing"


def get_settings() -> Settings:
    """Get settings instance."""
    return Settings()


# Default singleton
settings = Settings()
