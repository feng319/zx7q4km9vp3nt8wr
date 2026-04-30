"""Configuration management for ontology assembly module."""

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
    """Ontology assembly configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Shared paths
    output_dir: Path = Field(default=Path("./output"))
    log_dir: Path = Field(default=Path("./logs"))

    @property
    def skus_output_dir(self) -> Path:
        """Directory for SKU input (auto-derived from output_dir)."""
        return self.output_dir / "skus"

    @property
    def ontology_dir(self) -> Path:
        """Directory for ontology output (auto-derived from output_dir)."""
        return self.output_dir / "ontology"

    # LLM Configuration (SiliconFlow)
    siliconflow_api_key: str = Field(default="")
    siliconflow_base_url: str = Field(default="https://api.siliconflow.cn/v1")
    chatbot_model: str = Field(
        default="Pro/zai-org/GLM-5",
        description="Model for spec chatbot",
    )
    max_chat_rounds: int = Field(default=5)
    chatbot_temperature: float = Field(default=0.4)
    chatbot_max_tokens: int = Field(default=8000)

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
