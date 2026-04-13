# Talent Intelligence & Ranking Engine

AI-powered resume ingestion and candidate ranking POC.  
Parses PDF/DOCX resumes → extracts structured profiles via GPT-4o → stores embeddings in pgvector → ranks candidates against a job description using two-stage retrieval (ANN shortlist → LLM scoring).

## Prerequisites

| Tool           | Version  | Notes                               |
| -------------- | -------- | ----------------------------------- |
| Docker Desktop | ≥ 4.x    | Needed for all backend services     |
| Node.js        | ≥ 22     | For the React UI only               |
| pnpm           | ≥ 9      | `npm i -g pnpm`                     |
| Python 3.12    | optional | Only if regenerating sample resumes |

Copy the environment file and add your keys:

```bash
cp .env.example .env.local
# Edit .env.local and set:
#   OPENAI_API_KEY=sk-...
#   LOCALSTACK_AUTH_TOKEN=ls-...   (free token from app.localstack.cloud)
```

---

## Start the backend (single command)

```bash
docker compose --env-file .env.local up -d --build
```

This starts five services:

| Service      | URL                   | Role                               |
| ------------ | --------------------- | ---------------------------------- |
| `postgres`   | port 5420             | PostgreSQL 18 + pgvector           |
| `localstack` | port 4566             | S3 + SQS (AWS emulation)           |
| `processor`  | http://localhost:8000 | FastAPI — extract, embed, rank     |
| `worker`     | —                     | SQS poller — ingests resumes async |
| `api`        | http://localhost:3000 | Node.js REST API (upload, rank)    |

Alembic runs automatically inside the processor container on first start.  
LocalStack auto-creates the S3 bucket and SQS queues via `infra/localstack/init/01_resources.sh`.

---

## Start the UI

```bash
cd services/ui
pnpm install   # first time only
pnpm dev
```

Open **http://localhost:5173**

---

## Using the UI

### Tab 1 — Upload Resumes

Drag-and-drop or click to select multiple PDF/DOCX resumes.  
Hit **Upload** — files are accepted immediately (202) and processed in the background by the worker (GPT-4o extraction + embedding, ~30–60 s per file).  
The candidate counter at the bottom auto-refreshes every 5 s.

### Tab 2 — Rank Candidates

Paste a job description, set how many top candidates to return, and click **Find Top Candidates**.  
Returns a ranked list with AI scores (0–100), matched skills, and gap analysis.

**Sample JDs to try** (copy-paste into the Rank tab):

<details>
<summary>Engineering Manager — Backend Infrastructure</summary>

```
Engineering Manager — Backend Infrastructure

We are looking for an experienced Engineering Manager to lead our Backend Infrastructure team of 8–12 engineers.

Required
- 3+ years in an Engineering Manager or Tech Lead role
- 7+ years of software engineering experience
- Strong backend engineering background (Python, Go, or Java)
- Experience with distributed systems and cloud infrastructure (AWS preferred)
- Proven ability to hire and retain senior engineers
```

</details>

<details>
<summary>Senior iOS Engineer</summary>

```
Senior iOS Engineer

Required
- 5+ years of iOS development (Swift, SwiftUI)
- Experience shipping apps with 1M+ users
- Strong grasp of Core Data, Xcode Instruments, Fastlane CI/CD
```

</details>

<details>
<summary>Staff Security Engineer</summary>

```
Staff Security Engineer

Required
- 7+ years in application security
- Threat modelling, SAST/DAST, penetration testing
- SOC2 Type II or ISO 27001 certification experience
- Python or Rust for security tooling
```

</details>

---

## Generate / refresh sample resumes

```bash
pip3 install python-docx
python3 generate_samples.py
```

Produces 22 diverse DOCX resumes across SWE (Python/Go, Java, .NET, iOS, Android, Rust, Rails, Embedded, QA, Web3), ML, DevOps, Security, HR, Finance, Product, Marketing, and BizOps roles in `data/resumes/`.

---

## Useful commands

```bash
# Check all containers are healthy
docker compose --env-file .env.local ps

# Watch worker ingest logs in real time
docker compose --env-file .env.local logs -f worker

# Reset the database and start fresh
docker compose --env-file .env.local exec -T postgres \
  psql -U talent -d talent_intelligence \
  -c "TRUNCATE TABLE ranking_results, candidates RESTART IDENTITY CASCADE;"

# If LocalStack loses state after a restart (NoSuchBucket errors)
docker compose --env-file .env.local restart localstack
```

---

## Architecture overview

```
Browser → React UI (Vite, port 5173)
              │  /api/*  (proxy)
              ▼
     Node.js API (Express, port 3000)
       ├─ POST /api/candidates/upload → S3 upload → SQS publish
       ├─ GET  /api/candidates        → proxy → FastAPI
       └─ POST /api/jobs/rank         → proxy → FastAPI
              │
    ┌─────────┴──────────┐
    │                    │
SQS Worker          FastAPI Processor (port 8000)
(lambda_handler)    ├─ /ingest  — direct ingest
    │               ├─ /rank    — two-stage ranking
    │               ├─ /candidates
    └───────────────┘
              │  SQLAlchemy 2.0 async
              ▼
   PostgreSQL 18 + pgvector (port 5420)
```

**Two-stage ranking:**

1. Embed the JD → cosine ANN search in pgvector (top 50 candidates)
2. GPT-4o scores each shortlisted candidate 0–100 with reasoning, matched skills, and gaps  
   Results are cached per (JD, candidate set) and invalidated whenever new resumes are ingested.
