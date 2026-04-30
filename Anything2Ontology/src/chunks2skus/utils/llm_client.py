"""LLM client wrapper for SiliconFlow API calls."""

import json
import re
import time
from dataclasses import dataclass
import threading
from typing import Any, Optional

import httpx
import structlog
from openai import APITimeoutError, APIConnectionError, APIStatusError, OpenAI

from chunks2skus.config import settings

logger = structlog.get_logger(__name__)

# Thread-local storage for per-thread OpenAI clients
_thread_local = threading.local()

# Default retry count for JSON parse failures
DEFAULT_MAX_RETRIES = 2

# Retryable timeout/network exceptions (v2.1)
TIMEOUT_EXCEPTIONS = (
    APITimeoutError,          # SDK-wrapped client timeout
    APIConnectionError,       # Connection failure (SDK-wrapped)
    httpx.TimeoutException,   # httpx底层超时（兜底）
    httpx.NetworkError,       # Network-level errors
)

# Retryable server-side HTTP status codes (v2.1)
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


@dataclass
class LLMResponse:
    """Wrapper for LLM response with metadata."""

    text: str
    finish_reason: str  # "stop", "length", "content_filter", etc.
    is_truncated: bool

    @property
    def is_complete(self) -> bool:
        return self.finish_reason == "stop"


def get_llm_client() -> Optional[OpenAI]:
    """
    Get or create a thread-local OpenAI client for SiliconFlow.

    Each thread gets its own client instance with its own httpx connection pool,
    ensuring thread safety when multiple extractors run in parallel.

    Returns:
        OpenAI client for the current thread, or None if API key not configured.
    """
    client = getattr(_thread_local, "client", None)

    if client is None:
        if not settings.siliconflow_api_key:
            logger.warning("[MONITOR] SiliconFlow API key not configured")
            return None

        logger.info(
            "[MONITOR] Creating thread-local OpenAI client",
            base_url=settings.siliconflow_base_url,
            thread=threading.current_thread().name,
        )
        # Build httpx timeout with all 4 phases covered
        # This prevents indefinite hangs when the API silently drops connections
        timeout_secs = settings.llm_timeout_seconds
        httpx_timeout = httpx.Timeout(
            connect=30.0,           # TCP connect timeout (hardcoded 30s)
            read=timeout_secs,      # Read timeout (from settings, default 600s)
            write=60.0,             # Write timeout (large payloads)
            pool=30.0,              # Connection pool acquisition timeout
        )
        client = OpenAI(
            api_key=settings.siliconflow_api_key,
            base_url=settings.siliconflow_base_url,
            timeout=httpx_timeout,
        )
        _thread_local.client = client

    return client


def call_llm(
    prompt: str,
    system_prompt: str = "You are a knowledge extraction assistant. Output ONLY valid JSON.",
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 64000,
) -> Optional[str]:
    """
    Call LLM with the given prompt (simple stable version).

    Args:
        prompt: User prompt
        system_prompt: System prompt (default: knowledge extraction context)
        model: Model to use (default: settings.extraction_model)
        temperature: Sampling temperature (default: 0.3)
        max_tokens: Maximum tokens in response (default: 64000)

    Returns:
        LLM response text, or None on failure.
    """
    resp = call_llm_full(prompt, system_prompt, model, temperature, max_tokens)
    return resp.text if resp else None


