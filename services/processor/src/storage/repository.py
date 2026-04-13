import hashlib
import logging
import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.storage.models import Candidate, RankingResult, SystemState

logger = logging.getLogger(__name__)


# ── Candidate repository ──────────────────────────────────────────────────────

async def get_candidate_by_hash(session: AsyncSession, content_hash: str) -> Candidate | None:
    """Return existing candidate if this file has already been processed (idempotency check)."""
    result = await session.execute(
        select(Candidate).where(Candidate.content_hash == content_hash)
    )
    return result.scalar_one_or_none()


async def upsert_candidate(
    session: AsyncSession,
    *,
    filename: str,
    content_hash: str,
    parsed_json: dict[str, Any],
    embedding: list[float],
) -> Candidate:
    """
    Insert or update a candidate row.
    ON CONFLICT DO UPDATE ensures re-uploads with changed content refresh
    the embedding and parsed_json without duplicates.
    Bumps candidate_generation to invalidate stale ranking caches.
    """
    stmt = (
        insert(Candidate)
        .values(
            id=uuid.uuid4(),
            filename=filename,
            content_hash=content_hash,
            name=parsed_json.get("name"),
            email=parsed_json.get("email"),
            parsed_json=parsed_json,
            embedding=embedding,
        )
        .on_conflict_do_update(
            index_elements=["content_hash"],
            set_={
                "filename":    filename,
                "name":        parsed_json.get("name"),
                "email":       parsed_json.get("email"),
                "parsed_json": parsed_json,
                "embedding":   embedding,
            },
        )
        .returning(Candidate)
    )
    result = await session.execute(stmt)
    candidate = result.scalar_one()
    await _bump_candidate_generation(session)
    logger.info("upsert_candidate: saved '%s' (hash=%s…)", filename, content_hash[:8])
    return candidate


async def query_similar(
    session: AsyncSession,
    embedding: list[float],
    n: int = 50,
) -> list[tuple[Candidate, float]]:
    """
    Return the top-n candidates most similar to the query embedding.
    Uses pgvector cosine distance (<=>). Results sorted ascending (most similar first).
    """
    distance_expr = Candidate.embedding.cosine_distance(embedding)
    stmt = (
        select(Candidate, distance_expr.label("distance"))
        .where(Candidate.embedding.is_not(None))
        .order_by(distance_expr)
        .limit(n)
    )
    rows = await session.execute(stmt)
    results = [(row.Candidate, float(row.distance)) for row in rows]
    logger.debug("query_similar: found %d candidates", len(results))
    return results


async def get_all_candidates(session: AsyncSession) -> list[Candidate]:
    result = await session.execute(select(Candidate).order_by(Candidate.created_at.desc()))
    return list(result.scalars().all())


# ── Ranking cache repository ──────────────────────────────────────────────────

def make_ranking_cache_key(jd_text: str, candidate_ids: list[str]) -> str:
    """SHA-256 of (jd_text + sorted candidate IDs) — deterministic, order-independent."""
    payload = jd_text + "|" + ",".join(sorted(candidate_ids))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def get_ranking_cache(session: AsyncSession, cache_key: str) -> list[dict] | None:
    """
    Return cached ranking results if fresh (generation matches current).
    Returns None if missing or stale.
    """
    result = await session.execute(
        select(RankingResult).where(RankingResult.cache_key == cache_key)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None

    current_gen = await _get_candidate_generation(session)
    cached_gen = (row.result_json or {}).get("_generation")
    if cached_gen != current_gen:
        logger.debug("get_ranking_cache: stale (gen %s vs current %s)", cached_gen, current_gen)
        return None

    return row.result_json.get("results")


async def set_ranking_cache(
    session: AsyncSession,
    *,
    cache_key: str,
    jd_text: str,
    job_title: str | None,
    results: list[dict],
) -> None:
    """Store ranking result with generation stamp for future freshness validation."""
    current_gen = await _get_candidate_generation(session)
    payload = {"_generation": current_gen, "results": results}

    stmt = (
        insert(RankingResult)
        .values(
            id=uuid.uuid4(),
            cache_key=cache_key,
            job_title=job_title,
            jd_text=jd_text,
            result_json=payload,
        )
        .on_conflict_do_update(
            index_elements=["cache_key"],
            set_={"result_json": payload, "job_title": job_title},
        )
    )
    await session.execute(stmt)
    logger.debug("set_ranking_cache: cached key %s…", cache_key[:8])


# ── System state helpers ──────────────────────────────────────────────────────

async def _get_candidate_generation(session: AsyncSession) -> int:
    result = await session.execute(
        select(SystemState.value).where(SystemState.key == "candidate_generation")
    )
    val = result.scalar_one_or_none()
    return int(val) if val is not None else 0


async def _bump_candidate_generation(session: AsyncSession) -> int:
    current = await _get_candidate_generation(session)
    new_val = current + 1
    await session.execute(
        update(SystemState)
        .where(SystemState.key == "candidate_generation")
        .values(value=str(new_val))
    )
    logger.debug("_bump_candidate_generation: %d → %d", current, new_val)
    return new_val
