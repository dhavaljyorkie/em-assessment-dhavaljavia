# Plan: Talent Intelligence & Ranking Engine

## Tech Stack Decisions

| Layer                   | Technology                          | Reason                                                                                                                   |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| AI/ML/Parsing           | Python                              | Natural fit for LLM, embeddings, document parsing                                                                        |
| API Gateway             | TypeScript/Node.js (Express)        | Clean REST API layer, strong typing                                                                                      |
| Document Parsing (PDF)  | pdfplumber + Tesseract OCR fallback | Best text/table extraction; OCR for scanned PDFs                                                                         |
| Document Parsing (DOCX) | python-docx                         | Industry standard, stable                                                                                                |
| Embeddings              | OpenAI text-embedding-3-small       | 8x cheaper than large, sufficient quality at POC scale                                                                   |
| Vector Store + Metadata | PostgreSQL 18 + pgvector extension  | Single DB for vectors + metadata; identical SQL locally (Docker) and in production (RDS) — zero code change between envs |
| LLM Scoring             | GPT-4o (structured outputs, temp=0) | Reproducible + auditable rankings                                                                                        |
| AWS Simulation          | LocalStack v3 + cdklocal            | Same CDK stack deployed locally via `cdklocal deploy` and to AWS via `cdk deploy`                                        |
| Infrastructure as Code  | AWS CDK (TypeScript)                | Single stack definition — `cdklocal deploy` for local dev, `cdk deploy` for production                                   |

---

## Architecture Overview

```
INGESTION FLOW

  Candidate
    │
    ▼
  POST /api/candidates/upload  (Node.js API)
    │
    ├──► PUT object to LocalStack S3 (talent-raw-docs bucket)
    │
    └──► Publish {bucket, key} message to LocalStack SQS (document-processing-queue)
                │
                │  [SQS holds message; Lambda Event Source Mapping (configured in CDK)
                │   polls SQS internally and invokes Lambda — API never calls Lambda directly]
                ▼
          Lambda document-processor (Python) — invoked by Event Source Mapping
                │
                ├──► Download file from S3
                ├──► Parse (pdfplumber / python-docx / registry)
                ├──► LLM extract structured profile (GPT-4o, temp=0)
                ├──► Embed raw text (text-embedding-3-small)
                └──► Upsert vector + metadata → PostgreSQL (pgvector)
                     (candidates table: embedding vector(1536), parsed_json, content_hash)


RANKING FLOW

  HR Recruiter
    │
    ▼
  POST /api/jobs/rank  (Node.js API)
    │
    ▼
  POST /rank  (Python FastAPI)
    │
    ├── 1. Extract JD structure (GPT-4o)
    ├── 2. Embed JD text (text-embedding-3-small)
    ├── 3. pgvector ANN query → top 50 candidates  (SELECT ... ORDER BY embedding <=> $1 LIMIT 50)
    ├── 4. Fetch full candidate JSON from PostgreSQL (same DB, 50 records)
    ├── 5. GPT-4o structured batch scoring (temp=0)
    │        └─► [{candidate_id, score(0-100), reasoning, matched_skills[], gaps[]}]
    ├── 6. Sort by score → return top 10
    └── 7. Cache result in SQLite ranking_results (hash-keyed)
```

---

## File Structure

