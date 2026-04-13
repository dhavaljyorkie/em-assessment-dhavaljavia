#!/bin/sh
# LocalStack ready.d hook — runs automatically when LocalStack is healthy.
# Creates the S3 bucket and SQS queue used by the pipeline.
# This is a stop-gap until the CDK stack (infra/cdk/) is authored.
# Once `cdklocal deploy` is wired up, these resources will be managed by CDK instead.

set -e

BUCKET="${S3_BUCKET:-talent-raw-docs}"
QUEUE="${SQS_QUEUE_NAME:-document-processing-queue}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENDPOINT="http://localhost:4566"

echo "==> Creating S3 bucket: $BUCKET"
awslocal s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  $([ "$REGION" != "us-east-1" ] && echo "--create-bucket-configuration LocationConstraint=$REGION" || true)

echo "==> Creating SQS queue: $QUEUE"
awslocal sqs create-queue \
  --queue-name "$QUEUE" \
  --region "$REGION"

# Dead-letter queue for failed processing messages
echo "==> Creating SQS DLQ: ${QUEUE}-dlq"
awslocal sqs create-queue \
  --queue-name "${QUEUE}-dlq" \
  --region "$REGION"

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/${QUEUE}-dlq" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "==> Attaching DLQ to main queue (maxReceiveCount=3)"
awslocal sqs set-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/$QUEUE" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

echo "==> LocalStack init complete. Resources:"
echo "    S3:  s3://$BUCKET"
echo "    SQS: $ENDPOINT/000000000000/$QUEUE"
echo "    DLQ: $ENDPOINT/000000000000/${QUEUE}-dlq"
