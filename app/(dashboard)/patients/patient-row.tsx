"use client";

import type { PatientRow } from "@/lib/patients/repository";
import { Actions, GenderPill, formatAdded, formatPhone, copyPhone } from "./patient-card";

// Patient list row - mirrors app/(dashboard)/admin/doctors/doctor-row.tsx: fixed
// column widths (not flex-wrap/basis) and a reserved actions slot at the end via
// `ml-auto`, so the row's columns - including the Edit action - never drift from
// row to row regardless of content length.

export function PatientListRowView({
  patient,
  onEdit,
  onDocuments,
}: {
  patient: PatientRow;
  onEdit: () => void;
  onDocuments: () => void;
}) {
  return (
    <div className="flex flex-nowrap items-center gap-4 overflow-x-auto bg-card px-4 py-3 transition-colors hover:bg-primary/5">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground"
      >
        {patient.name
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0])
          .join("")
          .toUpperCase() || "?"}
      </span>

      <div className="w-[200px] shrink-0">
        <div className="truncate font-semibold text-foreground">{patient.name}</div>
        <div className="truncate font-mono text-xs font-medium text-muted-foreground">
          {patient.patient_code}
        </div>
      </div>

      <div className="hidden w-[120px] shrink-0 truncate text-xs md:block">
        {patient.phone ? (
          <button
            type="button"
            onClick={() => copyPhone(patient.phone!)}
            title="Click to copy"
            aria-label={`Copy phone ${patient.phone}`}
            className="rounded font-mono tabular-nums text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {formatPhone(patient.phone)}
          </button>
        ) : (
          <span className="text-muted-foreground/60">-</span>
        )}
      </div>

      <div className="hidden w-[60px] shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
        {patient.age ?? "-"}
      </div>

      <div className="hidden w-[140px] shrink-0 truncate text-xs text-muted-foreground lg:block">
        {patient.area || "-"}
      </div>

      <div className="hidden w-[90px] shrink-0 text-xs text-muted-foreground xl:block">
        {formatAdded(patient.created_at)}
      </div>

      <div className="w-[70px] shrink-0">
        <GenderPill gender={patient.gender} />
      </div>

      <div className="ml-auto shrink-0">
        <Actions onEdit={onEdit} onDocuments={onDocuments} />
      </div>
    </div>
  );
}
