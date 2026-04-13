import multer, { FileFilterCallback } from "multer";
import { Request } from "express";

const ALLOWED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx"]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  const ext = file.originalname
    .toLowerCase()
    .slice(file.originalname.lastIndexOf("."));
  if (ALLOWED_MIMETYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type '${ext}'. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      ),
    );
  }
}

// Store file in memory — passed directly to S3 upload, no disk writes
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
});
