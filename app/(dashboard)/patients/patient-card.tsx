"use client";

import { Paperclip, Pencil } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { PatientRow } from "@/lib/patients/repository";

// Patient card - mirrors app/(dashboard)/admin/doctors/doctor-card.tsx's shape
// (avatar + header + label/value rows + bottom-pinned action), so all three
// master-list screens (Users, Doctors, Patients) read as one design language.
// Patients have no active/inactive or duty state, so there's only ever one
// action (Edit) - a plain button in the same slot a dropdown trigger would
// occupy elsewhere, not a dropdown with one item.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Display-only phone grouping. Indian numbers read best space-separated (a
// 10-digit mobile as "98765 43210"); US-style parentheses don't fit, so we only
// add spaces. The stored value is untouched - see copyPhone. Unusual lengths are
// shown exactly as entered rather than grouped oddly.
export function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) {
    const n = d.slice(2);
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  if (d.length === 11 && d.startsWith("0")) {
    const n = d.slice(1);
    return `0 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return raw;
}

// Copy the PLAIN stored number (no spaces/brackets) - what you'd paste into a
// dialer or a message. The formatted string is only for reading.
export async function copyPhone(raw: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(raw);
    toast.success("Phone copied", { description: raw });
  } catch {
    toast.error("Could not copy the number.");
  }
}

// created_at crosses the server-action boundary as a Date; guard the format so an
// unexpected string never throws.
export function formatAdded(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const GENDER_LABEL: Record<string, string> = { female: "Female", male: "Male", other: "Other" };

export function GenderPill({ gender }: { gender: string | null }) {
  if (!gender) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-1 text-[11px] font-semibold text-secondary-foreground">
      {GENDER_LABEL[gender] ?? gender}
    </span>
  );
}

export interface PatientCardProps {
  patient: PatientRow;
  onEdit: () => void;
  onDocuments: () => void;
}

function PhoneButton({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-muted-foreground/60">-</span>;
  return (
    <button
      type="button"
      onClick={() => copyPhone(phone)}
      title="Click to copy"
      aria-label={`Copy phone ${phone}`}
      className="rounded font-mono tabular-nums text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {formatPhone(phone)}
    </button>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-secondary-foreground">{value}</span>
    </div>
  );
}

export function Actions({ onEdit, onDocuments }: { onEdit: () => void; onDocuments: () => void }) {
  return (
    <div className="flex justify-end gap-1.5">
      {/* Attached scans / case studies across this patient's OPD & IPD records. */}
      <button
        type="button"
        onClick={onDocuments}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Paperclip className="size-3.5" aria-hidden />
        Documents
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="size-3.5" aria-hidden />
        Edit
      </button>
    </div>
  );
}

export function PatientCard({ patient, onEdit, onDocuments }: PatientCardProps) {
  return (
    <div className={cn("flex h-full flex-col gap-3 rounded-md border bg-card p-4 transition-shadow hover:shadow-sm")}>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground"
          >
            {initials(patient.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-foreground">{patient.name}</div>
            <div className="truncate font-mono text-xs font-medium text-muted-foreground">
              {patient.patient_code}
            </div>
          </div>
          <GenderPill gender={patient.gender} />
        </div>

        <div className="flex flex-col gap-1.5 text-xs font-medium">
          <Row label="Phone" value={<PhoneButton phone={patient.phone} />} />
          <Row label="Age" value={patient.age ?? "-"} />
          <Row label="Area" value={patient.area || "-"} />
          <Row label="Added" value={formatAdded(patient.created_at)} />
        </div>
      </div>

      <div className="mt-auto border-t pt-3">
        <Actions onEdit={onEdit} onDocuments={onDocuments} />
      </div>
    </div>
  );
}
