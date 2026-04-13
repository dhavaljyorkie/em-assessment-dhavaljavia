import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { rankCandidates, RankedCandidate, RankResponse } from "../api";

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 75
      ? "bg-green-100 text-green-800 border-green-200"
      : score >= 50
        ? "bg-yellow-100 text-yellow-800 border-yellow-200"
        : "bg-red-100 text-red-800 border-red-200";
  return (
    <span
      className={`inline-flex items-center justify-center w-14 h-14 rounded-full border-2 text-xl font-bold shrink-0 ${cls}`}
    >
      {score}
    </span>
  );
}

function CandidateCard({ candidate: c }: { candidate: RankedCandidate }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <div className="flex items-start gap-4">
        <ScoreBadge score={c.score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
              #{c.rank}
            </span>
            <h3 className="font-semibold text-gray-900 truncate">
              {c.name ?? "Unknown"}
            </h3>
          </div>
          {c.email && <p className="text-sm text-gray-400">{c.email}</p>}
        </div>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed">{c.reasoning}</p>

      {c.matched_skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {c.matched_skills.map((s) => (
            <span
              key={s}
              className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {c.gaps.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Gaps
          </p>
          <ul className="space-y-0.5">
            {c.gaps.map((g, i) => (
              <li key={i} className="text-xs text-gray-500 flex gap-1.5">
                <span className="text-gray-300 shrink-0">—</span>
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RankPage() {
  const [jdText, setJdText] = useState("");
  const [topK, setTopK] = useState(10);

  const { mutate, data, isPending, error, reset } = useMutation<
    RankResponse,
    Error,
    { jd_text: string; top_k: number }
  >({
    mutationFn: ({ jd_text, top_k }) => rankCandidates(jd_text, top_k),
  });

  const handleSubmit = () => {
    if (!jdText.trim()) return;
    mutate({ jd_text: jdText, top_k: topK });
  };

  const handleClear = () => {
    setJdText("");
    reset();
  };

  return (
    <div className="space-y-6">
      {/* JD Input */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            Job Description
          </label>
          {(jdText || data) && (
            <button
              onClick={handleClear}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <textarea
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste the job description here — role, responsibilities, required skills…"
          rows={10}
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
        />

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500 shrink-0">Show top</label>
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) =>
              setTopK(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))
            }
            className="w-16 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <label className="text-sm text-gray-500 shrink-0 mr-auto">
            candidates
          </label>

          <button
            onClick={handleSubmit}
            disabled={!jdText.trim() || isPending}
            className="px-6 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Ranking…
              </span>
            ) : (
              "Find Top Candidates"
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error.message}
        </div>
      )}

      {/* Loading placeholder */}
      {isPending && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse"
            >
              <div className="flex gap-4">
                <div className="w-14 h-14 bg-gray-100 rounded-full" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-gray-100 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {data && !isPending && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Showing {data.results.length} of {data.total_ranked} ranked
            candidates
          </p>
          {data.results.map((c) => (
            <CandidateCard key={c.candidate_id} candidate={c} />
          ))}
        </div>
      )}
    </div>
  );
}
