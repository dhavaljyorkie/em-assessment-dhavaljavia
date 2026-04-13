-- Tables are managed by Alembic migrations (services/processor/alembic/).
-- Run: cd services/processor && alembic upgrade head
--
-- Only the pgvector extension (01_extensions.sql) is bootstrapped here via
-- Docker init because the extension must exist before Alembic can reference
-- the Vector type in migrations.
--
-- Useful commands:
--   alembic upgrade head                              # apply all pending migrations
--   alembic downgrade -1                             # roll back one revision
--   alembic revision --autogenerate -m "description" # generate a new migration

SELECT 1; -- no-op, intentional placeholder
