"use client";

import { useState } from "react";
import Link from "next/link";
import { BedDouble, ChevronRight, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { AdmissionListRow } from "@/lib/admissions/repository";

// The in-patient census (plan §5c) - currently-admitted patients, each linking to
// its detail (running expense tally / discharge), with a tab for discharged
// history. Keyboard-first, calm visuals, colour for status only (dev-rules §5).
// "Admit patient" is the one prominent action.
export function AdmissionsManager({
  admitted,
  discharged,
}: {
  admitted: AdmissionListRow[];
  discharged: AdmissionListRow[];
}) {
  const [tab, setTab] = useState<"admitted" | "discharged">("admitted");
  const rows = tab === "admitted" ? admitted : discharged;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">In-patients</h1>
          <p className="text-sm text-muted-foreground">
            Admit patients, track their running bill, and discharge with a final invoice.
          </p>
        </div>
        <Link
          href="/admissions/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden />
          Admit patient
        </Link>
      </div>

      {/* Tabs */}
      <div className="mb-4 inline-flex rounded-lg border bg-muted/30 p-1 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setTab("admitted")}
          aria-pressed={tab === "admitted"}
          className={cn(
            "rounded-md px-4 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab === "admitted" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Admitted ({admitted.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("discharged")}
          aria-pressed={tab === "discharged"}
          className={cn(
            "rounded-md px-4 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab === "discharged" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Discharged ({discharged.length})
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/40 p-10 text-center">
          <BedDouble className="mx-auto mb-3 size-8 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {tab === "admitted" ? "No patients are currently admitted." : "No discharges yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {rows.map((a) => (
            <Link
              key={a.id}
              href={`/admissions/${a.id}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  tab === "admitted" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
                aria-hidden
              >
                <BedDouble className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {a.patient_name} · <span className="font-mono text-xs">{a.patient_code}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {tab === "admitted"
                    ? `#${a.id} · Admitted ${a.admitted_label} · ${a.expense_count} expense${a.expense_count === 1 ? "" : "s"}`
                    : `Discharged ${a.discharged_label ?? "-"}${a.bill_number ? ` · Bill #${a.bill_number}` : ""}`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted-foreground">
                  {tab === "admitted" ? "Running total" : "Bill total"}
                </div>
                <div className="text-sm font-bold text-foreground">
                  ₹
                  {tab === "admitted"
                    ? formatPaise(a.running_total_paise)
                    : formatPaise(a.bill_total_paise ?? "0")}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
