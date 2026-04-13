FROM python:3.12-slim

# System deps for pdfplumber, pytesseract, psycopg (asyncpg build deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run Alembic migrations then start in the appropriate mode:
#   WORKER_MODE=true  → SQS poller (lambda_handler.run_worker)
#   WORKER_MODE=false → FastAPI via uvicorn (default)
CMD ["sh", "-c", "\
  alembic upgrade head && \
  if [ \"$WORKER_MODE\" = 'true' ]; then \
    python lambda_handler.py; \
  else \
    uvicorn main:app --host 0.0.0.0 --port ${PROCESSOR_PORT:-8000}; \
  fi \
"]
