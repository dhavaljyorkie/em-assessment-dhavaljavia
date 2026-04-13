"""
SQS Lambda handler — document ingestion worker.

Entry point for both:
  - AWS Lambda (invoked via SQS Event Source Mapping in production)
  - Local Docker container SQS poller (started by run_worker() for the POC)

Event shape expected from SQS:
    {
        "Records": [
            {
                "body": "{\"bucket\": \"talent-raw-docs\", \"key\": \"resumes/file.pdf\"}"
            }
        ]
    }
"""

import asyncio
import hashlib
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import boto3
from botocore.config import Config

from src.parsers.registry import get_parser
from src.pipeline.embedder import embed
from src.pipeline.extractor import extract_candidate
from src.storage.db import AsyncSessionLocal
from src.storage.repository import get_candidate_by_hash, upsert_candidate

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ── AWS clients ───────────────────────────────────────────────────────────────

_aws_config = Config(retries={"max_attempts": 3, "mode": "standard"})
_endpoint_url = os.environ.get("AWS_ENDPOINT_URL")  # set to LocalStack URL locally

s3_client = boto3.client(
    "s3",
    endpoint_url=_endpoint_url,
    region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    config=_aws_config,
)

sqs_client = boto3.client(
    "sqs",
    endpoint_url=_endpoint_url,
    region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    config=_aws_config,
)

_SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "")


# ── Core processing logic ─────────────────────────────────────────────────────

async def process_record(bucket: str, key: str) -> None:
    """
    Full ingestion pipeline for a single document:
      1. Download file from S3
      2. Compute content hash — skip if already processed (idempotency)
      3. Parse raw text (PDF or DOCX)
      4. Extract structured profile via GPT-4o
      5. Generate embedding via text-embedding-3-small
      6. Upsert candidate into PostgreSQL
    """
    filename = key.split("/")[-1]
    logger.info("process_record: starting — bucket=%s key=%s", bucket, key)

    # 1. Download from S3
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        file_bytes: bytes = response["Body"].read()
    except Exception as exc:
        logger.error("process_record: S3 download failed for s3://%s/%s — %s", bucket, key, exc)
        raise

    # 2. Content hash — idempotency check
    content_hash = hashlib.sha256(file_bytes).hexdigest()
    async with AsyncSessionLocal() as session:
        existing = await get_candidate_by_hash(session, content_hash)
        if existing is not None:
            logger.info(
                "process_record: skipping '%s' — already processed (hash=%s…)",
                filename,
                content_hash[:8],
            )
            return

    # 3. Parse
    try:
        parser = get_parser(filename)
        raw_text = parser.parse(file_bytes, filename=filename)
    except ValueError as exc:
        logger.error("process_record: unsupported format for '%s': %s", filename, exc)
        raise
    except Exception as exc:
        logger.error("process_record: parsing failed for '%s': %s", filename, exc)
        raise

    if not raw_text.strip():
        logger.warning("process_record: empty text extracted from '%s' — skipping.", filename)
        return

    # 4. Extract structured profile
    parsed_json = await extract_candidate(raw_text)
    # Preserve raw text for full-text search / future use
    parsed_json["raw_text"] = raw_text[:8000]

    # 5. Generate embedding
    embedding, _ = await embed(raw_text)

    # 6. Upsert into DB
    async with AsyncSessionLocal() as session:
        await upsert_candidate(
            session,
            filename=filename,
            content_hash=content_hash,
            parsed_json=parsed_json,
            embedding=embedding,
        )
        await session.commit()

    logger.info("process_record: completed for '%s'", filename)


async def _handle_event(event: dict) -> dict:
    """Process a batch of SQS records. Failures are raised to trigger SQS retry / DLQ."""
    records = event.get("Records", [])
    logger.info("_handle_event: processing %d record(s)", len(records))

    for record in records:
        try:
            body = json.loads(record["body"])
        except (KeyError, json.JSONDecodeError) as exc:
            logger.error("_handle_event: malformed SQS record body: %s", exc)
            raise

        bucket = body.get("bucket")
        key = body.get("key")
        if not bucket or not key:
            logger.error("_handle_event: missing bucket/key in body: %s", body)
            raise ValueError(f"Invalid message body: {body}")

        await process_record(bucket, key)

    return {"statusCode": 200, "processed": len(records)}


# ── Lambda entry point ────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    """
    AWS Lambda handler — invoked by SQS Event Source Mapping.
    Same function runs unchanged on LocalStack via cdklocal deploy.
    """
    return asyncio.run(_handle_event(event))


# ── Local SQS poller (POC / Docker) ──────────────────────────────────────────

async def _poll_sqs() -> None:
    """
    Long-poll SQS queue and process messages.
    Architecturally identical to Lambda+ESM — same handler, same event shape.
    Used in the Docker POC where Lambda zip deployment is not warranted.
    """
    logger.info("SQS poller started — queue: %s", _SQS_QUEUE_URL)
    while True:
        try:
            resp = sqs_client.receive_message(
                QueueUrl=_SQS_QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=20,  # long-poll
                VisibilityTimeout=120,
            )
            messages = resp.get("Messages", [])
            if not messages:
                continue

            event = {"Records": [{"body": m["Body"]} for m in messages]}
            try:
                await _handle_event(event)
                # Delete successfully processed messages
                for m in messages:
                    sqs_client.delete_message(
                        QueueUrl=_SQS_QUEUE_URL,
                        ReceiptHandle=m["ReceiptHandle"],
                    )
            except Exception as exc:
                logger.error("_poll_sqs: batch processing failed, messages will re-queue: %s", exc)
                # Do NOT delete — SQS will redeliver up to maxReceiveCount, then DLQ

        except Exception as exc:
            logger.error("_poll_sqs: receive_message error: %s", exc)
            await asyncio.sleep(5)


def run_worker() -> None:
    """Start the local SQS poller. Called from Docker CMD when WORKER_MODE=true."""
    asyncio.run(_poll_sqs())


if __name__ == "__main__":
    run_worker()
