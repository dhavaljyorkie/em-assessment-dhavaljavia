import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hashlib
import logging
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.parsers.registry import get_parser, supported_extensions
from src.pipeline.embedder import embed
from src.pipeline.extractor import extract_candidate
from src.ranking.engine import rank
from src.storage.db import get_db
from src.storage.repository import get_all_candidates, upsert_candidate

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Talent Intelligence Processor", version="0.1.0")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ── Ingest (synchronous — for direct uploads / testing) ──────────────────────

@app.post("/ingest", status_code=201)
async def ingest(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Synchronously parse, extract, embed and store a resume.
    Used for direct testing; in production the async SQS worker handles this.
    """
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in supported_extensions():
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Supported: {supported_extensions()}",
        )

    file_bytes = await file.read()
    content_hash = hashlib.sha256(file_bytes).hexdigest()

    # Parse
    parser = get_parser(filename)
    raw_text = parser.parse(file_bytes, filename=filename)
    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from the file.")

    # Extract + embed
    parsed_json = await extract_candidate(raw_text)
    parsed_json["raw_text"] = raw_text[:8000]
    embedding, _ = await embed(raw_text)

    # Store
    candidate = await upsert_candidate(
        session,
        filename=filename,
        content_hash=content_hash,
        parsed_json=parsed_json,
        embedding=embedding,
    )

    return {
        "candidate_id": str(candidate.id),
        "name": candidate.name,
        "email": candidate.email,
        "filename": filename,
    }


# ── Rank ──────────────────────────────────────────────────────────────────────

class RankRequest(BaseModel):
    jd_text: str
    top_k: int = 10


@app.post("/rank")
async def rank_candidates(
    body: RankRequest,
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Rank all indexed candidates against the given job description.
    Returns the top-k matches with score, reasoning, matched skills, and gaps.
    """
    if not body.jd_text.strip():
        raise HTTPException(status_code=422, detail="jd_text cannot be empty.")

    top_k = max(1, min(body.top_k, 20))  # cap at 20
    results = await rank(session, body.jd_text, top_k=top_k)

    return {
        "total_ranked": len(results),
        "results": [
            {
                "rank":             i + 1,
                "candidate_id":     r.candidate_id,
                "name":             r.name,
                "email":            r.email,
                "score":            r.score,
                "reasoning":        r.reasoning,
                "matched_skills":   r.matched_skills,
                "gaps":             r.gaps,
                "cosine_distance":  round(r.cosine_distance, 4),
            }
            for i, r in enumerate(results)
        ],
    }


# ── Candidates list ───────────────────────────────────────────────────────────

@app.get("/candidates")
async def list_candidates(
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return all indexed candidates (metadata only, no embeddings)."""
    candidates = await get_all_candidates(session)
    return {
        "total": len(candidates),
        "candidates": [
            {
                "candidate_id": str(c.id),
                "name":         c.name,
                "email":        c.email,
                "filename":     c.filename,
                "created_at":   c.created_at.isoformat(),
            }
            for c in candidates
        ],
    }

