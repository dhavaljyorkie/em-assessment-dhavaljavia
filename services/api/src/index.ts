import express from "express";

const app = express();
const port = parseInt(process.env.API_PORT ?? "3000", 10);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Talent API listening on port ${port}`);
});
