"""
Two-stage ranking engine.

Stage 1 — Vector shortlist:
    Embed the job description text → pgvector ANN query → top-50 candidates
    (fast, scales to 50k+ candidates with HNSW index)

Stage 2 — LLM re-ranking:
    Pass shortlisted 50 candidate profiles to GPT-4o scorer in one call
    → deterministic scores with reasoning, matched skills, and gaps
    → return top-10

Results are cached in PostgreSQL (ranking_results table) keyed by
SHA-256(jd_text + sorted(candidate_ids)). Cache is invalidated when
new resumes are ingested (candidate_generation counter bump).
"""

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from src.pipeline.embedder import embed
from src.pipeline.extractor import extract_job_description
from src.ranking.scorer import score_candidates
from src.storage.repository import (
    get_ranking_cache,
    make_ranking_cache_key,
    query_similar,
    set_ranking_cache,
)

logger = logging.getLogger(__name__)

_SHORTLIST_SIZE = 50
_TOP_K = 10


@dataclass
class RankedCandidate:
    candidate_id: str
    name: str | None
    email: str | None
    score: float
    reasoning: str
    matched_skills: list[str]
    gaps: list[str]
    cosine_distance: float


async def rank(
    session: AsyncSession,
    jd_text: str,
    top_k: int = _TOP_K,
) -> list[RankedCandidate]:
    """
    Rank candidates against a job description and return the top-k matches.

    Steps:
      1. Extract structured JD profile (GPT-4o)
      2. Embed JD text (text-embedding-3-small)
      3. ANN vector search → shortlist top-50 from pgvector
      4. Check ranking cache — return cached result if fresh
      5. GPT-4o batch score all 50 shortlisted candidates
      6. Merge scores with candidate metadata, sort, return top-k
      7. Cache result for future identical queries
    """
    # Step 1 — Extract JD structure
    jd_profile = await extract_job_description(jd_text)
    logger.info("rank: JD extracted — title='%s'", jd_profile.get("title"))

    # Step 2 — Embed JD
    jd_embedding, _ = await embed(jd_text)

    # Step 3 — Vector shortlist
    similar: list[tuple[Any, float]] = await query_similar(session, jd_embedding, n=_SHORTLIST_SIZE)
    if not similar:
        logger.warning("rank: no candidates found in vector store")
        return []

    candidate_ids = [str(c.id) for c, _ in similar]
    distance_map = {str(c.id): dist for c, dist in similar}
    candidate_map = {str(c.id): c for c, _ in similar}

    # Step 4 — Cache check
    cache_key = make_ranking_cache_key(jd_text, candidate_ids)
    cached = await get_ranking_cache(session, cache_key)
    if cached is not None:
        logger.info("rank: returning cached result (%d items)", len(cached))
        return _build_ranked_list(cached[:top_k], candidate_map, distance_map)

    # Step 5 — LLM scoring
    candidates_for_scoring = [
        (str(c.id), c.parsed_json) for c, _ in similar
    ]
    scores = await score_candidates(jd_profile, candidates_for_scoring)

    # Step 6 — Cache & return
    await set_ranking_cache(
        session,
        cache_key=cache_key,
        jd_text=jd_text,
        job_title=jd_profile.get("title"),
        results=scores,
    )
    await session.commit()

    logger.info("rank: scored %d candidates, returning top %d", len(scores), top_k)
    return _build_ranked_list(scores[:top_k], candidate_map, distance_map)


def _build_ranked_list(
    scores: list[dict],
    candidate_map: dict[str, Any],
    distance_map: dict[str, float],
) -> list[RankedCandidate]:
    result = []
    for s in scores:
        cid = s["candidate_id"]
        candidate = candidate_map.get(cid)
        if candidate is None:
            continue
        result.append(
            RankedCandidate(
                candidate_id=cid,
                name=candidate.name,
                email=candidate.email,
                score=s["score"],
                reasoning=s["reasoning"],
                matched_skills=s["matched_skills"],
                gaps=s["gaps"],
                cosine_distance=distance_map.get(cid, 1.0),
            )
        )
    return result
