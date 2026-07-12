"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Loader2, Syringe, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { printReceipt } from "@/components/print-receipt";
import { BillRowActions } from "@/components/bill-row-actions";
import { VoidBillDialog, type VoidableBill } from "@/components/void-bill-dialog";
import { ServiceCombobox } from "@/components/service-combobox";
import { formatPaise } from "@/lib/money";
import { listProcedureBillsAction } from "@/lib/procedures/actions";
import type { ProcedureBillListRow } from "@/lib/procedures/repository";
import type { ServiceRow } from "@/lib/services/repository";
import { clinicToday, presetRange } from "@/lib/date-range";
import { DateRangeFilter, type DatePresetValue } from "@/components/date-range-filter";

const PAY_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

type Creator = { id: string; name: string };

type Filters = {
  q: string;
  createdBy: string;
  datePreset: DatePresetValue;
  dateFrom: string;
  dateTo: string;
  minAmount: string;
  maxAmount: string;
  serviceId: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  createdBy: "",
  datePreset: "",
  dateFrom: "",
  dateTo: "",
  minAmount: "",
  maxAmount: "",
  serviceId: "",
};

// The page opens scoped to today's bills (the common case at the counter),
// not the full unfiltered history. "Clear filters" returns here, not to
// EMPTY_FILTERS - "today" stays the baseline view.
function defaultFilters(): Filters {
  const today = presetRange("today", clinicToday());
  return { ...EMPTY_FILTERS, datePreset: "today", dateFrom: today.dateFrom, dateTo: today.dateTo };
}

