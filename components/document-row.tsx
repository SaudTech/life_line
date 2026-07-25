"use client";

import { useState } from "react";
import { Download, Eye, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ALLOWED_DOCUMENT_TYPES,
  fileExtension,
  formatBytes,
  isPreviewableExtension,
} from "@/lib/documents/rules";
import { deleteDocumentAction } from "@/lib/documents/actions";
import type { DocumentListRow } from "@/lib/documents/repository";

// One attached-document row, shared by the record dialog (paperclip on the
// OPD/IPD lists) and the admin per-patient view: type icon, name, size,
// "uploaded when · by whom", preview (PDF/images open inline via the
// authenticated serve route), download, and - admin only - delete behind a
// real confirmation dialog (deleting a patient document is rare and admin-only,
// not a routine counter action, so dev-rules §5's no-confirm rule doesn't apply).

export function DocumentTypeIcon({ name, className }: { name: string; className?: string }) {
  const ext = fileExtension(name);
  const label = ext ? ALLOWED_DOCUMENT_TYPES[ext]?.label : undefined;
  if (label === "Image") return <ImageIcon className={className} aria-hidden />;
  if (label === "Excel" || ext === "csv") return <FileSpreadsheet className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

export function DocumentRow({
  doc,
  canDelete,
  onDeleted,
}: {
  doc: DocumentListRow;
  canDelete: boolean;
  onDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const previewable = isPreviewableExtension(fileExtension(doc.original_name));

  async function remove() {
    setDeleting(true);
    try {
      const res = await deleteDocumentAction({ documentId: doc.id });
      if (!res.ok) {
        toast.error(res.formError ?? "Could not delete the document.");
        return;
      }
      toast.success(`"${doc.original_name}" deleted.`);
      setConfirming(false);
      onDeleted(doc.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <DocumentTypeIcon name={doc.original_name} className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground" title={doc.original_name}>
          {doc.original_name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {formatBytes(Number(doc.size_bytes))} · {doc.uploaded_label} · by {doc.uploaded_by_name}
        </div>
      </div>
      {previewable ? (
        <button
          type="button"
          onClick={() => window.open(`/api/documents/${doc.id}`, "_blank", "noopener")}
          title="Preview"
          aria-label={`Preview ${doc.original_name}`}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Eye className="size-4" aria-hidden />
        </button>
      ) : null}
      <a
        href={`/api/documents/${doc.id}?download=1`}
        title="Download"
        aria-label={`Download ${doc.original_name}`}
        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Download className="size-4" aria-hidden />
      </a>
      {canDelete ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title="Delete"
          aria-label={`Delete ${doc.original_name}`}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      ) : null}

      {/* Deleting a patient's document is rare and admin-only - a real
          confirmation dialog, not a routine-action guard (dev-rules §5 covers
          routine counter actions; this isn't one). Primary (danger) action
          left, dismiss right, per the project's dialog order rule. */}
      {confirming ? (
        <Dialog open onOpenChange={(o) => (o ? null : setConfirming(false))}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete this document?</DialogTitle>
              <DialogDescription>
                &quot;{doc.original_name}&quot; will be removed from this record. The file itself
                stays on the documents drive for the audit trail.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-2 flex-row justify-start gap-2">
              <Button type="button" variant="destructive" disabled={deleting} onClick={remove} autoFocus>
                {deleting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Delete
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </li>
  );
}
