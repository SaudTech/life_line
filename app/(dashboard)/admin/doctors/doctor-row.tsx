"use client";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { DoctorListRow } from "@/lib/doctors/repository";
import { Actions, StatusPill, DutyPill, useDoctorDerived, type DoctorCardProps } from "./doctor-card";

// Doctor list row - mirrors app/(dashboard)/admin/users/user-row.tsx: fixed
// column widths (not flex-wrap/basis) and a reserved actions slot at the end
// via `ml-auto`, so the row's columns - including Actions - never drift from
// row to row regardless of content length.

export function DoctorRow(props: DoctorCardProps) {
  const { doctor } = props;
  const d = useDoctorDerived(doctor);

  return (
    <div
      className={cn(
        "flex flex-nowrap items-center gap-4 overflow-x-auto bg-card px-4 py-3 transition-colors hover:bg-primary/5",
        !doctor.active && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          doctor.active ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground",
        )}
      >
        {d.initials}
      </span>

      <div className="w-[200px] shrink-0">
        <div className="truncate font-semibold text-foreground">{doctor.name}</div>
        <div className="truncate text-xs font-medium text-muted-foreground">{doctor.department || "-"}</div>
      </div>

      <div className="hidden w-[110px] shrink-0 truncate font-mono text-xs tabular-nums text-secondary-foreground md:block">
        {doctor.phone || "-"}
      </div>

      <div className="hidden w-[90px] shrink-0 truncate font-mono text-xs tabular-nums text-secondary-foreground sm:block">
        ₹{formatPaise(doctor.fee_paise)}
      </div>

      <div
        className="hidden w-[215px] shrink-0 truncate text-xs text-muted-foreground lg:block"
        title={d.revisit}
      >
        {d.revisit}
      </div>

      <div className="w-[104px] shrink-0">
        <DutyPill status={d.status} />
      </div>

      <div className="w-[84px] shrink-0">
        <StatusPill active={doctor.active} />
      </div>

      <div className="ml-auto shrink-0">
        <Actions {...props} />
      </div>
    </div>
  );
}
