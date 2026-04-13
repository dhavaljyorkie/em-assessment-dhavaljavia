# Design Document — Talent Intelligence & Ranking Engine

## 1. Problem Statement

Given an arbitrary set of candidate resumes (PDF/DOCX) and a natural-language job description, return the top-N most relevant candidates ranked by fit score, with human-readable reasoning, matched skills, and skill gaps — suitable for use by an HR or EM reviewer.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React UI, Vite dev server, port 5173)             │
│  - TanStack Router (client-side SPA routing)                │
│  - TanStack Query (server state, polling, mutation cache)   │
└──────────────────┬──────────────────────────────────────────┘
                   │  /api/*  (Vite proxy → localhost:3000)
┌──────────────────▼──────────────────────────────────────────┐
│  Node.js API (Express + TypeScript, port 3000)              │
│  - POST /api/candidates/upload  (multer, S3 + SQS)          │
│  - GET  /api/candidates         (proxy → processor)         │
│  - POST /api/jobs/rank          (proxy → processor)         │
└──────┬────────────────────────────────┬─────────────────────┘
       │ S3 PutObject                   │ HTTP (axios)
       ▼                                ▼
┌─────────────┐             ┌───────────────────────────────┐
│  LocalStack │             │  FastAPI Processor (port 8000) │
│  S3 + SQS   │──SQS msg───▶│  - /ingest  (direct path)     │
└─────────────┘             │  - /rank    (two-stage)        │
       │                    │  - /candidates                  │
       │                    └──────────────┬────────────────┘
       │ SQS poll                          │ SQLAlchemy 2.0 async
       ▼                                   ▼
┌─────────────────┐          ┌─────────────────────────────┐
│  SQS Worker     │          │  PostgreSQL 18 + pgvector   │
│  (same image,   │─────────▶│  - candidates (VECTOR 1536) │
│  WORKER_MODE=1) │          │  - ranking_results (cache)  │
└─────────────────┘          │  - system_state (generation)│
                             └─────────────────────────────┘
```

### Why two separate services share one Docker image

The `processor` (FastAPI) and `worker` (SQS poller) use the same Docker image differentiated only by `WORKER_MODE=true/false`. This eliminates duplication of parsing/ML code, ensures both use exactly the same library versions, and mirrors how an AWS Lambda function would be deployed — the same zip handles both synchronous API calls and SQS event source mapping triggers.

---

## 3. Ingestion Pipeline

### 3.1 Upload flow

```
Browser → POST /api/candidates/upload
        → multer (memory storage, 10 MB limit, PDF/DOCX only)
        → S3 PutObject (key: resumes/{uuid}.{ext})
        → SQS SendMessage ({bucket, key})
        → 202 Accepted  ← returned to browser immediately
```

The API layer never touches file content beyond storing it — all ML work is async. This keeps the upload latency under 500 ms regardless of file size or OpenAI API response time.

### 3.2 Worker processing (per file)

```
S3 GetObject → SHA-256 hash → idempotency check (DB)
    → parse (PDF/DOCX)
    → GPT-4o structured extraction          ← temperature=0
    → text-embedding-3-small embed          ← 1536 dims
    → upsert_candidate (ON CONFLICT DO UPDATE + bump generation)
    → SQS DeleteMessage
```

**Idempotency:** SHA-256 of raw file bytes is stored as `content_hash UNIQUE`. If the same file is uploaded twice (different S3 key/UUID), the worker detects the hash collision before calling OpenAI and logs a skip — no duplicate DB row, no wasted API cost.

### 3.3 Parser design

An extensible registry pattern maps file extensions to parser implementations:

```python
_REGISTRY = {
    ".pdf":  PDFParser(),   # pdfplumber + pytesseract OCR fallback
    ".docx": DocxParser(),  # python-docx
}
```

PDF parser uses `pdfplumber` as primary extractor. If extracted text is shorter than 50 characters (scanned PDF), it falls back to `pdf2image` + `pytesseract` OCR. This handles both digital-native and photographed resumes without requiring explicit user selection.

---

## 4. Two-Stage Ranking

The ranking approach balances cost, latency, and accuracy:

### Stage 1 — Vector ANN shortlist (pgvector)

1. Embed the raw JD text using `text-embedding-3-small`
2. Run cosine ANN search against `VECTOR(1536)` column using HNSW index
3. Return top-50 candidates by vector similarity

This stage is very fast (<50 ms) and cheap (one $0.00002 embedding call). It ensures the expensive LLM scoring only sees plausible candidates.

**Why HNSW over IVFFlat:**  
IVFFlat requires a training phase (`CREATE INDEX … WITH (lists = N)`) and degrades when `lists` is misconfigured relative to corpus size. HNSW builds incrementally with no training, tolerates small corpora (even 1 row), and achieves better recall/latency trade-offs at the scales relevant to a hiring workflow (< 100k candidates). `m=16, ef_construction=64` are conservatively high — appropriate for datasets up to ~1M rows.

### Stage 2 — GPT-4o structured scoring

All shortlisted candidates are sent in a single GPT-4o request (batch economy). The prompt asks for:

```json
[{
  "candidate_id": "...",
  "score": 0-100,
  "reasoning": "one paragraph",
  "matched_skills": ["skill1", "skill2"],
  "gaps": ["missing requirement"]
}]
```

`temperature=0` and `strict=true` JSON schema validation ensure deterministic, parseable output on every call. The result is sorted descending by score and the top-K returned.

### Ranking cache

Cache key = `sha256(jd_text + sorted(candidate_ids))`. Invalidation is generation-based: each `upsert_candidate` call increments a `system_state.ranking_generation` counter; cached results store the generation at creation time and are considered stale if it doesn't match the current generation. This means adding one new resume invalidates all cached rankings cheaply (no cache scan needed).

---

## 5. Data Model

### `candidates`

| Column                               | Type         | Notes                                      |
| ------------------------------------ | ------------ | ------------------------------------------ |
| `candidate_id`                       | UUID PK      | Generated server-side                      |
| `filename`                           | TEXT         | Original S3 key basename                   |
| `content_hash`                       | TEXT UNIQUE  | SHA-256 of raw bytes — idempotency         |
| `name`, `email`, `phone`, `location` | TEXT         | GPT-4o extracted                           |
| `parsed_json`                        | JSONB        | Full structured profile + `raw_text` field |
| `embedding`                          | VECTOR(1536) | text-embedding-3-small output              |
| `created_at`, `updated_at`           | TIMESTAMPTZ  | auto-managed                               |

HNSW index on `embedding` using cosine distance operator (`vector_cosine_ops`).

### `ranking_results`

Cache table keyed on `cache_key` (SHA-256 of JD + candidate IDs). Stores `result_json` which includes a `_generation` field for staleness checking. Unique constraint on `cache_key`.

### `system_state`

Simple key/value store (TEXT → TEXT). Used for `ranking_generation` counter. Avoids any polling or pub/sub complexity for cache invalidation.

---

## 6. Technology Decisions

### PostgreSQL + pgvector vs. dedicated vector DB (Chroma, Pinecone, Weaviate)

| Concern                               | pgvector                                            | Dedicated vector DB                 |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| Operational complexity                | Single DB for relational + vectors                  | Extra service to run/manage         |
| Transactional consistency             | ACID — vector + metadata in one transaction         | Eventual, split across two stores   |
| Filtering (e.g. by date, score range) | Standard SQL WHERE                                  | Metadata filters, varies by product |
| Scale ceiling                         | ~10M rows with HNSW, sufficient for any company ATS | Billions of rows                    |
| Cost                                  | Included in existing Postgres                       | Additional seat/hosted cost         |

For a hiring context (< 100k candidates even at large companies), pgvector covers the entire use case with zero additional operational surface.

### OpenAI model choices

| Task                  | Model                    | Rationale                                                                                                 |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Structured extraction | `gpt-4o-2024-08-06`      | Strict JSON schema support (`response_format`), best instruction-following                                |
| Scoring / reasoning   | `gpt-4o-2024-08-06`      | Consistent 0-100 scoring, nuanced gap analysis                                                            |
| Embeddings            | `text-embedding-3-small` | 1536 dims, 5× cheaper than `large`, benchmarks show marginal recall difference for structured resume text |

All LLM calls use `temperature=0` for deterministic, reproducible output — critical for a ranking system where the same candidate should score the same across re-runs.

### Lambda architecture (local vs. production)

The SQS worker (`lambda_handler.py`) exposes two entry points:

- `handler(event, context)` — standard Lambda handler, invoked by SQS Event Source Mapping in production
- `run_worker()` — local long-polling loop used in Docker Compose

The identical `_handle_event()` function is called by both. This means production and local Docker behaviour is bit-for-bit equivalent — no "works locally, fails on Lambda" surprises. Switching to production Lambda deployment requires only packaging the same image as a Lambda container image and adding an ESM trigger.

### Node.js API as gateway layer

The Express API deliberately contains no business logic — it is purely a gateway:

- Handles multipart upload (multer)
- Writes to S3 + SQS (decoupling upload from processing)
- Proxies ranking/candidate queries to the Python processor

This separates concerns cleanly: TypeScript handles I/O and protocol concerns; Python handles all ML/AI work. The gateway can be swapped for API Gateway + Lambda in production without touching any Python code.

### React UI: TanStack Router + TanStack Query

- **TanStack Router** — type-safe file-based routing with `beforeLoad` redirect (`/` → `/upload`). Avoids React Router's looser type story for a small SPA.
- **TanStack Query** — `useQuery` for the candidates list (with `refetchInterval: 5000` to poll DB count as worker processes files), `useMutation` for uploads and ranking. Provides loading/error states, automatic retry, and stale-while-revalidate — appropriate for an async processing system where results arrive seconds after the trigger.
- **No state management library** — TanStack Query's server-state cache is sufficient. No Redux/Zustand needed.

---

## 7. Security Decisions

- **File type validation**: multer middleware checks both MIME type and file extension (`.pdf`, `.docx` only). Files are stored in S3 and never executed.
- **No direct DB exposure**: the browser never touches PostgreSQL or the Python processor directly; all traffic flows through the Express API layer.
- **Secrets via env file**: `OPENAI_API_KEY` and `LOCALSTACK_AUTH_TOKEN` are in `.env.local` (`.gitignore`d) and injected as environment variables — not hardcoded.
- **Input size limits**: multer enforces a 10 MB file size cap; extractor truncates raw text to 12k chars before sending to GPT-4o (prevents prompt injection via malicious resume content and controls token cost).
- **OWASP Top 10**: no SQL string interpolation (SQLAlchemy ORM + parameterised queries); no eval/exec on file content; no credentials in logs.

---

## 8. Known Limitations & Production Gaps

| Limitation                                             | Production Mitigation                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| LocalStack ephemeral state — S3/SQS lost on restart    | Use real AWS S3 + SQS (env var swap only)                                  |
| No authentication on any endpoint                      | Add JWT/OAuth middleware to Express API                                    |
| Worker processes one message at a time                 | Increase `MaxNumberOfMessages=10` + `asyncio.gather` batch                 |
| OpenAI rate limits can slow ingestion of large batches | Exponential backoff + DLQ already handles retries; add concurrency limiter |
| HNSW index not built until first row inserted          | Pre-warm with a dummy row on container start                               |
| GPT-4o scoring prompt fits ~30 candidates in context   | Paginate scorer for corpora > 30 shortlisted candidates                    |
| Ranking cache never pruned                             | Add TTL column + periodic cleanup job                                      |

---

## 9. Scalability Path

```
Current (POC)              →  Production
──────────────────────────────────────────────────────────
Docker Compose             →  ECS Fargate (processor) + Lambda (worker)
LocalStack S3/SQS          →  Real AWS S3 + SQS
Single worker container    →  Lambda concurrency (auto-scales with queue depth)
PostgreSQL on Docker       →  RDS PostgreSQL 16 + pgvector extension
Vite dev server            →  Static build → S3 + CloudFront
Express API                →  API Gateway + Lambda (or keep ECS)
No auth                    →  Cognito / Auth0 JWT
```

The entire codebase uses env vars for all external endpoints (`AWS_ENDPOINT_URL`, `DATABASE_URL`, `PROCESSOR_URL`). Switching from LocalStack to real AWS is a single `.env` change with zero code modifications.

---

## 10. File Structure

```
.
├── docker-compose.yml          # All backend services
├── .env.example                # Template — copy to .env.local
├── generate_samples.py         # Generates 22 synthetic DOCX resumes
├── data/
│   ├── resumes/                # PDF + DOCX input files
│   └── jobs/                   # Sample JD text files
├── infra/
│   ├── postgres/init/          # pgvector extension SQL, Alembic placeholder
│   └── localstack/init/        # 01_resources.sh — creates S3 bucket + SQS queues
├── services/
│   ├── processor/              # Python FastAPI + SQS worker
│   │   ├── main.py             # FastAPI entrypoint
│   │   ├── lambda_handler.py   # SQS Lambda handler + local poller
│   │   ├── alembic/            # DB migrations
│   │   └── src/
│   │       ├── parsers/        # PDF (pdfplumber + OCR) + DOCX parsers
│   │       ├── pipeline/       # GPT-4o extractor + embedder
│   │       ├── storage/        # SQLAlchemy models, async DB, repository
│   │       └── ranking/        # Two-stage engine + GPT-4o scorer
│   ├── api/                    # Node.js Express gateway (TypeScript)
│   │   └── src/
│   │       ├── routes/         # candidates.ts, jobs.ts
│   │       ├── middleware/     # upload.ts (multer)
│   │       └── lib/            # s3.ts, sqs.ts, pythonClient.ts
│   └── ui/                     # React + Vite frontend
│       └── src/
│           ├── router.tsx      # TanStack Router
│           ├── api.ts          # fetch wrappers
│           ├── components/     # Layout
│           └── routes/         # UploadPage.tsx, RankPage.tsx
└── docs/screenshots/           # UI screenshots
```
