# Talent Intelligence & Ranking Engine

AI-powered resume ingestion and candidate ranking POC.  
Parses PDF/DOCX resumes → extracts structured profiles via GPT-4o → stores embeddings in pgvector → ranks candidates against a job description using two-stage retrieval (ANN shortlist → LLM scoring).

---

## Screenshots

### Rank tab — Engineering Manager JD

Maria Santos ranked #1 (score 90) — management experience + Python/Java/AWS
![EM ranking](docs/screenshots/Screenshot%202026-04-13%20at%2012.13.35%20PM.png)

### Rank tab — Senior iOS Engineer JD

Yuki Tanaka ranked #1 (score 90) — Swift, SwiftUI, ARKit, Airbnb/Pinterest pedigree
![iOS ranking](docs/screenshots/Screenshot%202026-04-13%20at%2012.14.37%20PM.png)

### Rank tab — Staff Security Engineer JD (top 10)

James Park ranked #1 (score 95) — SAST/DAST, OWASP, SOC2, ISO 27001
![Security ranking top 10](docs/screenshots/Screenshot%202026-04-13%20at%2012.15.21%20PM.png)

### Rank tab — Staff Security Engineer JD (top 5)

Same JD narrowed to 5 candidates — James Park #1, Elena Volkov #2
![Security ranking top 5](docs/screenshots/Screenshot%202026-04-13%20at%2012.16.11%20PM.png)

---

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
# Edit .env.local — two values to fill in:
#   OPENAI_API_KEY=sk-...
#   LOCALSTACK_AUTH_TOKEN=ls-...   (free token at app.localstack.cloud)
```

---

## Start everything (two commands)

**Backend** — one command starts all five services:

```bash
docker compose --env-file .env.local up -d --build
```

| Service      | URL                   | Role                               |
| ------------ | --------------------- | ---------------------------------- |
| `postgres`   | port 5420             | PostgreSQL 18 + pgvector           |
| `localstack` | port 4566             | S3 + SQS (AWS emulation)           |
| `processor`  | http://localhost:8000 | FastAPI — extract, embed, rank     |
| `worker`     | —                     | SQS poller — ingests resumes async |
| `api`        | http://localhost:3000 | Node.js REST API                   |

**UI** — runs locally outside Docker:

```bash
cd services/ui && pnpm install && pnpm dev
```

Open **http://localhost:5173**

---

## How to use the UI

### Step 1 — Upload resumes

1. Click the **Upload Resumes** tab
2. Drag-and-drop or click to pick one or more PDF/DOCX files (multi-select supported)
3. Click **Upload** — each file gets immediately accepted (HTTP 202) and queued
4. The worker processes each file in the background: parse → GPT-4o extract → embed → store (~30–60 s per file)
5. Watch the **"N candidates in the database"** counter at the bottom tick up as files complete

> Tip: upload a mix of different roles to get diverse ranking results.

---

### Step 2 — Rank candidates against a JD

1. Click the **Rank Candidates** tab
2. Paste a job description into the text area (plain text, any format)
3. Set the **Show top N** number (default 10)
4. Click **Find Top Candidates**
5. Results appear with:
   - **Score (0–100)** — colour-coded: green ≥75, yellow ≥50, red <50
   - **AI reasoning** — one-paragraph explanation of fit
   - **Matched skills** — green chips for each aligned skill
   - **Gaps** — what the candidate is missing for this role

---

### Example prompts to try

**1. Engineering Manager — Backend Infrastructure**

```
Engineering Manager — Backend Infrastructure

We are looking for an experienced Engineering Manager to lead our Backend Infrastructure team of 8–12 engineers. You will drive technical strategy, grow the team, and ensure reliable delivery of the systems that power our product.

Required
- 3+ years in an Engineering Manager or Tech Lead role
- 7+ years of software engineering experience
- Strong backend engineering background (Python, Go, or Java)
- Experience with distributed systems and cloud infrastructure (AWS preferred)
- Proven ability to hire and retain senior engineers
- Track record of shipping high-quality, high-scale software
```

**Expected #1:** Maria Santos (score ~90) or Ben Okafor (score ~85)

---

**2. Senior iOS Engineer**

```
Senior iOS Engineer