```
/
├── docker-compose.yml              # Orchestrates: LocalStack, PostgreSQL 18 + pgvector, Python processor, Node.js API
├── .env.example                    # OPENAI_API_KEY, AWS_ENDPOINT_URL, etc.
├── DESIGN.md                       # Architecture + scaling + failure modes
├── plan.md                         # This file
├── README.md
│
├── infra/
│   └── cdk/                        # AWS CDK stack (TypeScript)
│       ├── bin/app.ts              # CDK app entry point
│       ├── lib/talent-stack.ts     # S3 bucket, SQS queue + DLQ, Lambda + Event Source Mapping, RDS (prod) / env-switched connection (local)
│       ├── package.json
│       └── tsconfig.json
│
├── services/
│   ├── api/                        # Node.js / TypeScript
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # Express app entry point
│   │       ├── routes/
│   │       │   ├── candidates.ts   # POST /api/candidates/upload
│   │       │   └── jobs.ts         # POST /api/jobs/rank, GET /api/jobs/:id/results
│   │       ├── lib/
│   │       │   ├── s3.ts           # AWS SDK v3 S3 client (LocalStack endpoint)
│   │       │   ├── sqs.ts          # AWS SDK v3 SQS client (LocalStack endpoint)
│   │       │   └── pythonClient.ts # axios HTTP client → Python FastAPI
│   │       └── middleware/
│   │           └── upload.ts       # multer file upload middleware
│   │
│   └── processor/                  # Python
│       ├── requirements.txt
│       ├── main.py                 # FastAPI app (sync/direct access)
│       ├── lambda_handler.py       # SQS Lambda event consumer
│       └── src/
│           ├── parsers/
│           │   ├── base.py         # Abstract BaseParser
│           │   ├── pdf_parser.py   # pdfplumber + OCR fallback
│           │   ├── docx_parser.py  # python-docx
│           │   └── registry.py     # Extension → parser factory
│           ├── pipeline/
│           │   ├── extractor.py    # GPT-4o structured extraction (resume + JD)
│           │   └── embedder.py     # text-embedding-3-small + content-hash cache
│           ├── storage/
│           │   └── db.py           # PostgreSQL + pgvector (candidates table with vector(1536), ranking_results cache)
│           └── ranking/
│               ├── engine.py       # Two-stage ranking orchestrator
│               └── scorer.py       # GPT-4o batch scorer (strict JSON schema)
│
└── data/
    ├── resumes/                    # Sample input resumes (PDF/DOCX)
    └── jobs/                       # Sample job descriptions
```

---

## Build Phases

### Phase 1 — Infrastructure & Scaffold

- [x] `docker-compose.yml` — LocalStack, PostgreSQL 18 + pgvector (`pgvector/pgvector:pg18` image), Python processor, Node.js API
- [ ] `infra/cdk/lib/talent-stack.ts` — CDK stack defining S3 bucket `talent-raw-docs`, SQS queue `document-processing-queue` + DLQ, Lambda `document-processor` (Python 3.12, ARM64, SnapStart) with SQS Event Source Mapping _(deferred — gated by `--profile cdk`; resources provisioned by `infra/localstack/init/01_resources.sh` in the interim)_
- [ ] `infra/cdk/bin/app.ts` — CDK app entry point _(deferred)_
- [x] LocalStack resources bootstrapped via `infra/localstack/init/01_resources.sh` — S3 bucket, SQS queue + DLQ auto-created on container startup
- [x] `.env.example` / `.env.local` — all env vars configured
- [x] PostgreSQL 18 + pgvector running on port 5420
- [x] Alembic migrations applied — `candidates`, `ranking_results`, `system_state` tables created with HNSW index
- [x] All 4 containers healthy: `postgres`, `localstack`, `processor`, `api`

### Phase 2 — Python Processor Service _(complete)_

- [x] `src/parsers/base.py` — abstract `BaseParser` with `parse(bytes) → str`
- [x] `src/parsers/pdf_parser.py` — pdfplumber primary, Tesseract OCR fallback on empty text
- [x] `src/parsers/docx_parser.py` — python-docx (paragraphs + table cells)
- [x] `src/parsers/registry.py` — `{".pdf": PDFParser, ".docx": DocxParser}` factory
- [x] `src/pipeline/extractor.py` — GPT-4o structured extraction (`temperature=0`, strict JSON schema)
- [x] `src/pipeline/embedder.py` — text-embedding-3-small + content-hash + 24k char truncation
- [x] `src/storage/repository.py` — `upsert_candidate`, `query_similar` (pgvector `<=>`), ranking cache with generation-based invalidation
- [x] `src/storage/db.py` — async engine + `AsyncSessionLocal` + `get_db()` FastAPI dependency

### Phase 3 — Lambda / SQS Worker _(complete)_

- [x] `lambda_handler.py` — SQS event → S3 download → parse → extract → embed → store (idempotent via content hash)
- [x] `handler()` entrypoint compatible with AWS Lambda (real + LocalStack), no code change between envs
- [x] `run_worker()` local SQS long-poller — same logic, same event shape as Lambda ESM
- [x] `WORKER_MODE=true/false` Docker env var — processor image serves as both FastAPI and worker
- [x] Separate `worker` service added to `docker-compose.yml` alongside `processor`
- [x] CDK `talent-stack.ts` wires SQS as Lambda Event Source Mapping _(deferred — gated by `--profile cdk`)_

