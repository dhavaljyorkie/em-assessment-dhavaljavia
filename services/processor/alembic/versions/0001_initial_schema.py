"""Initial schema — candidates, ranking_results, system_state.

Revision ID: 0001
Revises:
Create Date: 2026-04-13

Notes:
- pgvector extension is enabled by infra/postgres/init/01_extensions.sql
  (Docker entrypoint) before this migration runs.
- HNSW index is used for ANN cosine search — no `lists` tuning required,
  better recall vs IVFFlat for datasets up to a few million vectors.
- Downgrade fully reverses all DDL (tables, indexes, trigger, function).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── candidates ────────────────────────────────────────────────────────────
    op.create_table(
        "candidates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),   # SHA-256 of raw bytes
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("parsed_json", postgresql.JSONB(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("content_hash", name="uq_candidates_content_hash"),
    )

    # HNSW index for ANN cosine similarity (pgvector ≥ 0.5)
    # Better recall than IVFFlat; no per-insert training, no lists parameter.
    # Increase m / ef_construction in a future migration if recall degrades at scale.
    op.execute(
        """
        CREATE INDEX candidates_embedding_hnsw_idx
        ON candidates
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )

    # Partial index for fast idempotency lookups by content hash
    op.create_index(
        "candidates_content_hash_idx",
        "candidates",
        ["content_hash"],
    )

    # updated_at trigger function (shared by all tables that need it)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )

    op.execute(
        """
        CREATE TRIGGER candidates_set_updated_at
        BEFORE UPDATE ON candidates
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    # ── ranking_results ───────────────────────────────────────────────────────
    op.create_table(
        "ranking_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        # SHA-256( jd_text || sorted(candidate_ids) ) — deterministic cache key
        sa.Column("cache_key", sa.Text(), nullable=False),
        sa.Column("job_title", sa.Text(), nullable=True),
        sa.Column("jd_text", sa.Text(), nullable=False),
        # [{candidate_id, score, reasoning, matched_skills, gaps}]
        sa.Column("result_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("cache_key", name="uq_ranking_results_cache_key"),
    )

    op.create_index(
        "ranking_results_cache_key_idx",
        "ranking_results",
        ["cache_key"],
    )

    # ── system_state ──────────────────────────────────────────────────────────
    # candidate_generation: incremented on every ingest batch to invalidate
    # stale ranking_results cache entries.
    op.create_table(
        "system_state",
        sa.Column("key", sa.Text(), primary_key=True, nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
    )

    op.execute(
        """
        INSERT INTO system_state (key, value)
        VALUES ('candidate_generation', '0')
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS candidates_set_updated_at ON candidates")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at")
    op.drop_table("system_state")
    op.drop_index("ranking_results_cache_key_idx", table_name="ranking_results")
    op.drop_table("ranking_results")
    op.drop_index("candidates_content_hash_idx", table_name="candidates")
    op.drop_index("candidates_embedding_hnsw_idx", table_name="candidates")
    op.drop_table("candidates")
