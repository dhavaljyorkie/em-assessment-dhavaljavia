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

const statusStyles: Record<UploadStatus, { label: string; cls: string }> = {
  idle: { label: "Queued", cls: "bg-gray-100 text-gray-600" },
  uploading: { label: "Uploading…", cls: "bg-blue-100 text-blue-600" },
  done: { label: "✓ Accepted", cls: "bg-green-100 text-green-700" },
  error: { label: "✗ Failed", cls: "bg-red-100 text-red-700" },
};

function FileRow({
  entry,
  onRemove,
}: {
  entry: FileEntry;
  onRemove: () => void;
}) {
  const s = statusStyles[entry.status];
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg">
      <span className="text-gray-300 text-lg">📎</span>
      <span className="flex-1 text-sm text-gray-800 truncate">
        {entry.file.name}
      </span>
      <span className="text-xs text-gray-400 shrink-0">
        {(entry.file.size / 1024).toFixed(0)} KB
      </span>
      <span
        className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${s.cls}`}
      >
        {s.label}
      </span>
      {entry.status === "uploading" && (
        <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      {(entry.status === "idle" || entry.status === "error") && (
        <button
          onClick={onRemove}
          className="text-gray-300 hover:text-gray-500 text-xl leading-none shrink-0"
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
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-colors select-none",
          isDragging
            ? "border-indigo-400 bg-indigo-50"
            : "border-gray-300 hover:border-indigo-300 hover:bg-gray-50",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <div className="text-4xl mb-3">📄</div>
        <p className="text-gray-700 font-medium">
          Drop resumes here or click to select
        </p>
        <p className="text-gray-400 text-sm mt-1">
          PDF or DOCX · multiple files supported
        </p>
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {entries.length} file{entries.length !== 1 ? "s" : ""} ·{" "}
              {doneCount} accepted
            </span>
            <button
              onClick={() => setEntries([])}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="space-y-1.5">
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
          {pendingCount > 0 && (
            <p className="text-xs text-gray-400">
              Files are accepted immediately — GPT-4o extraction runs in the
              background (30–60s per file).
            </p>
          )}
        </div>
      )}

      {/* Upload button */}
      {pendingCount > 0 && (
        <button
          onClick={handleUploadAll}
          disabled={isUploading}
          className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isUploading
            ? "Uploading…"
            : `Upload ${pendingCount} resume${pendingCount !== 1 ? "s" : ""}`}
        </button>
      )}

      {/* Candidate count badge */}
      {candidatesData && (
        <div className="flex items-center gap-2 text-sm text-gray-500 pt-2 border-t border-gray-100">
          <span className="w-2 h-2 bg-green-400 rounded-full" />
          {candidatesData.total} candidate
          {candidatesData.total !== 1 ? "s" : ""} in the database
        </div>
      )}
    </div>
  );
}