We are building a consumer-facing iOS app used by millions. We need a seasoned iOS engineer who can own features end-to-end.

Required
- 5+ years of iOS development experience
- Expert-level Swift and SwiftUI
- Strong grasp of UIKit, Core Data, and Xcode Instruments
- Experience shipping apps with 1M+ users
- Familiarity with CI/CD (Fastlane, GitHub Actions)

Nice to Have
- ARKit or Vision framework experience
- Experience with performance profiling and reducing app launch time
```

**Expected #1:** Yuki Tanaka (score ~90)

---

**3. Staff Security Engineer**

```
Staff Security Engineer

We are looking for a Staff Security Engineer to lead application security across our product suite.

Required
- 7+ years in application security or information security
- Strong experience with threat modelling, SAST/DAST tooling, and penetration testing
- Hands-on with OWASP Top 10 mitigations
- Experience achieving SOC2 Type II or ISO 27001 certification
- Proficiency in Python or Rust for security tooling

Nice to Have
- Cloud security (AWS IAM, Security Hub, GuardDuty)
- Experience in identity / access management products
```

**Expected #1:** James Park (score ~95)

---

**4. ML Engineer — Recommendations**

```
ML Engineer — Recommendations Platform

We are looking for a machine learning engineer to build and maintain our real-time recommendation systems.

Required
- 4+ years of ML engineering experience
- Proficiency in Python and a deep learning framework (PyTorch or TensorFlow)
- Experience deploying models to production at scale
- Familiarity with feature stores, model monitoring, and A/B testing
- Experience with distributed data processing (Spark, Kafka, or Flink)

Nice to Have
- Experience with NLP or large language models
- AWS SageMaker or similar managed ML platform
```

**Expected #1:** Priya Nair (score ~90)

---

**5. Try a non-technical role to test noise rejection**

```
Senior HR Business Partner

We are looking for an experienced HRBP to partner with our Engineering organisation.

Required
- 5+ years as an HR Business Partner or HR Manager
- Experience supporting a 200+ person engineering organisation
- Expertise in performance management, compensation benchmarking, and DEI programs
- Proficiency with Workday or similar HRIS
```

**Expected:** Rachel Kim near the top; software engineers and finance candidates scored low — demonstrating the engine doesn't just keyword-match titles.

---

## Generate / refresh sample resumes

The repo ships with a script that generates 22 diverse synthetic DOCX resumes:

```bash
pip3 install python-docx
python3 generate_samples.py
# Output: data/resumes/*.docx  +  data/jobs/engineering_manager_backend.txt
```

Roles covered: SWE (Python/Go, Java/Kafka, .NET/C#, iOS/Swift, Android/Kotlin, Ruby/Rails, Rust/Systems, Embedded C/C++, Full-Stack TS, QA/SDET, Web3/Solidity), ML/Data Science, DevOps/SRE, Security, HR/Talent, Finance/FP&A, Product Management, Marketing/Growth, Business Operations.

---

## Useful commands

```bash
# Check all containers are healthy
docker compose --env-file .env.local ps

# Watch worker ingest logs in real time
docker compose --env-file .env.local logs -f worker

# Reset the database (wipe all candidates + cached rankings)
docker compose --env-file .env.local exec -T postgres \
  psql -U talent -d talent_intelligence \
  -c "TRUNCATE TABLE ranking_results, candidates RESTART IDENTITY CASCADE;"

# If LocalStack loses state after restart (NoSuchBucket in logs)
docker compose --env-file .env.local restart localstack

# Rebuild a single service after code changes
docker compose --env-file .env.local up -d --build processor worker api
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
    │               └─ /candidates
    └───────────────┘
              │  SQLAlchemy 2.0 async (asyncpg)
              ▼
   PostgreSQL 18 + pgvector (port 5420)
```

**Two-stage ranking:**

1. Embed the JD → cosine ANN search in pgvector HNSW index (top 50 shortlist)
2. GPT-4o scores each shortlisted candidate 0–100 with reasoning, matched skills, and gaps

Results are cached keyed on `sha256(jd_text + sorted_candidate_ids)` and invalidated automatically whenever a new resume is ingested (generation counter).

See [DESIGN.md](DESIGN.md) for full architecture rationale and design decisions.

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
