import hashlib
import logging
import os

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

_MODEL = "text-embedding-3-small"
_DIMENSIONS = 1536
_MAX_CHARS = 24000  # ~6000 tokens; leaves headroom below the 8192-token context limit


def _content_hash(text: str) -> str:
    """SHA-256 of the text — used to skip re-embedding identical content."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def truncate(text: str) -> str:
    """Truncate text to _MAX_CHARS to stay within the embedding model context window."""
    return text[:_MAX_CHARS]


async def embed(text: str) -> tuple[list[float], str]:
    """
    Generate an embedding vector for the given text.

    Returns:
        (vector, content_hash) — the 1536-dim embedding and the SHA-256 of the input.

    The caller is responsible for cache checks using content_hash before calling
    this function (check the DB for an existing row with the same hash).
    """
    text = truncate(text.strip())
    if not text:
        raise ValueError("embed() called with empty text")

    content_hash = _content_hash(text)

    response = await _client.embeddings.create(
        model=_MODEL,
        input=text,
        dimensions=_DIMENSIONS,
    )
    vector = response.data[0].embedding
    logger.debug("embed: generated %d-dim vector (hash=%s…)", len(vector), content_hash[:8])
    return vector, content_hash
