"""LLM client wrapper for SiliconFlow API calls."""

import time
from typing import Optional

import structlog
from openai import OpenAI, APIConnectionError, APITimeoutError, APIStatusError

from skus2ontology.config import settings

logger = structlog.get_logger(__name__)

# Retry config
MAX_RETRIES = 3
RETRY_BASE_DELAY = 5  # seconds

# Module-level client (lazy initialized)
_client: Optional[OpenAI] = None


def get_llm_client() -> Optional[OpenAI]:
    """
    Get or create the OpenAI client for SiliconFlow.

    Returns:
        OpenAI client, or None if API key not configured.
    """
    global _client

    if _client is None:
        if not settings.siliconflow_api_key:
            logger.warning("SiliconFlow API key not configured")
            return None

        _client = OpenAI(
            api_key=settings.siliconflow_api_key,
            base_url=settings.siliconflow_base_url,
        )

    return _client


def call_llm(
    prompt: str,
    system_prompt: str = "You are a helpful assistant.",
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 4000,
) -> Optional[str]:
    """
    Call the LLM with a single user prompt.

    Args:
        prompt: User prompt
        system_prompt: System prompt
        model: Model to use (default: settings.chatbot_model)
        temperature: Sampling temperature
        max_tokens: Maximum tokens in response

    Returns:
        LLM response text, or None on failure.
    """
    client = get_llm_client()
    if client is None:
        return None

    model = model or settings.chatbot_model
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            result = response.choices[0].message.content.strip()
            logger.debug("LLM call successful", model=model, response_length=len(result))
            return result

        except (APIConnectionError, APITimeoutError) as e:
            logger.warning("LLM call failed (retryable)", model=model, attempt=attempt, error=str(e))
            if attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY * attempt
                logger.info("Retrying after delay", delay_seconds=delay, attempt=attempt)
                time.sleep(delay)
            else:
                logger.error("LLM call failed after retries", model=model, retries=MAX_RETRIES, error=str(e))
                return None

        except APIStatusError as e:
            if e.status_code >= 500:
                logger.warning("LLM call failed (retryable server error)", model=model, attempt=attempt, status=e.status_code)
                if attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * attempt
                    time.sleep(delay)
                else:
                    logger.error("LLM call failed after retries", model=model, retries=MAX_RETRIES, error=str(e))
                    return None
            else:
                logger.error("LLM call failed (non-retryable)", model=model, status=e.status_code, error=str(e))
                return None

        except Exception as e:
            logger.error("LLM call failed", model=model, error=str(e))
            return None


def call_llm_chat(
    messages: list[dict[str, str]],
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> Optional[str]:
    """
    Call the LLM with a full message history (multi-turn).

    Args:
        messages: List of {"role": ..., "content": ...} dicts
        model: Model to use (default: settings.chatbot_model)
        temperature: Sampling temperature (default: settings.chatbot_temperature)
        max_tokens: Maximum tokens in response (default: settings.chatbot_max_tokens)

    Returns:
        LLM response text, or None on failure.
    """
    client = get_llm_client()
    if client is None:
        return None

    model = model or settings.chatbot_model
    temperature = temperature if temperature is not None else settings.chatbot_temperature
    max_tokens = max_tokens if max_tokens is not None else settings.chatbot_max_tokens

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            result = response.choices[0].message.content.strip()
            logger.debug(
                "LLM chat call successful",
                model=model,
                turns=len(messages),
                response_length=len(result),
            )
            return result

        except (APIConnectionError, APITimeoutError) as e:
            logger.warning("LLM chat call failed (retryable)", model=model, attempt=attempt, error=str(e))
            if attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY * attempt
                logger.info("Retrying after delay", delay_seconds=delay, attempt=attempt)
                time.sleep(delay)
            else:
                logger.error("LLM chat call failed after retries", model=model, retries=MAX_RETRIES, error=str(e))
                return None

        except APIStatusError as e:
            if e.status_code >= 500:
                logger.warning("LLM chat call failed (retryable server error)", model=model, attempt=attempt, status=e.status_code)
                if attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * attempt
                    time.sleep(delay)
                else:
                    logger.error("LLM chat call failed after retries", model=model, retries=MAX_RETRIES, error=str(e))
                    return None
            else:
                logger.error("LLM chat call failed (non-retryable)", model=model, status=e.status_code, error=str(e))
                return None

        except Exception as e:
            logger.error("LLM chat call failed", model=model, error=str(e))
            return None
