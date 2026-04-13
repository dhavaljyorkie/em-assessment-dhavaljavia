"""
GPT-4o batch scorer.

Takes a job description profile and up to 50 candidate profiles and returns
a scored list in a single API call.

Design choices:
- temperature=0 for deterministic, reproducible output across identical inputs
- Strict JSON schema (response_format=json_schema) — 100% schema adherence
- Candidates are summarised to key fields before sending to keep prompt size manageable
  (avoids context window issues when all 50 full profiles are included)
"""

import json
import logging
import os
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

_SCORER_SCHEMA = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_id":    {"type": "string"},
                    "score":           {"type": "number"},      # 0–100
                    "reasoning":       {"type": "string"},
                    "matched_skills":  {"type": "array", "items": {"type": "string"}},
                    "gaps":            {"type": "array", "items": {"type": "string"}},
                },
                "required": ["candidate_id", "score", "reasoning", "matched_skills", "gaps"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["scores"],
    "additionalProperties": False,
}


def _summarise_candidate(candidate_id: str, parsed_json: dict[str, Any]) -> dict:
    """Reduce a full candidate profile to only the fields relevant for scoring."""
    return {
        "candidate_id":     candidate_id,
        "name":             parsed_json.get("name"),
        "skills":           parsed_json.get("skills", []),
        "years_experience": parsed_json.get("years_experience"),
        "education":        [
            e.get("degree") for e in (parsed_json.get("education") or [])
        ],
        "recent_roles":     [
            {"title": e.get("title"), "company": e.get("company")}
            for e in (parsed_json.get("experience") or [])[:3]
        ],
        "summary":          (parsed_json.get("summary") or "")[:500],
    }


async def score_candidates(
    jd_profile: dict[str, Any],
    candidates: list[tuple[str, dict[str, Any]]],  # [(candidate_id, parsed_json)]
) -> list[dict]:
    """
    Score all candidates against the job description in a single GPT-4o call.

    Returns:
        List of scoring dicts sorted descending by score:
        [{candidate_id, score, reasoning, matched_skills, gaps}]
    """
    summarised = [_summarise_candidate(cid, profile) for cid, profile in candidates]

    system_prompt = (
        "You are an expert technical recruiter. "
        "Score each candidate from 0 to 100 based on how well they match the job description. "
        "Consider: skill overlap, years of experience vs requirement, education, seniority. "
        "Be objective and critical. A score of 70+ means a strong match. "
        "Return scores for ALL candidates provided."
    )

    user_content = (
        f"## Job Description\n{json.dumps(jd_profile, indent=2)}\n\n"
        f"## Candidates\n{json.dumps(summarised, indent=2)}"
    )

    response = await _client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        temperature=0,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "candidate_scores",
                "strict": True,
                "schema": _SCORER_SCHEMA,
            },
        },
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
    )

    raw = response.choices[0].message.content or '{"scores": []}'
    result = json.loads(raw)
    scores: list[dict] = result.get("scores", [])

    # Sort descending by score
    scores.sort(key=lambda x: x["score"], reverse=True)
    logger.info("score_candidates: scored %d candidates", len(scores))
    return scores