### Phase 4 — Python Ranking Engine _(complete)_

- [x] `src/ranking/scorer.py` — GPT-4o batch scorer, single call for all 50 candidates, strict JSON schema, `temperature=0`
- [x] `src/ranking/engine.py` — `rank(session, jd_text, top_k) → List[RankedCandidate]`; two-stage: pgvector ANN → GPT-4o score → top-k
- [x] `main.py` — FastAPI endpoints: `POST /ingest`, `POST /rank`, `GET /candidates`, `GET /health`

### Phase 5 — Node.js / TypeScript API _(complete)_

- [x] `src/lib/s3.ts` — AWS SDK v3 S3 client; `forcePathStyle` for LocalStack; `AWS_ENDPOINT_URL` switches between LocalStack and real AWS
- [x] `src/lib/sqs.ts` — AWS SDK v3 SQS client; `publishIngestMessage({bucket, key})`
- [x] `src/lib/pythonClient.ts` — axios client to Python FastAPI; `rankCandidates()`, `healthCheck()`
- [x] `src/middleware/upload.ts` — multer memory storage; PDF + DOCX whitelist; 10 MB limit
- [x] `src/routes/candidates.ts` — `POST /api/candidates/upload` → S3 + SQS → `202 Accepted`
- [x] `src/routes/jobs.ts` — `POST /api/jobs/rank` → proxies to Python `/rank` → top-10 response
- [x] `src/index.ts` — Express app, routes, 404, global error handler; TypeScript compiles clean

### Phase 6 — DESIGN.md

- [ ] System architecture diagram (Mermaid)
- [ ] Full data flow (ingestion + ranking)
- [ ] Cold start accuracy explanation
- [ ] Production scaling path (S3, SQS+DLQ, Lambda with SnapStart + ARM64 + Layers, RDS PostgreSQL 18 + pgvector, OpenAI Batch API)
- [ ] ECS Fargate escape hatch documentation (when to migrate from Lambda at extreme sustained load)
- [ ] Known failure modes

### Phase 7 — Integration Verification

- [ ] `docker compose up` — all services start
- [ ] Upload 8–10 sample resumes → verify SQS → Lambda → PostgreSQL (candidates table + pgvector index) populated
- [ ] Call rank endpoint with sample JD → verify Top 10 with scores + reasoning
- [ ] Re-upload same resume → verify idempotency (no duplicate embedding)

---

## Key Design Decisions & Rationale

### Two-Stage Ranking (not embeddings-only)

Pure cosine similarity is fast but can miss context — e.g., a candidate with "Python" skills ranking high for a Python role even if they lack seniority or domain fit. GPT-4o re-ranking on the shortlisted 50 adds structured reasoning: skill match depth, experience seniority, explicit gaps. This is reproducible because `temperature=0` + strict JSON schema = deterministic output for the same input.

### Cold Start Accuracy

The system has **no cold start problem** because ranking is based purely on semantic matching, not historical signals. A brand-new JD is embedded and compared to all candidate vectors immediately. There is no collaborative filtering or prior match data required. The LLM scoring step evaluates JD requirements directly against candidate profiles — it reasons from content, not history.

### CDK-First Infrastructure (Local + Production Parity)

The CDK stack (`infra/cdk/lib/talent-stack.ts`) is the single source of truth for all infrastructure — S3, SQS + DLQ, Lambda, and RDS. Locally, `cdklocal deploy` deploys the exact same stack to LocalStack, so the dev environment mirrors production with no hand-crafted shell scripts or manual resource creation. The only difference between environments is the `AWS_ENDPOINT_URL` env var (`http://localhost:4566` locally, omitted in production to use real AWS). `cdklocal` is the `aws-cdk-local` npm package — a thin CDK CLI wrapper that redirects all CloudFormation calls to LocalStack.

### Lambda as Primary Compute

Lambda is the preferred compute for the document processor. It scales to zero (no idle cost), auto-scales per SQS message batch, and the SQS Event Source Mapping handles concurrency automatically. If sustained throughput ever exceeds Lambda's limits at extreme scale, ECS Fargate with an SQS poller is the documented escape hatch — the same `lambda_handler.py` entry point works as-is in both models, no code change required.

### Lambda Cold Start Mitigation

