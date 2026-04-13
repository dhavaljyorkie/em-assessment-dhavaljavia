import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Candidate(Base):
    """
    Stores parsed resume data alongside the embedding vector.
    content_hash (SHA-256 of raw file bytes) provides idempotency:
    re-uploading the same file is a no-op.
    """

    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full structured profile extracted by GPT-4o
    parsed_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # text-embedding-3-small → 1536 dimensions
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Candidate id={self.id} name={self.name!r} file={self.filename!r}>"


class RankingResult(Base):
    """
    Cache for top-10 ranking results.
    Keyed by SHA-256(jd_text + sorted(candidate_ids)).
    Invalidated when candidate_generation (SystemState) is bumped.
    """

    __tablename__ = "ranking_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    cache_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    job_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    jd_text: Mapped[str] = mapped_column(Text, nullable=False)
    # [{candidate_id, score, reasoning, matched_skills, gaps}]
    result_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<RankingResult id={self.id} cache_key={self.cache_key!r}>"


class SystemState(Base):
    """
    Key/value store for global system state.
    candidate_generation tracks how many ingest batches have run;
    used to invalidate stale ranking caches.
    """

    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)

    def __repr__(self) -> str:
        return f"<SystemState {self.key}={self.value!r}>"
