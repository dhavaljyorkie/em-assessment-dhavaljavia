# Plan: Talent Intelligence & Ranking Engine

## Tech Stack Decisions

| Layer                   | Technology                          | Reason                                                 |
| ----------------------- | ----------------------------------- | ------------------------------------------------------ |
| AI/ML/Parsing           | Python                              | Natural fit for LLM, embeddings, document parsing      |
| API Gateway             | TypeScript/Node.js (Express)        | Clean REST API layer, strong typing                    |
| Document Parsing (PDF)  | pdfplumber + Tesseract OCR fallback | Best text/table extraction; OCR for scanned PDFs       |
| Document Parsing (DOCX) | python-docx                         | Industry standard, stable                              |
| Embeddings              | OpenAI text-embedding-3-small       | 8x cheaper than large, sufficient quality at POC scale |
| Vector Store            | ChromaDB (local)                    | Simple setup, built-in metadata filtering, cloud path  |
| Metadata Store          | SQLite                              | Lightweight, no infra, flat-file equivalent            |
| LLM Scoring             | GPT-4o (structured outputs, temp=0) | Reproducible + auditable rankings                      |
| AWS Simulation          | LocalStack v3 (free tier)           | S3 + SQS + Lambda — no license needed for POC          |

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
                ▼
          Lambda / SQS Consumer (Python)
                │
                ├──► Download file from S3
                ├──► Parse (pdfplumber / python-docx / registry)
                ├──► LLM extract structured profile (GPT-4o, temp=0)
                ├──► Embed raw text (text-embedding-3-small)
                ├──► Upsert vector → ChromaDB
                └──► Store metadata JSON → SQLite


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
    ├── 3. ANN query ChromaDB → top 50 candidates
    ├── 4. Fetch full candidate JSON from SQLite (50 records)
    ├── 5. GPT-4o structured batch scoring (temp=0)
    │        └─► [{candidate_id, score(0-100), reasoning, matched_skills[], gaps[]}]
    ├── 6. Sort by score → return top 10
    └── 7. Cache result in SQLite ranking_results (hash-keyed)
```

---

## File Structure

```
/
├── docker-compose.yml              # Orchestrates all services + LocalStack
├── .env.example                    # OPENAI_API_KEY, AWS_ENDPOINT_URL, etc.
├── DESIGN.md                       # Architecture + scaling + failure modes
├── plan.md                         # This file
├── README.md
│
├── infra/
│   └── localstack/
│       ├── init-aws.sh             # Creates S3 bucket, SQS queue, deploys Lambda
│       └── lambda/                 # Lambda deployment artifacts
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
│           │   ├── vector_store.py # ChromaDB wrapper (upsert, query top-N)
│           │   └── metadata_db.py  # SQLite (candidates, ranking_results tables)
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

- [ ] `docker-compose.yml` — LocalStack, Python processor, Node.js API containers
- [ ] `infra/localstack/init-aws.sh` — creates S3 bucket `talent-raw-docs`, SQS queue `document-processing-queue`, deploys Lambda with SQS event source
- [ ] `.env.example` — `OPENAI_API_KEY`, `AWS_ENDPOINT_URL=http://localhost:4566`, bucket/queue names, `CHROMA_PATH`, `SQLITE_PATH`

### Phase 2 — Python Processor Service

- [ ] `src/parsers/base.py` — abstract `BaseParser` with `parse(bytes) → str`
- [ ] `src/parsers/pdf_parser.py` — pdfplumber primary, Tesseract OCR fallback on empty text
- [ ] `src/parsers/docx_parser.py` — python-docx
- [ ] `src/parsers/registry.py` — `{".pdf": PDFParser, ".docx": DocxParser}` factory
- [ ] `src/pipeline/extractor.py` — GPT-4o JSON schema extraction (`temperature=0`)
  - Resume schema: `{name, email, skills[], years_experience, education[], summary, raw_text}`
  - JD schema: `{title, required_skills[], nice_to_have_skills[], min_experience, summary}`
- [ ] `src/pipeline/embedder.py` — text-embedding-3-small + content-hash dedup cache
- [ ] `src/storage/vector_store.py` — ChromaDB collection `candidates`
- [ ] `src/storage/metadata_db.py` — SQLite `candidates` + `ranking_results` tables

### Phase 3 — Lambda / SQS Worker

- [ ] `lambda_handler.py` — SQS event → S3 download → parse → extract → embed → store
  - Idempotent via content hash (skip if already processed)
- [ ] **POC note**: For LocalStack POC, run as a long-running container polling SQS via `boto3` instead of true zip-deployed Lambda (avoids 50MB zip with all ML deps). Document production Lambda deployment in DESIGN.md.

### Phase 4 — Python Ranking Engine

- [ ] `src/ranking/engine.py` — `rank(jd_text, top_k=10) → List[RankedCandidate]`
  - ANN shortlist (top 50 from ChromaDB) → GPT-4o batch score → top 10
- [ ] `src/ranking/scorer.py` — single GPT-4o call, all 50 candidates, strict JSON schema, `temperature=0`
  - Cache key: `hash(jd_text + sorted(candidate_ids))`
