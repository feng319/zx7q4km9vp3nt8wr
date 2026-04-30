"""Jina web search client for proofreading verification."""

import threading
import time
from typing import Optional

import httpx
import structlog

from chunks2skus.config import settings

logger = structlog.get_logger(__name__)

# Rate limiting state (thread-safe)
_last_request_time: float = 0.0
_rate_limit_lock = threading.Lock()
_MIN_INTERVAL: float = 0.6  # ~100 RPM

# Module-level httpx.Client singleton (connection pool reuse)
_jina_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()


def _get_jina_client() -> httpx.Client:
    """Get or create module-level httpx.Client (thread-safe lazy init)."""
    global _jina_client
    if _jina_client is None or _jina_client.is_closed:
        with _client_lock:
            if _jina_client is None or _jina_client.is_closed:
                _jina_client = httpx.Client(timeout=30.0)
                logger.debug("Jina httpx.Client created (connection pool)")
    return _jina_client


def close_jina_client() -> None:
    """Explicitly close the Jina httpx.Client.

    Call when pipeline completes to release connection pool.
    Not strictly necessary for CLI (OS reclaims on exit), but
    important for long-running service deployments.
    """
    global _jina_client
    with _client_lock:
        if _jina_client is not None and not _jina_client.is_closed:
            _jina_client.close()
            _jina_client = None
            logger.debug("Jina httpx.Client closed")


def search_web(query: str, num_results: int = 5) -> Optional[list[dict]]:
    """
    Search the web using Jina s.jina.ai.

    Thread-safe: multiple threads can call this concurrently; rate limiting
    is enforced via a lock so requests are properly spaced.

    Args:
        query: Search query string
        num_results: Number of results to return (default: 5)

    Returns:
        List of result dicts with 'title', 'url', 'snippet', or None on failure.
    """
    global _last_request_time

    if not settings.jina_api_key:
        logger.warning("Jina API key not configured")
        return None

    # Thread-safe rate limiting
    with _rate_limit_lock:
        now = time.time()
        elapsed = now - _last_request_time
        wait = _MIN_INTERVAL - elapsed
        if wait > 0:
            time.sleep(wait)
        _last_request_time = time.time()

    url = f"https://s.jina.ai/{query}"
    headers = {
        "Authorization": f"Bearer {settings.jina_api_key}",
        "Accept": "application/json",
        "X-Retain-Images": "none",
    }

    try:
        client = _get_jina_client()
        response = client.get(url, headers=headers)
        response.raise_for_status()

        # Update rate limit timestamp after successful request (under lock)
        with _rate_limit_lock:
            _last_request_time = time.time()

        data = response.json()
        results = []
        items = data.get("data", [])[:num_results]
        for item in items:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("content", item.get("description", ""))[:1000],
            })

        logger.debug("Jina search completed", query=query[:50], results=len(results))
        return results

    except (httpx.ConnectError, httpx.ReadError) as e:
        # Connection broken — tear down client so next call rebuilds it
        logger.warning("Jina connection error, resetting client", error=str(e))
        with _client_lock:
            if _jina_client is not None:
                _jina_client.close()
                _jina_client = None
        return None

    except Exception as e:
        logger.error("Jina search failed", query=query[:50], error=str(e))
        return None
