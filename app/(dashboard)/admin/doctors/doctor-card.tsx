"use client";

import { MoreVertical, Pencil, UserX, UserCheck, Stethoscope } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPaise } from "@/lib/money";
import { DOCTOR_STATUS_LABELS, type DoctorStatus } from "@/lib/doctors/schema";
import type { DoctorListRow } from "@/lib/doctors/repository";

// Doctor card - mirrors app/(dashboard)/admin/users/user-card.tsx's shape (same
// avatar + header + label/value rows + bottom-pinned actions dropdown), so the
// two master-list screens read as one design language.

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const DUTY_TINT: Record<DoctorStatus, string> = {
  available: "bg-primary/10 text-primary",
  on_leave: "bg-amber-100 text-amber-700",
  unavailable: "bg-muted text-muted-foreground",
};
const DUTY_DOT: Record<DoctorStatus, string> = {
  available: "bg-primary",
  on_leave: "bg-amber-600",
  unavailable: "bg-muted-foreground/60",
};

export interface DoctorCardProps {
  doctor: DoctorListRow;
  statusPending: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}

export function useDoctorDerived(doctor: DoctorListRow) {
  const status = (doctor.status as DoctorStatus) || "available";
  return {
    status,
    initials: initials(doctor.name),
  };
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold",
        active ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-destructive")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function DutyPill({ status }: { status: DoctorStatus }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold", DUTY_TINT[status])}>
      <span className={cn("size-1.5 rounded-full", DUTY_DOT[status])} />
      {DOCTOR_STATUS_LABELS[status]}
    </span>
  );
}

// A single "more actions" trigger - matches the Users list's Actions component
// so the two screens behave the same regardless of how many actions a row has.
export function Actions({ doctor, statusPending, onEdit, onToggleActive }: DoctorCardProps) {
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={statusPending}
            aria-label={`Actions for ${doctor.name}`}
            className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-card text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <MoreVertical className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onToggleActive} variant={doctor.active ? "destructive" : "default"}>
            {doctor.active ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
            {statusPending ? "…" : doctor.active ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right text-secondary-foreground", mono && "font-mono tabular-nums")}>
        {value}
      </span>
    </div>
  );
}

export function DoctorCard(props: DoctorCardProps) {
  const { doctor } = props;
  const d = useDoctorDerived(doctor);

  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-md border bg-card p-4 transition-shadow hover:shadow-sm",
        !doctor.active && "opacity-70",
      )}
    >
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
              doctor.active ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground",
            )}
          >
            {d.initials || <Stethoscope className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-foreground">{doctor.name}</div>
            <div className="truncate text-xs font-medium text-muted-foreground">
              {doctor.department || "-"}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusPill active={doctor.active} />
            <DutyPill status={d.status} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-xs font-medium">
          <Row label="Phone" value={doctor.phone || "-"} mono />
          <Row label="Fee" value={`₹${formatPaise(doctor.fee_paise)}`} mono />
          <Row
            label="Revisit validity"
            value={`${doctor.revisit_validity_days} ${doctor.revisit_validity_days === 1 ? "day" : "days"}`}
          />
        </div>
      </div>

      <div className="mt-auto border-t pt-3">
        <Actions {...props} />
      </div>
    </div>
  );
}
