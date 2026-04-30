"""Configuration management for chunking module."""

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
    """Chunking configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # I/O Paths (shared with module 1)
    input_dir: Path = Field(default=Path("./input"))
    output_dir: Path = Field(default=Path("./output"))
    log_dir: Path = Field(default=Path("./logs"))

    # Chunking Configuration
    max_token_length: int = Field(default=100000, description="Max tokens per chunk and Rolling Context Window")
    k_nearest_tokens: int = Field(default=50, description="Tokens around cut point for LLM")

    # LLM Configuration (SiliconFlow)
    siliconflow_api_key: str = Field(default="")
    siliconflow_base_url: str = Field(default="https://api.siliconflow.cn/v1")
    chunking_model: str = Field(default="Pro/Qwen/Qwen2.5-7B-Instruct")  # Fast model
    complex_model: str = Field(default="Pro/Qwen/Qwen2.5-72B-Instruct")  # Reserved

    # Language
    language: Literal["en", "zh"] = Field(default="en")

    # Logging
    log_level: str = Field(default="INFO")
    log_format: Literal["json", "text", "both"] = Field(default="both")


def get_settings() -> Settings:
    """Get settings instance."""
    return Settings()


# Default singleton
settings = Settings()
