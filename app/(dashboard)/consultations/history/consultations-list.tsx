"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Paperclip, Search, Loader2, Stethoscope, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { printReceipt } from "@/components/print-receipt";
import { BillRowActions } from "@/components/bill-row-actions";
import { VoidBillDialog, type VoidableBill } from "@/components/void-bill-dialog";
import { RecordDocumentsDialog } from "@/components/record-documents-dialog";
import { formatPaise } from "@/lib/money";
import { listConsultationsAction } from "@/lib/consultations/actions";
import type { ConsultationListRow } from "@/lib/consultations/repository";
import { clinicToday } from "@/lib/date-range";
import { DayStepper } from "@/components/day-stepper";

const PAY_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

type Filters = {
  q: string;
  day: string;
};

// The page opens scoped to today's consultations (the common case at the
// counter), not the full unfiltered history. "Clear filters" returns here,
// not to an empty day - "today" stays the baseline view.
function defaultFilters(): Filters {
  return { q: "", day: clinicToday() };
}

async function copyConsultationId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    toast.success("Consultation # copied", { description: `#${id}` });
  } catch {
    toast.error("Could not copy.");
  }
}

// All consultations, newest first (admin + OP+IN desk). Preloaded on the server;
// every filter below (free text, or a date range) re-queries the server on
// demand, debounced - the server is the one source of truth for what matches,
// never a client-side re-filter of a fixed page of rows.
export function ConsultationsList({
  initial,
  printable,
  todayIso,
  canManageBills,
  canDeleteDocuments,
}: {
  initial: ConsultationListRow[];
  // Server-resolved Print (reprint) gate: a design must exist for this
  // location's consultation receipt AND the viewer must be supervisor/admin
  // (op_ip_desk lost reprint - they can still view, search, void, re-issue).
  printable: boolean;
  // Clinic "today" (server-reckoned) - caps the day stepper so it can never
  // step forward into a day that has no data yet.
  todayIso: string;
  // op_desk sees the list (to attach/view documents) but no bill actions -
  // void/re-issue/print are each server-gated regardless.
  canManageBills: boolean;
  // Admin-only: delete an attached document (server-gated in the action).
  canDeleteDocuments: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [rows, setRows] = useState<ConsultationListRow[]>(initial);
  const [pending, setPending] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidableBill | null>(null);
  const [docTarget, setDocTarget] = useState<ConsultationListRow | null>(null);
  const latest = useRef(0);

  const hasFilters = Object.entries(filters).some(
    ([key, v]) => v !== defaultFilters()[key as keyof Filters],
  );

  useEffect(() => {
    const seq = ++latest.current;
    setPending(true);
    const t = setTimeout(async () => {
      const res = await listConsultationsAction({
        q: filters.q.trim() || undefined,
        dateFrom: filters.day || undefined,
        dateTo: filters.day || undefined,
      });
      if (seq !== latest.current) return;
      setPending(false);
      if (res.ok) setRows(res.data ?? []);
      else toast.error(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not load consultations.");
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* op_desk can't start consultations - don't show a link that would bounce. */}
      {canManageBills ? (
        <Link
          href="/consultations"
          className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden />
          New consultation
        </Link>
      ) : null}

      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Consultations</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Every consultation, newest first. Revisits show under their original consultation.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[210px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search by patient name, phone, ID, or doctor…"
            aria-label="Search consultations"
            className="pl-9 pr-8"
          />
          {pending ? (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>

        <DayStepper day={filters.day} todayIso={todayIso} onChange={(d) => set("day", d)} />
      </div>

      {/* Meta row */}
      <div className="mb-4 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Showing <b className="text-secondary-foreground">{rows.length}</b>{" "}
          {rows.length === 1 ? "consultation" : "consultations"}
        </span>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => setFilters(defaultFilters())}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
            Clear filters
          </button>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          {/* [contain:layout]: a table wider than this scroller leaks its min-content
              into the document's scroll area (Chromium quirk) - the page itself would
              pan sideways on phones even though the table scrolls in here. */}
          <div className="overflow-x-auto [contain:layout]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-3 font-semibold text-muted-foreground">#</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Patient</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Doctor</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Reason</th>
                  <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Visits</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const isVoid = c.bill_status === "void";
                  return (
                  <tr
                    key={c.id}
                    className="border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm font-medium text-foreground">
                          #{c.id}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyConsultationId(c.id)}
                          title="Copy consultation #"
                          aria-label={`Copy consultation number ${c.id}`}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Copy className="size-3" aria-hidden />
                        </button>
                      </div>
                      <div className="text-xs text-muted-foreground">{c.created_label}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{c.patient_name}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{c.patient_code}</span>
                        {c.phone ? ` · ${c.phone}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{c.doctor_name}</td>
                    <td className="max-w-[16rem] px-4 py-3 text-muted-foreground">
                      <span className="line-clamp-2">
                        {c.reason || <span className="text-muted-foreground/60">-</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                      {c.visit_count}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div
                        className={
                          "font-semibold tabular-nums " +
                          (isVoid ? "text-muted-foreground line-through" : "text-foreground")
                        }
                      >
                        {c.total_paise != null ? `₹${formatPaise(c.total_paise)}` : "-"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {Number(c.discount_paise ?? "0") > 0
                          ? `−₹${formatPaise(c.discount_paise!)} · `
                          : ""}
                        {c.payment_mode ? PAY_LABELS[c.payment_mode] ?? c.payment_mode : ""}
                        {c.bill_number ? ` · #${c.bill_number}` : ""}
                      </div>
                      {isVoid ? (
                        <Badge variant="destructive" className="mt-1">
                          Cancelled
                        </Badge>
                      ) : null}
                      {c.replaced_by_number ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Replaced by #{c.replaced_by_number}
                        </div>
                      ) : null}
                      {c.reissue_of_number ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Fix of #{c.reissue_of_number}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDocTarget(c)}
                        title="Documents (scans, case studies)"
                        aria-label={`Documents for consultation ${c.id}`}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Paperclip className="size-4" aria-hidden />
                      </button>
                      {canManageBills && c.bill_id ? (
                        <BillRowActions
                          isCancelled={isVoid}
                          replaced={!!c.replaced_by_number}
                          printable={printable}
                          onPrint={() =>
                            printReceipt(c.bill_id!, c.bill_number!, { copy: "duplicate" })
                          }
                          onCancel={() =>
                            setVoidTarget({
                              id: c.bill_id!,
                              billNumber: c.bill_number!,
                              patientName: c.patient_name,
                              patientCode: c.patient_code,
                              totalLabel:
                                c.total_paise != null ? `₹${formatPaise(c.total_paise)}` : "-",
                            })
                          }
                          onReissue={() => router.push(`/consultations?replaces=${c.bill_id}`)}
                        />
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Stethoscope className="size-7" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {hasFilters ? "No consultations found" : "No consultations yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
              {hasFilters
                ? "No consultation matches these filters."
                : "Booked consultations will appear here."}
            </p>
          </div>
          {hasFilters ? (
            <Button type="button" variant="outline" onClick={() => setFilters(defaultFilters())}>
              Clear filters
            </Button>
          ) : null}
        </div>
      )}

      {docTarget ? (
        <RecordDocumentsDialog
          recordType="opd"
          recordId={docTarget.id}
          patientName={docTarget.patient_name}
          patientCode={docTarget.patient_code}
          canDelete={canDeleteDocuments}
          onClose={() => setDocTarget(null)}
        />
      ) : null}

      {voidTarget ? (
        <VoidBillDialog
          bill={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={(billId) => {
            setRows((rs) =>
              rs.map((r) => (r.bill_id === billId ? { ...r, bill_status: "void" } : r)),
            );
            toast.success(`Bill #${voidTarget.billNumber} cancelled.`);
            setVoidTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