// All procedure bills, newest first. Preloaded on the server; every filter
// below (free text, who created it, date range, amount range, or a specific
// service sold) re-queries the server on demand, debounced - the server is
// the one source of truth for what matches, never a client-side re-filter of
// a fixed page of rows. Layout follows the User Management design system.
export function ProceduresList({
  initial,
  creators,
  services,
  printable,
}: {
  initial: ProcedureBillListRow[];
  creators: Creator[];
  services: ServiceRow[];
  // Server-resolved Print gate for this location's procedure design (§1c).
  printable: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [rows, setRows] = useState<ProcedureBillListRow[]>(initial);
  const [pending, setPending] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidableBill | null>(null);
  const latest = useRef(0);

  const hasFilters = Object.entries(filters).some(
    ([key, v]) => v !== defaultFilters()[key as keyof Filters],
  );

  useEffect(() => {
    const seq = ++latest.current;
    setPending(true);
    const t = setTimeout(async () => {
      const res = await listProcedureBillsAction({
        q: filters.q.trim() || undefined,
        createdBy: filters.createdBy || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        minAmount: filters.minAmount || undefined,
        maxAmount: filters.maxAmount || undefined,
        serviceId: filters.serviceId || undefined,
      });
      if (seq !== latest.current) return;
      setPending(false);
      if (res.ok) setRows(res.data ?? []);
      else toast.error(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not load procedures.");
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/procedures"
        className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Bill a procedure
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Procedures</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Every procedure bill, newest first.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search by patient, phone, ID, doctor, or bill number"
            aria-label="Search procedures"
            className="w-full pl-8 pr-8"
          />
          {pending ? (
            <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>

        <Combobox
          options={[
            { value: "all", label: "Anyone" },
            ...creators.map((c): ComboboxOption => ({ value: c.id, label: c.name })),
          ]}
          value={filters.createdBy || "all"}
          onChange={(v) => set("createdBy", v === "all" ? "" : v)}
          ariaLabel="Filter by who created it"
          searchPlaceholder="Search staff…"
          className="min-w-[140px] sm:w-auto"
        />

        <DateRangeFilter
          preset={filters.datePreset}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChange={(next) =>
            setFilters((f) => ({
              ...f,
              datePreset: next.preset,
              dateFrom: next.dateFrom,
              dateTo: next.dateTo,
            }))
          }
        />

        {/* Min / Max / service kept together so the service dropdown never wraps
            away from the amount range - the group wraps as one unit. */}
        <div className="flex items-center gap-2.5">
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={filters.minAmount}
            onChange={(e) => set("minAmount", e.target.value)}
            placeholder="Min ₹"
            aria-label="Minimum amount in rupees"
            className="w-[104px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={filters.maxAmount}
            onChange={(e) => set("maxAmount", e.target.value)}
            placeholder="Max ₹"
            aria-label="Maximum amount in rupees"
            className="w-[104px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />

          <ServiceCombobox
            services={services}
            value={filters.serviceId}
            onChange={(serviceId) => set("serviceId", serviceId)}
            placeholder="Any service"
            clearLabel="Any service"
            className="h-9 min-w-[150px]"
          />
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-4 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Showing <b className="text-secondary-foreground">{rows.length}</b>{" "}
          {rows.length === 1 ? "procedure" : "procedures"}
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Date</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Patient</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Consultation</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Items</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Created by</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const isVoid = b.bill_status === "void";
                  return (
                  <tr
                    key={b.id}
                    className="border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {b.created_label}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{b.patient_name}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{b.patient_code}</span>
                        {b.phone ? ` · ${b.phone}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {b.doctor_name ?? <span className="text-muted-foreground/60">-</span>}
                      {b.consultation_id ? (
                        <div className="text-xs text-muted-foreground">
                          #{b.consultation_id}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-muted-foreground">
                      <span className="line-clamp-2">
                        {b.items_summary || <span className="text-muted-foreground/60">-</span>}
                      </span>
                      <div className="text-xs text-muted-foreground/80">
                        {b.item_count} {b.item_count === 1 ? "line" : "lines"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {b.created_by_name ?? <span className="text-muted-foreground/60">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div
                        className={
                          "font-semibold tabular-nums " +
                          (isVoid ? "text-muted-foreground line-through" : "text-foreground")
                        }
                      >
                        ₹{formatPaise(b.total_paise)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {Number(b.discount_paise ?? "0") > 0
                          ? `−₹${formatPaise(b.discount_paise)} · `
                          : ""}
                        {b.payment_mode ? PAY_LABELS[b.payment_mode] ?? b.payment_mode : ""}
                        {b.bill_number ? ` · #${b.bill_number}` : ""}
                      </div>
                      {isVoid ? (
                        <Badge variant="destructive" className="mt-1">
                          Cancelled
                        </Badge>
                      ) : null}
                      {b.replaced_by_number ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Replaced by #{b.replaced_by_number}
                        </div>
                      ) : null}
                      {b.reissue_of_number ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Fix of #{b.reissue_of_number}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <BillRowActions
                        isCancelled={isVoid}
                        replaced={!!b.replaced_by_number}
                        printable={printable}
                        onPrint={() => printReceipt(b.id, b.bill_number, { copy: "duplicate" })}
                        onCancel={() =>
                          setVoidTarget({
                            id: b.id,
                            billNumber: b.bill_number,
                            patientName: b.patient_name,
                            patientCode: b.patient_code,
                            totalLabel: `₹${formatPaise(b.total_paise)}`,
                          })
                        }
                        onReissue={() => router.push(`/procedures?replaces=${b.id}`)}
                      />
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
            <Syringe className="size-7" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {hasFilters ? "No procedures found" : "No procedures yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
              {hasFilters
                ? "No procedure bill matches these filters."
                : "Billed procedures will appear here."}
            </p>
          </div>
          {hasFilters ? (
            <Button type="button" variant="outline" onClick={() => setFilters(defaultFilters())}>
              Clear filters
            </Button>
          ) : null}
        </div>
      )}

      {voidTarget ? (
        <VoidBillDialog
          bill={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={(billId) => {
            // Reflect the void at once (the row keeps its place, flips to VOID) so
            // the counter sees the result without a full reload.
            setRows((rs) => rs.map((r) => (r.id === billId ? { ...r, bill_status: "void" } : r)));
            toast.success(`Bill #${voidTarget.billNumber} cancelled.`);
            setVoidTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