- [ ] `main.py` — FastAPI endpoints: `POST /rank`, `POST /ingest`, `GET /candidates`

### Phase 5 — Node.js / TypeScript API

- [ ] `src/lib/s3.ts` — AWS SDK v3 S3 client with LocalStack `endpoint`
- [ ] `src/lib/sqs.ts` — AWS SDK v3 SQS client
- [ ] `src/lib/pythonClient.ts` — axios client for Python FastAPI
- [ ] `src/routes/candidates.ts` — `POST /api/candidates/upload` → S3 + SQS → `202 Accepted`
- [ ] `src/routes/jobs.ts` — `POST /api/jobs/rank` → Python `/rank` → top 10 response
- [ ] `src/index.ts` — Express app, routes, error middleware

### Phase 6 — DESIGN.md

- [ ] System architecture diagram (Mermaid)
- [ ] Full data flow (ingestion + ranking)
- [ ] Cold start accuracy explanation
- [ ] Production scaling path (S3, SQS+DLQ, Lambda, Pinecone/OpenSearch, Aurora Serverless)
- [ ] Known failure modes

### Phase 7 — Integration Verification

- [ ] `docker compose up` — all services start
- [ ] Upload 8–10 sample resumes → verify SQS → Lambda → ChromaDB populated
- [ ] Call rank endpoint with sample JD → verify Top 10 with scores + reasoning
- [ ] Re-upload same resume → verify idempotency (no duplicate embedding)

---

## Key Design Decisions & Rationale

### Two-Stage Ranking (not embeddings-only)

Pure cosine similarity is fast but can miss context — e.g., a candidate with "Python" skills ranking high for a Python role even if they lack seniority or domain fit. GPT-4o re-ranking on the shortlisted 50 adds structured reasoning: skill match depth, experience seniority, explicit gaps. This is reproducible because `temperature=0` + strict JSON schema = deterministic output for the same input.

### Cold Start Accuracy

The system has **no cold start problem** because ranking is based purely on semantic matching, not historical signals. A brand-new JD is embedded and compared to all candidate vectors immediately. There is no collaborative filtering or prior match data required. The LLM scoring step evaluates JD requirements directly against candidate profiles — it reasons from content, not history.

### LocalStack Lambda vs Container SQS Poller

True Lambda zip deployment with Python ML dependencies (pdfplumber, chromadb, openai) creates a ~50MB+ artifact that is cumbersome to package and redeploy during development. For the POC, the processor runs as a Docker container with a `boto3`-based SQS polling loop — architecturally identical to Lambda (same code, same event schema), but faster to iterate on locally. The `lambda_handler.py` entrypoint is written to also work as a real Lambda deployment with no code changes.

### Ranking Result Caching & Invalidation

Re-running a rank query for the same JD is deterministic but costs OpenAI API calls. Results are cached in SQLite keyed by `hash(jd_text + sorted(candidate_ids))`. Cache is invalidated when new candidates are ingested (generation counter bump), ensuring freshness at the cost of one re-rank on next query.

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

# Storage
CHROMA_PATH=./data/chroma
SQLITE_PATH=./data/talent.db

# Services
PROCESSOR_URL=http://localhost:8000
API_PORT=3000
PROCESSOR_PORT=8000
```

---

## Production Scaling Considerations (documented per assessment requirements)

| POC (LocalStack)        | Production (AWS)                                     |
| ----------------------- | ---------------------------------------------------- |
| LocalStack S3           | AWS S3 with lifecycle policies                       |
| LocalStack SQS          | AWS SQS + Dead Letter Queue (DLQ)                    |
| Container SQS poller    | AWS Lambda with SQS trigger, reserved concurrency    |
| ChromaDB (local file)   | Pinecone or AWS OpenSearch with kNN                  |
| SQLite                  | Amazon Aurora Serverless v2 (PostgreSQL)             |
| OpenAI real-time embeds | OpenAI Batch API (50% cost reduction, async)         |
| Single-node ranking     | Distributed workers, ranking results via ElastiCache |

---

## Open Questions / Risks

1. **Scanned PDFs**: pdfplumber returns empty text on image-based PDFs. Tesseract OCR fallback adds `pytesseract` + `pdf2image` + system Tesseract binary. **Decision: include with warning log.**

2. **Token limits on long resumes**: text-embedding-3-small has 8192 token context. Resumes exceeding this will be truncated. **Mitigation: chunk + average pooling if text > 6000 tokens.**

3. **GPT-4o batch scoring with 50 candidates**: a single prompt with 50 full candidate profiles + JD could exceed context window. **Mitigation: summarise each candidate to key fields (skills, years_exp, education) before passing to scorer — done in `extractor.py`.**

4. **Lambda cold start latency**: Python ML Lambda cold starts can be 10–30s. **Mitigation: provisioned concurrency in production; document in DESIGN.md.**

5. **Ranking cache staleness**: cached results for a JD become stale after new resumes are ingested. **Mitigation: generation counter invalidation pattern.**
