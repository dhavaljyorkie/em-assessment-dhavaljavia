import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  rankCandidates,
  getCandidates,
  RankedCandidate,
  RankResponse,
} from "../api";

// Show "processing" banner for this many ms after the last count change
const PROCESSING_LINGER_MS = 15_000;

function useProcessingState() {
  const { data } = useQuery({
    queryKey: ["candidates"],
    queryFn: getCandidates,
    refetchInterval: 4_000,
  });

  const total = data?.total ?? 0;
  const prevTotalRef = useRef(total);
  const lastChangedRef = useRef<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (total !== prevTotalRef.current) {
      prevTotalRef.current = total;
      lastChangedRef.current = Date.now();
      setIsProcessing(true);
    }
  }, [total]);

  useEffect(() => {
    if (!isProcessing) return;
    const id = setTimeout(() => {
      if (
        lastChangedRef.current &&
        Date.now() - lastChangedRef.current >= PROCESSING_LINGER_MS
      ) {
        setIsProcessing(false);
      }
    }, PROCESSING_LINGER_MS);
    return () => clearTimeout(id);
  }, [isProcessing, total]);

  return { total, isProcessing };
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 75 ? "var(--green)" : score >= 50 ? "var(--accent)" : "var(--red)";
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);

  return (
    <div
      style={{
        position: "relative",
        width: "56px",
        height: "56px",
        flexShrink: 0,
      }}
    >
      <svg
        width="56"
        height="56"
        style={{ transform: "rotate(-90deg)", display: "block" }}
      >
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="2"
        />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "14px",
          fontWeight: 500,
          color: color,
        }}
      >
        {score}
      </span>
    </div>
  );
}

