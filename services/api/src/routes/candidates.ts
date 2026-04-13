import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { upload } from "../middleware/upload";
import { uploadToS3, BUCKET } from "../lib/s3";
import { publishIngestMessage } from "../lib/sqs";
import { getCandidates } from "../lib/pythonClient";

const router = Router();

/**
 * GET /api/candidates
 * Returns all ingested candidates (proxied from the Python processor).
 */
router.get(
  "/",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getCandidates();
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/candidates/upload
 *
 * Accepts a resume file (PDF or DOCX), uploads it to S3, then publishes an
 * SQS message so the worker picks it up asynchronously.
 *
 * Returns 202 Accepted immediately — processing is async.
 */
router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res
          .status(400)
          .json({ error: "No file uploaded. Use field name 'file'." });
        return;
      }

      const { originalname, buffer, mimetype } = req.file;
      const ext = originalname.slice(originalname.lastIndexOf("."));
      const s3Key = `resumes/${uuidv4()}${ext}`;

      // Upload to S3 (LocalStack locally, real S3 in production)
      await uploadToS3(s3Key, buffer, mimetype);

      // Publish to SQS — worker picks this up asynchronously
      await publishIngestMessage({ bucket: BUCKET, key: s3Key });

      res.status(202).json({
        message: "Resume accepted for processing.",
        s3_key: s3Key,
        original_filename: originalname,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
