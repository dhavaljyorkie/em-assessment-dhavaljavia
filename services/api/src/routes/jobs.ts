import { Router, Request, Response, NextFunction } from "express";
import { upload } from "../middleware/upload";
import { rankCandidates } from "../lib/pythonClient";

const router = Router();

/**
 * POST /api/jobs/rank
 *
 * Accepts a job description as either:
 *   - JSON body: { "jd_text": "...", "top_k": 10 }
 *   - File upload: field name 'jd_file' (PDF or DOCX — processor extracts text)
 *
 * Proxies the ranking request to the Python processor and returns the top-k
 * ranked candidates with scores, reasoning, matched skills, and gaps.
 */
router.post(
  "/rank",
  upload.single("jd_file"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let jdText: string | undefined;
      const topK: number = parseInt(req.body?.top_k ?? "10", 10);

      if (req.file) {
        // File upload path — send raw bytes as base64 to processor
        // For simplicity, we use the text extraction in the processor via /ingest-jd
        // In this POC the JD is text-only in the rank endpoint; file uploads are for resumes.
        res.status(400).json({
          error:
            "JD file upload is not supported on this endpoint. " +
            "Please provide 'jd_text' as a JSON body field, or paste the JD text directly.",
        });
        return;
      }

      jdText = req.body?.jd_text as string | undefined;

      if (!jdText || !jdText.trim()) {
        res
          .status(400)
          .json({ error: "'jd_text' is required in the request body." });
        return;
      }

      const result = await rankCandidates({ jd_text: jdText, top_k: topK });
      res.json(result);
    } catch (err: any) {
      // Surface processor errors clearly
      if (err?.response?.data) {
        res.status(err.response.status ?? 502).json({
          error: "Processor error",
          detail: err.response.data,
        });
        return;
      }
      next(err);
    }
  },
);

export default router;