def call_llm_full(
    prompt: str,
    system_prompt: str = "You are a knowledge extraction assistant. Output ONLY valid JSON.",
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 64000,
) -> Optional[LLMResponse]:
    """
    Call LLM and return full response with metadata.

    Args:
        prompt: User prompt
        system_prompt: System prompt
        model: Model to use
        temperature: Sampling temperature
        max_tokens: Maximum tokens in response

    Returns:
        LLMResponse with text + metadata, or None on failure.
    """
    client = get_llm_client()
    if client is None:
        logger.error("[MONITOR] LLM call skipped: No client")
        return None

    actual_model = model or settings.extraction_model
    max_attempts = 1 + settings.llm_max_retries

    kwargs: dict[str, Any] = {
        "model": actual_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    for attempt in range(max_attempts):
        if attempt > 0:
            logger.warning(
                "[MONITOR] Retrying LLM call",
                attempt=attempt,
                max_retries=settings.llm_max_retries,
                model=actual_model,
            )
            time.sleep(settings.llm_retry_delay_seconds)

        logger.info(
            "[MONITOR] Starting LLM call",
            model=actual_model,
            temperature=temperature,
            max_tokens=max_tokens,
            prompt_length=len(prompt),
            attempt=attempt,
        )

        try:
            response = client.chat.completions.create(
                **kwargs,
                timeout=settings.llm_timeout_seconds,
            )

            choice = response.choices[0]
            result = choice.message.content.strip() if choice.message.content else ""
            finish_reason = choice.finish_reason or "unknown"
            is_truncated = finish_reason == "length"

            if is_truncated:
                logger.warning(
                    "[MONITOR] LLM response TRUNCATED by max_tokens",
                    model=actual_model,
                    finish_reason=finish_reason,
                    response_length=len(result),
                    attempt=attempt,
                )
            else:
                logger.info(
                    "[MONITOR] LLM call SUCCESS",
                    model=actual_model,
                    finish_reason=finish_reason,
                    response_length=len(result),
                    attempt=attempt,
                )

            return LLMResponse(
                text=result,
                finish_reason=finish_reason,
                is_truncated=is_truncated,
            )

        except TIMEOUT_EXCEPTIONS as e:
            logger.warning(
                "[MONITOR] LLM call timeout/network error",
                error_type=type(e).__name__,
                attempt=attempt,
                max_attempts=max_attempts,
                timeout=settings.llm_timeout_seconds,
            )
            continue  # retry or fall through to final error

        except APIStatusError as e:
            if e.status_code in RETRYABLE_STATUS_CODES:
                delay = 60 if e.status_code == 429 else settings.llm_retry_delay_seconds
                logger.warning(
                    "[MONITOR] LLM call retryable API error",
                    status_code=e.status_code,
                    attempt=attempt,
                    max_attempts=max_attempts,
                )
                if attempt < settings.llm_max_retries:
                    time.sleep(delay)
                    continue
            logger.error(
                "[MONITOR] LLM call non-retryable API error",
                status_code=e.status_code,
                error=str(e)[:200],
            )
            return None

        except Exception as e:
            logger.error(
                "[MONITOR] LLM call unexpected error",
                error_type=type(e).__name__,
                mro=[c.__name__ for c in type(e).__mro__],
                error=str(e)[:500],
            )
            return None

    # All retries exhausted (only timeout/network errors reach here)
    logger.error(
        "[MONITOR] LLM call timed out after all retries",
        total_attempts=max_attempts,
        timeout=settings.llm_timeout_seconds,
        model=actual_model,
    )
    return None


def call_llm_json(
    prompt: str,
    system_prompt: str = "You are a knowledge extraction assistant. Output ONLY valid JSON.",
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 64000,
    max_retries: int = DEFAULT_MAX_RETRIES,
) -> Optional[dict[str, Any]]:
    """
    Call LLM and parse JSON response with smart truncation handling.

    Args:
        prompt: User prompt
        system_prompt: System prompt
        model: Model to use
        temperature: Sampling temperature
        max_tokens: Maximum tokens in response
        max_retries: Max retries on parse failure (default: 2)

    Returns:
        Parsed JSON dict, or None if all attempts fail.
    """
    actual_model = model or settings.extraction_model
    logger.info("[MONITOR] call_llm_json starting", model=actual_model)

    llm_response = call_llm_full(
        prompt=prompt,
        system_prompt=system_prompt,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    if not llm_response:
        logger.error("[MONITOR] call_llm_json FAILED: No response from LLM")
        return None

    response_text = llm_response.text

    # --- Strategy 1: Try parsing the full response ---
    logger.debug(
        "[MONITOR] Received response from LLM",
        length=len(response_text),
        is_truncated=llm_response.is_truncated,
        preview=response_text[:200],
    )
    parsed = parse_json_response(response_text)
    if parsed:
        logger.info("[MONITOR] JSON parse SUCCESS", keys=list(parsed.keys()))
        return parsed

    # --- Strategy 2: If truncated, try to repair the truncated JSON ---
    if llm_response.is_truncated:
        logger.warning(
            "[MONITOR] Response was truncated, attempting repair",
            response_length=len(response_text),
        )
        repaired = repair_truncated_json(response_text)
        if repaired:
            logger.info(
                "[MONITOR] Truncated JSON repaired SUCCESS",
                keys=list(repaired.keys()),
            )
            return repaired

        # Truncated & unrepairable — retrying with same max_tokens is useless.
        # Try ONE continuation request instead of the old retry loop.
        logger.info("[MONITOR] Attempting continuation request for truncated JSON")
        continuation = _try_continuation(
            response_text, prompt, system_prompt, model, temperature, max_tokens
        )
        if continuation:
            return continuation

        logger.error(
            "[MONITOR] Truncated JSON could not be repaired or continued",
            response_length=len(response_text),
        )
        return None

    # --- Strategy 3: Non-truncated but invalid JSON — retry with correction ---
    logger.warning(
        "[MONITOR] JSON parse FAILED (not truncated), will retry",
        response_preview=response_text[:300],
    )
    last_error = response_text[:300]
    for attempt in range(max_retries):
        logger.info(f"[MONITOR] Retry {attempt + 1}/{max_retries}")
        retry_prompt = (
            f"{prompt}\n\n"
            f"IMPORTANT: Your previous response was not valid JSON. "
            f"Here is what you returned:\n{last_error}\n\n"
            f"Please output ONLY valid JSON with no extra text, no markdown code blocks."
        )
        retry_resp = call_llm_full(
            prompt=retry_prompt,
            system_prompt=system_prompt,
            model=model,
            temperature=max(0.1, temperature - 0.1),
            max_tokens=max_tokens,
        )
        if not retry_resp:
            continue

        retry_text = retry_resp.text
        parsed = parse_json_response(retry_text)
        if parsed:
            logger.info(
                "[MONITOR] JSON parse SUCCESS on retry",
                attempt=attempt + 1,
            )
            return parsed

        # If this retry was also truncated, try repair
        if retry_resp.is_truncated:
            repaired = repair_truncated_json(retry_text)
            if repaired:
                logger.info(
                    "[MONITOR] Truncated JSON repaired on retry",
                    attempt=attempt + 1,
                )
                return repaired

        last_error = retry_text[:300]

    logger.error(
        "[MONITOR] All JSON parse attempts FAILED",
        attempts=max_retries + 1,
    )
    return None


def _try_continuation(
    partial_text: str,
    _original_prompt: str,
    system_prompt: str,
    model: Optional[str],
    temperature: float,
    max_tokens: int,
) -> Optional[dict[str, Any]]:
    """
    Try to get a continuation for truncated JSON by asking the LLM
    to continue from where it left off.
    """
    # Find a good break point — last ~200 chars to give context
    context_snippet = partial_text[-300:] if len(partial_text) > 300 else partial_text

    continuation_prompt = (
        f"The previous JSON response was truncated. Here is the end of what was generated:\n"
        f"```\n{context_snippet}\n```\n\n"
        f"Please continue the JSON from where it left off. "
        f"Output ONLY the continuation text (NOT the entire JSON from the beginning). "
        f"Make sure the combined text forms valid JSON."
    )

    cont_resp = call_llm_full(
        prompt=continuation_prompt,
        system_prompt=system_prompt,
        model=model,
        temperature=max(0.1, temperature - 0.1),
        max_tokens=max_tokens,
    )

    if not cont_resp or not cont_resp.text:
        return None

    # Try combining: original + continuation
    # But we need to find where to splice — remove overlap
    combined = partial_text + cont_resp.text
    parsed = parse_json_response(combined)
    if parsed:
        logger.info("[MONITOR] Continuation JSON parse SUCCESS")
        return parsed

    # If combined doesn't work, try repair on the combined text
    repaired = repair_truncated_json(combined)
    if repaired:
        logger.info("[MONITOR] Continuation + repair SUCCESS")
        return repaired

    return None


def parse_json_response(text: str) -> Optional[dict[str, Any]]:
    """
    Parse LLM JSON response with fallback for common formatting issues.

    Args:
        text: Raw LLM response text

    Returns:
        Parsed dict, or None on failure.
    """
    if not text:
        logger.debug("[MONITOR] parse_json_response: empty text")
        return None

    logger.debug("[MONITOR] Starting JSON parse", text_length=len(text))

    cleaned = text.strip()
    if cleaned.startswith("```"):
        logger.debug("[MONITOR] Detected markdown code block, removing")
        lines = cleaned.split("\n")
        if len(lines) > 2:
            cleaned = "\n".join(lines[1:-1])
            logger.debug("[MONITOR] Cleaned markdown wrapper")

    # Method 0: Strip control characters that break json.loads
    # LLMs sometimes output raw tab (\t), form feed, or other control chars
    # inside string values that are not valid JSON.
    def strip_control_chars(s: str) -> str:
        """Remove control characters except newline, carriage return, and tab."""
        return "".join(ch for ch in s if ch >= " " or ch in "\n\r\t")

    cleaned_control = strip_control_chars(cleaned)

    # Method 1: Try standard parsing
    try:
        result = json.loads(cleaned)
        logger.debug("[MONITOR] JSON parse success: standard parsing")
        return result
    except json.JSONDecodeError as e:
        logger.debug("[MONITOR] Standard JSON parse failed", error=str(e))

    # Method 1b: Try with control chars stripped
    if cleaned_control != cleaned:
        try:
            result = json.loads(cleaned_control)
            logger.debug("[MONITOR] JSON parse success: control char cleanup")
            return result
        except json.JSONDecodeError:
            pass

    # Method 2: Try escape newlines in strings first (common issue)
    try:
        fixed = escape_newlines_in_strings(cleaned)
        result = json.loads(fixed)
        logger.debug("[MONITOR] JSON parse success: newline escape fix")
        return result
    except json.JSONDecodeError as e:
        logger.debug("[MONITOR] Newline escape fix failed", error=str(e))

    # Method 3: Try fixing single-quoted keys/values (JSON spec requires double quotes)
    # Only replace single quotes that appear to be JSON delimiters,
    # not apostrophes inside string values.
    try:
        # Pattern: 'key': or :'value' or ['item'] — single quotes used as JSON delimiters
        fixed = re.sub(r"(?<=[:,\[{])\s*'([^']*)'\s*(?=[,\]}:])", r'"\1"', cleaned)
        result = json.loads(fixed)
        logger.debug("[MONITOR] JSON parse success: single quote fix")
        return result
    except json.JSONDecodeError as e:
        logger.debug("[MONITOR] Fixed quote JSON parse failed", error=str(e))

    # Method 4: Try fixing truncated JSON by closing open brackets
    try:
        fixed = fix_truncated_json(cleaned)
        if fixed:
            result = json.loads(fixed)
            logger.debug("[MONITOR] JSON parse success: truncated fix")
            return result
    except json.JSONDecodeError as e:
        logger.debug("[MONITOR] Truncated fix JSON parse failed", error=str(e))

    # Method 5: Try extracting largest possible JSON object (no recursion)
    try:
        blocks = _extract_top_level_json(cleaned)
        if blocks:
            # Try parsing each block directly (without calling parse_json_response again)
            for block_text in blocks:
                try:
                    result = json.loads(block_text)
                    if result:
                        logger.debug("[MONITOR] JSON parse success: extracted block")
                        return result
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.debug("[MONITOR] Block extraction failed", error=str(e))

    logger.warning(
        "[MONITOR] All JSON parsing methods FAILED",
        preview=cleaned[:200],
        text_length=len(cleaned),
    )
    return None


def repair_truncated_json(text: str) -> Optional[dict[str, Any]]:
    """
    Attempt to repair truncated JSON by finding the last complete item
    and closing all open structures.

    This handles the common case where LLM output is cut off mid-string
    by max_tokens, e.g.: {"facts": [{"name": "电管家", "conte

    Args:
        text: Truncated JSON text

    Returns:
        Parsed dict from the repaired JSON, or None if unrepairable.
    """
    if not text:
        return None

    cleaned = text.strip()

    # Remove markdown wrapper if present
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        if len(lines) > 2:
            cleaned = "\n".join(lines[1:-1])

    # Step 1: Find the last complete key-value pair or array element
    # Strategy: Walk backwards from the end, looking for structural anchors

    # Try to find the last "}," which marks the end of a complete object in an array
    last_complete_obj = -1

    # Pattern: look for closing of complete objects within arrays
    # We search for "}," or "},\n" or similar — this means a complete array element
    for pattern in [r'},\s*{', r'},\s*\n', r'}\s*,']:
        for match in re.finditer(pattern, cleaned):
            # The "}" before the comma is the end of a complete object
            obj_end = match.start() + 1  # position of the "}"
            if obj_end > last_complete_obj:
                last_complete_obj = obj_end

    # Also check if the text ends with a complete "}" (not truncated mid-object)
    # by looking for the last "}" that is followed only by whitespace or commas
    if last_complete_obj < 0:
        # No complete array element found; try to find last complete "}"
        for i in range(len(cleaned) - 1, -1, -1):
            if cleaned[i] == '}':
                last_complete_obj = i + 1
                break

    if last_complete_obj <= 0:
        logger.debug("[MONITOR] repair_truncated_json: no complete object found")
        return None

    # Step 2: Truncate at the last complete object
    truncated = cleaned[:last_complete_obj]

    # Step 3: Close open structures
    # Count brackets in the truncated text
    curly_open = truncated.count('{')
    curly_close = truncated.count('}')
    square_open = truncated.count('[')
    square_close = truncated.count(']')

    # Add closing brackets
    # First close any open arrays, then objects
    while square_open > square_close:
        truncated += ']'
        square_close += 1

    while curly_open > curly_close:
        truncated += '}'
        curly_close += 1

    # Step 4: Try to parse the repaired JSON
    try:
        result = json.loads(truncated)
        if result:
            logger.info(
                "[MONITOR] repair_truncated_json: SUCCESS",
                original_length=len(text),
                repaired_length=len(truncated),
            )
            return result
    except json.JSONDecodeError as e:
        logger.debug(
            "[MONITOR] repair_truncated_json: still invalid after repair",
            error=str(e),
            repaired_preview=truncated[-200:],
        )

    # Step 5: More aggressive — try to find the outermost JSON structure
    # and extract whatever complete items we can
    try:
        return _extract_complete_items_from_truncated(cleaned)
    except Exception as e:
        logger.debug("[MONITOR] repair_truncated_json: all strategies failed", error=str(e))

    return None


def _extract_complete_items_from_truncated(text: str) -> Optional[dict[str, Any]]:
    """
    Extract complete items from a truncated JSON array response.
    Handles: {"facts": [{"name": "a", ...}, {"name": "b", "conte...
    """
    # Find the top-level key (e.g., "facts")
    top_match = re.search(r'{\s*"(\w+)"\s*:\s*\[', text)
    if not top_match:
        return None

    key_name = top_match.group(1)
    array_start = top_match.end() - 1  # position of "["

    # Extract complete JSON objects from the array
    items = []
    depth = 0
    obj_start = -1

    i = array_start + 1  # skip the "["
    while i < len(text):
        char = text[i]

        if char == '"':
            # Skip string content (handle escaped quotes)
            i += 1
            while i < len(text):
                if text[i] == '\\' and i + 1 < len(text):
                    i += 2  # skip escaped char
                    continue
                if text[i] == '"':
                    break
                i += 1
        elif char == '{':
            if depth == 0:
                obj_start = i
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0 and obj_start >= 0:
                # Found a complete object
                obj_text = text[obj_start:i + 1]
                try:
                    item = json.loads(obj_text)
                    items.append(item)
                except json.JSONDecodeError:
                    pass  # Skip malformed items
                obj_start = -1

        i += 1

    if items:
        return {key_name: items}

    return None


def fix_truncated_json(text: str) -> Optional[str]:
    """
    Try to fix truncated JSON by closing open brackets.

    Args:
        text: Truncated JSON text

    Returns:
        Fixed JSON string, or None if can't fix
    """
    if not text:
        return None

    # Count open brackets
    curly_open = text.count('{')
    curly_close = text.count('}')
    square_open = text.count('[')
    square_close = text.count(']')

    if curly_open <= curly_close and square_open <= square_close:
        return None  # Not truncated, or already balanced

    # Remove trailing incomplete tokens
    cleaned = text.rstrip()

    # Remove trailing commas, colons, etc.
    while cleaned and cleaned[-1] in ',: \t\n':
        cleaned = cleaned[:-1].rstrip()

    # Close brackets in reverse order
    result = cleaned
    added = []

    # Close squares first, then curlies (reverse order of opening)
    while square_open > square_close:
        result += ']'
        added.append(']')
        square_close += 1

    while curly_open > curly_close:
        result += '}'
        added.append('}')
        curly_close += 1

    if added:
        logger.debug("[MONITOR] Fixed truncated JSON", added_brackets="".join(added))

    return result


def extract_json_blocks(text: str) -> list[dict[str, Any]]:
    """
    Extract multiple JSON objects from text that may contain mixed content.

    Useful when LLM outputs multiple JSON blocks or explanatory text.

    Args:
        text: Text potentially containing JSON objects

    Returns:
        List of parsed JSON dicts.
    """
    # Use the non-recursive version
    block_texts = _extract_top_level_json(text)
    results = []
    for block in block_texts:
        try:
            parsed = json.loads(block)
            if parsed:
                results.append(parsed)
        except json.JSONDecodeError:
            continue
    return results


def _extract_top_level_json(text: str) -> list[str]:
    """
    Extract top-level JSON object strings from text (non-recursive).

    Unlike extract_json_blocks, this returns raw strings and does NOT
    call parse_json_response, avoiding infinite recursion.

    Args:
        text: Text potentially containing JSON objects

    Returns:
        List of raw JSON strings found at top level.
    """
    results = []
    depth = 0
    start = -1
    in_string = False
    escape_next = False

    for i, char in enumerate(text):
        if escape_next:
            escape_next = False
            continue

        if char == "\\" and in_string:
            escape_next = True
            continue

        if char == '"' and not escape_next:
            in_string = not in_string
            continue

        if in_string:
            continue

        if char == "{":
            if depth == 0:
                start = i
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                block = text[start : i + 1]
                results.append(block)
                start = -1

    return results


def extract_field_value(text: str, field_name: str) -> Optional[str]:
    """
    Extract a field value from potentially malformed JSON using regex.

    Args:
        text: Text containing JSON-like structure
        field_name: Name of field to extract

    Returns:
        Field value as string, or None if not found.
    """
    logger.debug("[MONITOR] extract_field_value", field=field_name)
    pattern = rf'["\']?{re.escape(field_name)}["\']?\s*:\s*["\'](.+?)["\']'
    match = re.search(pattern, text, re.DOTALL)

    if match:
        value = match.group(1)
        value = value.replace('\\"', '"').replace("\\'", "'").replace("\\n", "\n")
        logger.debug("[MONITOR] extract_field_value success")
        return value

    logger.debug("[MONITOR] extract_field_value: field not found")
    return None


def escape_newlines_in_strings(text: str) -> str:
    """
    Escape newlines within JSON string values.

    This handles cases where LLM outputs newlines directly in strings
    without escaping them.

    Args:
        text: JSON text with potentially unescaped newlines in strings

    Returns:
        JSON text with newlines in strings escaped
    """
    result = []
    in_string = False
    escape_next = False
    i = 0

    while i < len(text):
        char = text[i]

        if escape_next:
            result.append(char)
            escape_next = False
            i += 1
            continue

        if char == "\\":
            result.append(char)
            escape_next = True
            i += 1
            continue

        if char == '"':
            in_string = not in_string
            result.append(char)
            i += 1
            continue

        if in_string and char in "\n\r":
            # Escape newline in string
            if char == "\n":
                result.append("\\n")
            else:
                result.append("\\r")
            i += 1
            continue

        result.append(char)
        i += 1

    return "".join(result)
