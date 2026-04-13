import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandOutput,
} from "@aws-sdk/client-sqs";

const sqs = new SQSClient({
  region: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  ...(process.env.AWS_ENDPOINT_URL && {
    endpoint: process.env.AWS_ENDPOINT_URL,
  }),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  },
});

const QUEUE_URL =
  process.env.SQS_QUEUE_URL ??
  "http://localhost:4566/000000000000/document-processing-queue";

export interface IngestMessage {
  bucket: string;
  key: string;
}

export async function publishIngestMessage(
  msg: IngestMessage,
): Promise<SendMessageCommandOutput> {
  return sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(msg),
    }),
  );
}
