import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadResume, getCandidates } from "../api";

type UploadStatus = "idle" | "uploading" | "done" | "error";

interface FileEntry {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
}

const STATUS_CONFIG: Record<
  UploadStatus,
  { label: string; color: string; dot: string }
> = {
  idle: {
    label: "QUEUED",
    color: "var(--text-muted)",
    dot: "var(--border)",
  },
  uploading: {
    label: "UPLOADING",
    color: "var(--accent)",
    dot: "var(--accent)",
  },
  done: { label: "ACCEPTED", color: "var(--green)", dot: "var(--green)" },
  error: { label: "FAILED", color: "var(--red)", dot: "var(--red)" },
};

function FileRow({
  entry,
  onRemove,
}: {
  entry: FileEntry;
  onRemove: () => void;
}) {
  const s = STATUS_CONFIG[entry.status];
  return (
    <div
      className="anim-fade-up"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "11px 16px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Status dot */}
      <span
        className={entry.status === "uploading" ? "pulse-dot" : ""}
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: s.dot,
          flexShrink: 0,
          display: "inline-block",
          transition: "background 0.2s",
        }}
      />

      {/* Filename */}
      <span
        style={{
          flex: 1,
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: entry.status === "done" ? "var(--text-muted)" : "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textDecoration: entry.status === "done" ? "line-through" : "none",
          textDecorationColor: "var(--border)",
        }}
      >
        {entry.file.name}
      </span>

      {/* File size */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        {(entry.file.size / 1024).toFixed(0)} kb
      </span>

      {/* Status label */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          letterSpacing: "0.1em",
          color: s.color,
          flexShrink: 0,
          minWidth: "76px",
          textAlign: "right",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "6px",
        }}
      >
        {entry.status === "uploading" && (
          <span
            className="spin"
            style={{
              display: "inline-block",
              width: "10px",
              height: "10px",
              border: "1px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
        )}
        {s.label}
      </span>

      {/* Remove button */}
      {(entry.status === "idle" || entry.status === "error") && (
        <button
          onClick={onRemove}
          style={{
            background: "none",
            border: "none",
            color: "var(--border)",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
            padding: "0 0 0 4px",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.color = "var(--red)")}
          onMouseOut={(e) => (e.currentTarget.style.color = "var(--border)")}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function UploadPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: candidatesData } = useQuery({
    queryKey: ["candidates"],
    queryFn: getCandidates,
    refetchInterval: 5000,
  });

  const { mutateAsync } = useMutation({ mutationFn: uploadResume });

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) =>
      /\.(pdf|docx)$/i.test(f.name),
    );
    if (!valid.length) return;
    setEntries((prev) => [
      ...prev,
      ...valid.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: "idle" as UploadStatus,
      })),
    ]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleUploadAll = async () => {
    const pending = entries.filter(
      (e) => e.status === "idle" || e.status === "error",
    );
    for (const entry of pending) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, status: "uploading" } : e,
        ),
      );
      try {
        await mutateAsync(entry.file);
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, status: "done" } : e)),
        );
        queryClient.invalidateQueries({ queryKey: ["candidates"] });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: "error", error: msg } : e,
          ),
        );
      }
    }
  };

  const pendingCount = entries.filter(
    (e) => e.status === "idle" || e.status === "error",
  ).length;
  const doneCount = entries.filter((e) => e.status === "done").length;
  const isUploading = entries.some((e) => e.status === "uploading");

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
          Upload Resumes
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
          PDF &amp; DOCX accepted · GPT-4o extraction runs in background (30–60s
          per file)
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1px dashed ${isDragging ? "var(--accent)" : "var(--border)"}`,
          background: isDragging ? "var(--accent-glow)" : "var(--surface)",
          padding: "60px 32px",
          textAlign: "center",
          cursor: "pointer",
          transition: "border-color 0.2s, background 0.2s",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {isDragging && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              boxShadow: "inset 0 0 60px rgba(196, 148, 74, 0.07)",
              pointerEvents: "none",
            }}
          />
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx"
          style={{ display: "none" }}
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "28px",
            color: isDragging ? "var(--accent)" : "var(--text-muted)",
            lineHeight: 1,
            marginBottom: "16px",
            transition: "color 0.2s",
            letterSpacing: "-0.02em",
          }}
        >
          ↓
        </div>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            color: isDragging ? "var(--accent)" : "var(--text)",
            margin: "0 0 6px",
            transition: "color 0.2s",
          }}
        >
          Drop resumes here or click to select
        </p>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-muted)",
            margin: 0,
            letterSpacing: "0.04em",
          }}
        >
          PDF · DOCX · Multiple files supported
        </p>
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div
          className="anim-fade-up"
          style={{ border: "1px solid var(--border)" }}
        >
          {/* List header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {entries.length} file{entries.length !== 1 ? "s" : ""} ·{" "}
              {doneCount} accepted
            </span>
            <button
              onClick={() => setEntries([])}
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
              Clear all
            </button>
          </div>

          {/* File rows */}
          {entries.map((entry) => (
            <FileRow
              key={entry.id}
              entry={entry}
              onRemove={() =>
                setEntries((prev) => prev.filter((e) => e.id !== entry.id))
              }
            />
          ))}
        </div>
      )}

      {/* Upload button */}
      {pendingCount > 0 && (
        <button
          onClick={handleUploadAll}
          disabled={isUploading}
          style={{
            width: "100%",
            padding: "16px",
            background: isUploading ? "var(--surface-2)" : "var(--accent)",
            color: isUploading ? "var(--text-muted)" : "var(--bg)",
            border: "none",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: isUploading ? "not-allowed" : "pointer",
            transition: "background 0.2s, color 0.2s",
          }}
        >
          {isUploading
            ? "Uploading…"
            : `Upload ${pendingCount} Resume${pendingCount !== 1 ? "s" : ""}`}
        </button>
      )}

      {/* Candidate count */}
      {candidatesData && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 0 0",
            borderTop: "1px solid var(--border)",
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
          {candidatesData.total} candidate
          {candidatesData.total !== 1 ? "s" : ""} indexed
        </div>
      )}
    </div>
  );
}
