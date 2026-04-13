import axios, { AxiosInstance } from "axios";

const PROCESSOR_URL = process.env.PROCESSOR_URL ?? "http://localhost:8000";

const client: AxiosInstance = axios.create({
  baseURL: PROCESSOR_URL,
  timeout: 120_000, // LLM calls can take up to 60s; give headroom
  headers: { "Content-Type": "application/json" },
});

export interface RankRequest {
  jd_text: string;
  top_k?: number;
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

export async function rankCandidates(req: RankRequest): Promise<RankResponse> {
  const { data } = await client.post<RankResponse>("/rank", req);
  return data;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const { data } = await client.get("/health");
    return data?.status === "ok";
  } catch {
    return false;
  }
}
