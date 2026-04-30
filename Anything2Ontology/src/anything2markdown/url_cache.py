"""URL result cache with versioned keys and TTL."""

import hashlib
import json
import time
from pathlib import Path

import structlog

from .config import settings

logger = structlog.get_logger(__name__)


def _cache_key(url: str, parser_name: str, model_name: str = "") -> str:
    """
    Generate a cache key from URL + parser + model.

    Key includes parser name and model so that upgrading the parser
    or model invalidates stale cache entries automatically.
    """
    raw = f"{url}|{parser_name}|{model_name}"
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_dir(output_dir: Path) -> Path:
    """Return the cache directory under output_dir."""
    d = output_dir / ".cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def check_cache(
    url: str,
    parser_name: str,
    output_dir: Path,
    model_name: str = "",
) -> tuple[Path | None, dict | None]:
    """
    Check if a cached result exists and is fresh.

    Returns:
        (cache_path, metadata) if cache hit, else (None, None).
    """
    if not settings.cache_enabled:
        return None, None

    cdir = _cache_dir(output_dir)
    key = _cache_key(url, parser_name, model_name)
    meta_path = cdir / f"{key}.meta.json"
    content_path = cdir / f"{key}.md"

    if not meta_path.exists() or not content_path.exists():
        return None, None

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None, None

    # TTL check
    cached_at = meta.get("cached_at", 0)
    ttl_seconds = settings.cache_ttl_days * 86400
    if time.time() - cached_at > ttl_seconds:
        logger.debug("Cache expired", url=url, key=key)
        # Clean up stale entry
        meta_path.unlink(missing_ok=True)
        content_path.unlink(missing_ok=True)
        return None, None

    logger.info("Cache hit", url=url, key=key)
    return content_path, meta


def save_cache(
    url: str,
    parser_name: str,
    content: str,
    output_dir: Path,
    output_path: Path,
    model_name: str = "",
    extra_meta: dict | None = None,
) -> None:
    """
    Save a result to cache.

    The cache stores the markdown content and metadata (including the
    original output_path for reference).
    """
    if not settings.cache_enabled:
        return

    cdir = _cache_dir(output_dir)
    key = _cache_key(url, parser_name, model_name)
    content_path = cdir / f"{key}.md"
    meta_path = cdir / f"{key}.meta.json"

    content_path.write_text(content, encoding="utf-8")

    meta = {
        "url": url,
        "parser_name": parser_name,
        "model_name": model_name,
        "cached_at": time.time(),
        "output_path": str(output_path.name),
        "char_count": len(content),
    }
    if extra_meta:
        meta.update(extra_meta)

    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    logger.debug("Cache saved", url=url, key=key)
