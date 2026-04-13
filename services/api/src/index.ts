import express, { NextFunction, Request, Response } from "express";
import candidatesRouter from "./routes/candidates";
import jobsRouter from "./routes/jobs";

const app = express();
const port = parseInt(process.env.API_PORT ?? "3000", 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/candidates", candidatesRouter);
app.use("/api/jobs", jobsRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Internal server error" });
});

app.listen(port, () => {
  console.log(`Talent API listening on port ${port}`);
});
