import json
import logging
import os
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

# ── Schemas ───────────────────────────────────────────────────────────────────

_CANDIDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "name":             {"type": ["string", "null"]},
        "email":            {"type": ["string", "null"]},
        "phone":            {"type": ["string", "null"]},
        "location":         {"type": ["string", "null"]},
        "summary":          {"type": ["string", "null"]},
        "skills":           {"type": "array", "items": {"type": "string"}},
        "years_experience": {"type": ["number", "null"]},
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "degree":      {"type": ["string", "null"]},
                    "institution": {"type": ["string", "null"]},
                    "year":        {"type": ["string", "null"]},
                },
                "required": ["degree", "institution", "year"],
                "additionalProperties": False,
            },
        },
        "experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title":       {"type": ["string", "null"]},
                    "company":     {"type": ["string", "null"]},
                    "duration":    {"type": ["string", "null"]},
                    "description": {"type": ["string", "null"]},
                },
                "required": ["title", "company", "duration", "description"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "name", "email", "phone", "location", "summary",
        "skills", "years_experience", "education", "experience",
    ],
    "additionalProperties": False,
}

_JD_SCHEMA = {
    "type": "object",
    "properties": {
        "title":                {"type": ["string", "null"]},
        "summary":              {"type": ["string", "null"]},
        "required_skills":      {"type": "array", "items": {"type": "string"}},
        "nice_to_have_skills":  {"type": "array", "items": {"type": "string"}},
        "min_experience_years": {"type": ["number", "null"]},
        "education_requirement": {"type": ["string", "null"]},
        "responsibilities": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": [
        "title", "summary", "required_skills", "nice_to_have_skills",
        "min_experience_years", "education_requirement", "responsibilities",
    ],
    "additionalProperties": False,
}

# ── Internal helper ───────────────────────────────────────────────────────────

async def _extract(system_prompt: str, user_content: str, schema: dict) -> dict[str, Any]:
    """
    Single GPT-4o structured-output call.
    temperature=0 for deterministic, reproducible results.
    """
    response = await _client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        temperature=0,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "extraction",
                "strict": True,
                "schema": schema,
            },
        },
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
    )
    raw = response.choices[0].message.content or "{}"
    return json.loads(raw)


# ── Public API ────────────────────────────────────────────────────────────────

async def extract_candidate(raw_text: str) -> dict[str, Any]:
    """
    Parse raw resume text into a structured candidate profile.
    Returns a dict matching _CANDIDATE_SCHEMA.
    """
    system_prompt = (
        "You are an expert resume parser. "
        "Extract all structured information from the resume text provided. "
        "Be precise — do not infer information not present in the text. "
        "Return null for any field that cannot be determined."
    )
    try:
        result = await _extract(system_prompt, raw_text[:12000], _CANDIDATE_SCHEMA)
        logger.info("extract_candidate: extracted profile for '%s'", result.get("name"))
        return result
    except Exception as exc:
        logger.error("extract_candidate: failed: %s", exc)
        raise


async def extract_job_description(raw_text: str) -> dict[str, Any]:
    """
    Parse raw job description text into a structured JD profile.
    Returns a dict matching _JD_SCHEMA.
    """
    system_prompt = (
        "You are an expert job description parser. "
        "Extract all structured information from the job description text provided. "
        "Separate required skills from nice-to-have skills carefully. "
        "Return null for any field that cannot be determined."
    )
    try:
        result = await _extract(system_prompt, raw_text[:12000], _JD_SCHEMA)
        logger.info("extract_job_description: extracted JD '%s'", result.get("title"))
        return result
    except Exception as exc:
        logger.error("extract_job_description: failed: %s", exc)
        raise