Cold starts for Python ML Lambdas can reach 3–8s without mitigation. The following are configured in the CDK stack:

1. **SnapStart** (`snapStart: SnapStartConf.ON_PUBLISHED_VERSIONS`) — Python 3.12+, snapshots the initialized execution environment, reduces cold start to ~200ms
2. **Lambda Layers** — heavy deps (pdfplumber, psycopg2, openai) packaged as a shared layer; reduces per-deploy artifact size and speeds init
3. **ARM64 / Graviton2** (`architecture: Architecture.ARM_64`) — ~34% better price-performance, marginally faster init

**Provisioned Concurrency** is _not_ enabled for the POC (unnecessary cost at this scale). To enable if cold starts become an issue in production, add the following to `talent-stack.ts`:

```typescript
// infra/cdk/lib/talent-stack.ts
const alias = processorFn.addAlias("live");
const scaling = alias.addAutoScaling({ minCapacity: 2, maxCapacity: 10 });
scaling.scaleOnUtilization({ utilizationTarget: 0.5 });
```

### Ranking Result Caching & Invalidation

Re-running a rank query for the same JD is deterministic but costs OpenAI API calls. Results are cached in the PostgreSQL `ranking_results` table keyed by `hash(jd_text + sorted(candidate_ids))`. Cache is invalidated when new candidates are ingested (generation counter bump), ensuring freshness at the cost of one re-rank on next query.

---

## Environment Variables

```env
# OpenAI
OPENAI_API_KEY=<provided>

# LocalStack / AWS
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=us-east-1
S3_BUCKET=talent-raw-docs
SQS_QUEUE_URL=http://localhost:4566/000000000000/document-processing-queue

# Database (PostgreSQL + pgvector — Docker locally, RDS PostgreSQL 18 in production)
DATABASE_URL=postgresql://talent:talent_secret@localhost:5420/talent_intelligence

# Services
PROCESSOR_URL=http://localhost:8000
API_PORT=3000
PROCESSOR_PORT=8000
```

---

## Production Scaling Considerations (documented per assessment requirements)

| POC (LocalStack)                   | Production (AWS)                                                   |
| ---------------------------------- | ------------------------------------------------------------------ |
| LocalStack S3 (via cdklocal)       | AWS S3 with lifecycle policies                                     |
| LocalStack SQS (via cdklocal)      | AWS SQS + Dead Letter Queue (DLQ)                                  |
| Lambda via cdklocal + LocalStack   | AWS Lambda — same CDK stack, `cdk deploy`                          |
| Lambda: SnapStart + ARM64 + Layers | Same; add Provisioned Concurrency for guaranteed sub-200ms         |
| PostgreSQL + pgvector (Docker)     | Amazon RDS PostgreSQL 18 + pgvector extension                      |
| OpenAI real-time embeds            | OpenAI Batch API (50% cost reduction, async 24h processing)        |
| Single-node ranking (FastAPI)      | Distributed workers, ranking results cached via ElastiCache        |
| Lambda (primary compute)           | ECS Fargate + SQS poller (escape hatch for extreme sustained load) |

---

## Open Questions / Risks

1. **Scanned PDFs**: pdfplumber returns empty text on image-based PDFs. Tesseract OCR fallback adds `pytesseract` + `pdf2image` + system Tesseract binary. **Decision: include with warning log.**

2. **Token limits on long resumes**: text-embedding-3-small has 8192 token context. Resumes exceeding this will be truncated. **Mitigation: chunk + average pooling if text > 6000 tokens.**

3. **GPT-4o batch scoring with 50 candidates**: a single prompt with 50 full candidate profiles + JD could exceed context window. **Mitigation: summarise each candidate to key fields (skills, years_exp, education) before passing to scorer — done in `extractor.py`.**

4. **Lambda cold start latency**: Python ML Lambda cold starts can be 3–8s without mitigation. **Mitigations applied in CDK stack: SnapStart (Python 3.12, ~200ms), Lambda Layers (deps as shared layer), ARM64/Graviton2. Provisioned Concurrency is _not_ enabled for POC — see Key Design Decisions > Lambda Cold Start Mitigation for the exact CDK snippet to enable it when needed.**

5. **Ranking cache staleness**: cached results for a JD become stale after new resumes are ingested. **Mitigation: generation counter invalidation pattern.**
