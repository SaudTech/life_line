"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_ACCEPT,
  MAX_DOCUMENTS_PER_RECORD,
  checkDocumentCount,
  checkDocumentFile,
  fileExtension,
  formatBytes,
  isPreviewableExtension,
  type DocumentRecordType,
} from "@/lib/documents/rules";
import { listRecordDocumentsAction } from "@/lib/documents/actions";
import type { DocumentListRow } from "@/lib/documents/repository";
import { DocumentRow, DocumentTypeIcon } from "@/components/document-row";

// Attach-documents dialog for one OPD consultation or IPD (discharged)
// admission - opened from the paperclip on the list rows. Any staff member can
// view, PREVIEW-BEFORE-UPLOAD, upload, and download; once uploaded a document
// cannot be deleted except by an admin (canDelete) - all enforced again on the
// server. The dialog only displays what the server returns: limits come from
// lib/documents/rules (the same functions the upload route runs), and after an
// upload the list is replaced with the server's fresh copy, never a local guess.

interface PendingFile {
  file: File;
  error: string | null; // instant pre-check result; invalid files are never sent
}

export function RecordDocumentsDialog({
  recordType,
  recordId,
  patientName,
  patientCode,
  canDelete,
  onClose,
}: {
  recordType: DocumentRecordType;
  recordId: string;
  patientName: string;
  patientCode: string;
  canDelete: boolean;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocumentListRow[] | null>(null); // null = loading
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Object URLs handed to preview tabs, revoked when the dialog closes.
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await listRecordDocumentsAction({ recordType, recordId });
      if (!alive) return;
      if (res.ok) setDocs(res.data ?? []);
      else {
        toast.error(res.formError ?? "Could not load documents.");
        setDocs([]);
      }
    })();
    const urls = objectUrls.current;
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [recordType, recordId]);

  const savedCount = docs?.length ?? 0;
  const validPending = pending.filter((p) => !p.error);
  const countCheck =
    validPending.length > 0 ? checkDocumentCount(savedCount, validPending.length) : null;
  const canUpload = !uploading && docs !== null && validPending.length > 0 && countCheck?.ok === true;

  function addFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...picked.map((file) => {
        const check = checkDocumentFile({ name: file.name, size: file.size });
        return { file, error: check.ok ? null : check.error };
      }),
    ]);
  }

  // Preview a not-yet-uploaded file in a new tab (PDF/images render natively).
  function previewPending(file: File) {
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    window.open(url, "_blank", "noopener");
  }

  async function upload() {
    if (!canUpload) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("recordType", recordType);
      form.set("recordId", recordId);
      for (const p of validPending) form.append("files", p.file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; documents: DocumentListRow[] }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        toast.error(body && !body.ok ? body.error : "The upload failed. Nothing was attached.");
        return;
      }
      setDocs(body.documents);
      setPending((prev) => prev.filter((p) => p.error)); // keep rejected picks visible
      toast.success(
        `${validPending.length} ${validPending.length === 1 ? "document" : "documents"} attached.`,
      );
    } catch {
      toast.error("The upload failed. Nothing was attached.");
    } finally {
      setUploading(false);
    }
  }

  const recordLabel =
    recordType === "ipd" ? `IPD admission #${recordId}` : `OPD consultation #${recordId}`;

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Documents · {patientName} <span className="font-mono text-sm">{patientCode}</span>
          </DialogTitle>
          <DialogDescription>
            Scans and case studies for {recordLabel}.
          </DialogDescription>
        </DialogHeader>

        {/* Existing documents */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Attached</span>
            <span className="tabular-nums">
              {docs === null ? "…" : `${savedCount} of ${MAX_DOCUMENTS_PER_RECORD}`}
            </span>
          </div>
          {docs === null ? (
            <div className="flex items-center justify-center rounded-lg border bg-muted/30 py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : docs.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
              No documents attached yet.
            </p>
          ) : (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border bg-card">
              {docs.map((d) => (
                <DocumentRow
                  key={d.id}
                  doc={d}
                  canDelete={canDelete}
                  onDeleted={(id) => setDocs((prev) => (prev ? prev.filter((x) => x.id !== id) : prev))}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Add files */}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Add documents</div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragOver ? "border-primary bg-primary/5" : "bg-muted/20 hover:border-primary/60",
            )}
          >
            <Upload className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-xs font-medium text-muted-foreground">
              Click to choose files, or drag them here
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            className="sr-only"
            aria-label="Choose documents to upload"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = ""; // re-picking the same file must fire again
            }}
          />

          {pending.length > 0 ? (
            <ul className="mt-2 divide-y rounded-lg border bg-card">
              {pending.map((p, i) => {
                const previewable = !p.error && isPreviewableExtension(fileExtension(p.file.name));
                return (
                  <li key={`${p.file.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
                    <DocumentTypeIcon name={p.file.name} className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground" title={p.file.name}>
                        {p.file.name}
                      </div>
                      <div
                        className={cn(
                          "truncate text-xs",
                          p.error ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {p.error ?? formatBytes(p.file.size)}
                      </div>
                    </div>
                    {previewable ? (
                      <button
                        type="button"
                        onClick={() => previewPending(p.file)}
                        title="Preview before uploading"
                        aria-label={`Preview ${p.file.name} before uploading`}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Eye className="size-4" aria-hidden />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove from this upload"
                      aria-label={`Remove ${p.file.name} from this upload`}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {countCheck && !countCheck.ok ? (
            <p className="mt-2 text-xs font-medium text-destructive">{countCheck.error}</p>
          ) : null}
        </div>

        {/* Primary action left, dismiss right (dev-rules §5 dialog order). */}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" disabled={!canUpload} onClick={upload}>
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {uploading
              ? "Uploading…"
              : `Upload${validPending.length > 0 ? ` ${validPending.length}` : ""}`}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
