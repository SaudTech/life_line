"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listPatientDocumentsAction } from "@/lib/documents/actions";
import type { DocumentListRow } from "@/lib/documents/repository";
import type { PatientRow } from "@/lib/patients/repository";
import { DocumentRow } from "@/components/document-row";

// Admin view of EVERY document attached across one patient's records, grouped
// by the consultation/admission it belongs to - preview, download, uploaded
// when and by whom, and (admin) delete. Server-gated admin-only (the Patients
// page itself is admin-only, and the action re-checks).

interface RecordGroup {
  key: string;
  label: string;
  docs: DocumentListRow[];
}

function groupByRecord(rows: DocumentListRow[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const d of rows) {
    const recordId = d.record_type === "ipd" ? d.admission_id : d.consultation_id;
    const key = `${d.record_type}-${recordId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label:
          d.record_type === "ipd"
            ? `IPD admission #${recordId}`
            : `OPD consultation #${recordId}`,
        docs: [],
      };
      groups.set(key, g);
    }
    g.docs.push(d);
  }
  return Array.from(groups.values());
}

export function PatientDocumentsDialog({
  patient,
  onClose,
}: {
  patient: PatientRow;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocumentListRow[] | null>(null); // null = loading

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await listPatientDocumentsAction({ patientId: patient.id });
      if (!alive) return;
      if (res.ok) setDocs(res.data ?? []);
      else {
        toast.error(res.formError ?? "Could not load documents.");
        setDocs([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [patient.id]);

  const groups = docs ? groupByRecord(docs) : [];

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Documents · {patient.name} <span className="font-mono text-sm">{patient.patient_code}</span>
          </DialogTitle>
          <DialogDescription>
            Every scan and case study attached to this patient&apos;s consultations and admissions.
          </DialogDescription>
        </DialogHeader>

        {docs === null ? (
          <div className="flex items-center justify-center rounded-lg border bg-muted/30 py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
            <FolderOpen className="size-6 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No documents attached yet. Staff attach them from the OPD and IPD lists.
            </p>
          </div>
        ) : (
          <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                <ul className="divide-y rounded-lg border bg-card">
                  {g.docs.map((d) => (
                    <DocumentRow
                      key={d.id}
                      doc={d}
                      canDelete
                      onDeleted={(id) =>
                        setDocs((prev) => (prev ? prev.filter((x) => x.id !== id) : prev))
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