function CandidateCard({
  candidate: c,
  index,
}: {
  candidate: RankedCandidate;
  index: number;
}) {
  const delayClass = `delay-${Math.min(index + 1, 5)}`;
  return (
    <div
      className={`anim-fade-up ${delayClass}`}
      style={{
        background: "var(--surface)",
        borderLeft: "2px solid var(--border)",
        padding: "24px",
        position: "relative",
        overflow: "hidden",
        transition: "border-left-color 0.2s",
        marginBottom: "1px",
      }}
      onMouseOver={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderLeftColor =
          "var(--accent)")
      }
      onMouseOut={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderLeftColor =
          "var(--border)")
      }
    >
      {/* Large ghost rank number */}
      <span
        style={{
          position: "absolute",
          top: "-6px",
          right: "16px",
          fontFamily: "var(--font-display)",
          fontSize: "88px",
          fontWeight: 300,
          color: "rgba(255,255,255,0.025)",
          lineHeight: 1,
          userSelect: "none",
          pointerEvents: "none",
          letterSpacing: "-0.02em",
        }}
      >
        {c.rank}
      </span>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
        <ScoreRing score={c.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "8px",
              marginBottom: "3px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--accent)",
                flexShrink: 0,
              }}
            >
              #{String(c.rank).padStart(2, "0")}
            </span>
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                fontWeight: 400,
                color: "var(--text)",
                margin: 0,
                lineHeight: 1.1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.name ?? "Unknown Candidate"}
            </h3>
          </div>
          {c.email && (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--text-muted)",
                margin: 0,
                letterSpacing: "0.02em",
              }}
            >
              {c.email}
            </p>
          )}
        </div>
      </div>

      {/* Reasoning */}
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-muted)",
          lineHeight: 1.75,
          margin: "16px 0",
          borderLeft: "2px solid var(--border)",
          paddingLeft: "14px",
        }}
      >
        {c.reasoning}
      </p>

      {/* Matched skills */}
      {c.matched_skills.length > 0 && (
        <div style={{ marginBottom: c.gaps.length > 0 ? "14px" : 0 }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              margin: "0 0 7px",
            }}
          >
            Matched
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {c.matched_skills.map((s) => (
              <span
                key={s}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--green)",
                  background: "var(--green-dim)",
                  border: "1px solid rgba(77, 138, 95, 0.2)",
                  padding: "2px 8px",
                  letterSpacing: "0.04em",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gaps */}
      {c.gaps.length > 0 && (
        <div>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              margin: "0 0 7px",
            }}
          >
            Gaps
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {c.gaps.map((g, i) => (
              <span
                key={i}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    color: "var(--red)",
                    fontSize: "10px",
                    flexShrink: 0,
                  }}
                >
                  —
                </span>
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RankPage() {
  const [jdText, setJdText] = useState("");
  const [topK, setTopK] = useState(10);
  const { total, isProcessing } = useProcessingState();

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
    <div style={{ display: "flex", flexDirection: "column", gap: "36px" }}>
      {/* Section header */}
      <div className="anim-fade-up">
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "28px",
            fontWeight: 300,
            fontStyle: "italic",
            color: "var(--text)",
            margin: "0 0 6px",
            lineHeight: 1.2,
          }}
        >
          Rank Candidates
        </h2>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.04em",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Paste a job description to surface and score your best-fit candidates
        </p>
      </div>

      {/* Pipeline status */}
      {isProcessing ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            background: "var(--amber-dim)",
            border: "1px solid rgba(196, 148, 74, 0.18)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--accent)",
          }}
        >
          <span
            className="pulse-dot"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--accent)",
              flexShrink: 0,
              display: "inline-block",
            }}
          />
          <span>
            <strong>Pipeline active</strong> — resumes are still being
            processed. Results may be incomplete.
            {total > 0 && (
              <span style={{ color: "var(--text-muted)", marginLeft: "6px" }}>
                {total} indexed so far.
              </span>
            )}
          </span>
        </div>
      ) : total > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--green)",
              flexShrink: 0,
              display: "inline-block",
            }}
          />
          {total} candidate{total !== 1 ? "s" : ""} indexed — ready to rank
        </div>
      ) : null}

      {/* JD input area */}
      <div
        className="anim-fade-up delay-1"
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <label
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Job Description
          </label>
          {(jdText || data) && (
            <button
              onClick={handleClear}
              style={{
                background: "none",
                border: "none",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseOut={(e) =>
                (e.currentTarget.style.color = "var(--text-muted)")
              }
            >
              Clear
            </button>
          )}
        </div>

        <textarea
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste the job description — role, responsibilities, required skills…"
          rows={10}
          style={{
            width: "100%",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: 1.8,
            padding: "16px",
            resize: "none",
            outline: "none",
            transition: "border-color 0.2s, box-shadow 0.2s",
            borderRadius: 0,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow =
              "0 0 0 1px rgba(196, 148, 74, 0.12)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />

        {/* Controls row */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-muted)",
            }}
          >
            Show top
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) =>
              setTopK(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))
            }
            style={{
              width: "56px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              padding: "8px",
              textAlign: "center",
              outline: "none",
              borderRadius: 0,
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "var(--accent)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "var(--border)")
            }
          />
          <label
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-muted)",
              flex: 1,
            }}
          >
            candidates
          </label>

          <button
            onClick={handleSubmit}
            disabled={!jdText.trim() || isPending}
            title={
              isProcessing
                ? "Pipeline still active — results may be incomplete"
                : undefined
            }
            style={{
              padding: "12px 28px",
              background:
                !jdText.trim() || isPending
                  ? "var(--surface-2)"
                  : isProcessing
                    ? "var(--amber-dim)"
                    : "var(--accent)",
              color:
                !jdText.trim() || isPending
                  ? "var(--text-muted)"
                  : isProcessing
                    ? "var(--accent)"
                    : "var(--bg)",
              border: isProcessing ? "1px solid rgba(196,148,74,0.25)" : "none",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              cursor: !jdText.trim() || isPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              transition: "background 0.2s, color 0.2s",
              borderRadius: 0,
            }}
          >
            {isPending ? (
              <>
                <span
                  className="spin"
                  style={{
                    width: "11px",
                    height: "11px",
                    border: "1px solid var(--text-muted)",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                Ranking…
              </>
            ) : isProcessing ? (
              "⚠ Rank anyway"
            ) : (
              "Find Top Candidates"
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "14px 16px",
            background: "var(--red-dim)",
            border: "1px solid rgba(138, 77, 77, 0.2)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--red)",
          }}
        >
          {error.message}
        </div>
      )}

      {/* Skeleton */}
      {isPending && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="skeleton-pulse"
              style={{
                height: "148px",
                borderLeft: "2px solid var(--border)",
              }}
            />
          ))}
        </div>
      )}

      {/* Results */}
      {data && !isPending && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
              marginBottom: "1px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {data.total_ranked} candidates ranked
            </span>
          </div>

          <div>
            {data.results.map((candidate, i) => (
              <CandidateCard
                key={candidate.candidate_id}
                candidate={candidate}
                index={i}
              />
            ))}
          </div>

          {data.results.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "48px",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--text-muted)",
              }}
            >
              No candidates found matching this description.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
