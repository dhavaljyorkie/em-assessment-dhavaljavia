const BASE = "/api";

export interface UploadResponse {
  message: string;
  s3_key: string;
  original_filename: string;
}

export interface RankedCandidate {
  rank: number;
  candidate_id: string;
  name: string | null;
  email: string | null;
  score: number;
  reasoning: string;
  matched_skills: string[];
  gaps: string[];
  cosine_distance: number;
}

export interface RankResponse {
  total_ranked: number;
  results: RankedCandidate[];
}

export interface Candidate {
  candidate_id: string;
  name: string | null;
  email: string | null;
  filename: string;
  created_at: string;
}

export interface CandidatesResponse {
  total: number;
  candidates: Candidate[];
}

export async function uploadResume(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/candidates/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function rankCandidates(
  jdText: string,
  topK = 10,
): Promise<RankResponse> {
  const res = await fetch(`${BASE}/jobs/rank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jd_text: jdText, top_k: topK }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getCandidates(): Promise<CandidatesResponse> {
  const res = await fetch(`${BASE}/candidates`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
