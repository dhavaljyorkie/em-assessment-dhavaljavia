"""Alembic async environment.

Uses SQLAlchemy 2.0 async engine so no psycopg2 driver is required —
asyncpg is the only PostgreSQL driver needed.

Run migrations:
    cd services/processor
    alembic upgrade head
    alembic downgrade -1
    alembic revision --autogenerate -m "description"
"""

import asyncio
import os
import sys
from logging.config import fileConfig

# Ensure the src/ package is importable when Alembic runs from any working directory.
# Must be inserted BEFORE any src.* imports.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy import pool

# Import Base so Alembic can diff metadata for --autogenerate
from src.storage.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    url = os.environ["DATABASE_URL"]
    # Normalise to asyncpg scheme
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


# ── Offline mode (generates SQL without a live connection) ────────────────────

def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (runs against a live database) ────────────────────────────────

def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = get_url()

    connectable = async_engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
