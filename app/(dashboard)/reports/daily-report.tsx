"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { printEndDay } from "@/components/print-end-day";
import { formatPaise } from "@/lib/money";
import { addDays } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/activity/actions";
import {
  generateDailyReportAction,
  type DailyReportResult,
} from "@/lib/reports/actions";
import type { ReportableStaff } from "@/lib/reports/repository";
import type { BillTypeValue } from "@/lib/reports/summary";
import { ChartCard, MoneyBarChart, PaymentModeDonut } from "./charts";

// The daily report screen (plan §5). Display + a date/subject control only - every
// number is server-computed by the pure shaper and arrives already shaped; this
// component NEVER sums money itself (dev-rules §2/§26). The breakdowns render as
// Recharts charts (./charts) in the app's calm teal palette; colour is for status
// only (§5). An admin gets a subject picker (Hospital total + any staff member);
// everyone else is pinned to their own data (server-enforced). Printable via the
// `end_day` pdfme template (components/print-end-day), the same design/print path
// as receipts - so a hospital with no end_day design gets no Print button.

const EVERYONE = "everyone";

// Titled role, matching lib/nav's ROLE_TITLE, for the staff picker's right hint.
const ROLE_HINT: Record<string, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  op_desk: "OP Desk",
  op_ip_desk: "OP + IP Desk",
};

// Status dot colour for an activity tile - colour is for status only (§5).
const DOT_TINT: Record<Tone, string> = {
  accent: "bg-primary",
  success: "bg-green-600",
  warning: "bg-amber-600",
  danger: "bg-destructive",
};

// One money KPI tile in the headline strip: an uppercase label, the rupee amount,
// and an optional note. `danger` tints a non-zero voided figure red (status colour
// only, §5). Number-forward and uniform so the strip reads as one clean row.
function StatTile({
  label,
  paise,
  note,
  danger,
}: {
  label: string;
  paise: number;
  note?: string;
  danger?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", danger && "border-destructive/30 bg-destructive/5")}>
      <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums", danger ? "text-destructive" : "text-foreground")}>
        ₹{formatPaise(paise)}
      </div>
      {note ? <div className="mt-0.5 text-xs font-medium text-muted-foreground">{note}</div> : null}
    </div>
  );
}

export function DailyReportView({
  initial,
  todayIso,
  staff,
  printable,
}: {
  initial: DailyReportResult;
  todayIso: string;
  staff: ReportableStaff[];
  // Server-resolved: is there an active End-Day design to print through? When
  // false, no Print button renders (print-updates plan §1c/§4c). The on-screen
  // report stays for reading regardless.
  printable: boolean;
}) {
  const [dayIso, setDayIso] = useState(initial.meta.dayIso);
  // The report subject: "everyone" (hospital-wide) or a specific staff member's id.
  const [subject, setSubject] = useState<string>(initial.meta.subjectUserId ?? EVERYONE);
  const [data, setData] = useState<DailyReportResult>(initial);
  const [pending, setPending] = useState(false);
  const latest = useRef(0);
  const mounted = useRef(false);

  // Re-fetch when the chosen day OR the subject changes. The first render already has
  // its data from the server (initial), so skip that pass - only user changes fetch.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const seq = ++latest.current;
    setPending(true);
    (async () => {
      const res = await generateDailyReportAction({ day: dayIso, subject });
      if (seq !== latest.current) return;
      setPending(false);
      if (res.ok && res.data) setData(res.data);
      else toast.error((!res.ok && res.formError) || "Could not load that report.");
    })();
  }, [dayIso, subject]);

  const { meta, report } = data;
  const atToday = dayIso >= todayIso;
  const everyone = meta.scope === "everyone";
  const isSelf = meta.subjectIsSelf;

  // Subject-adaptive wording - the numbers are the same shape either way.
  const subjectName = meta.subjectName ?? "";
  const activityHeading = everyone ? "Hospital activity" : isSelf ? "What I did" : "Activity";
  const collectedHeading = everyone ? "Collected" : isSelf ? "What I collected" : "Collected";

  // Only the bill types this subject can actually produce (server-derived from role).
  const byType = report.byType.filter((l) => meta.allowedBillTypes.includes(l.key as BillTypeValue));
  // Deposits/approvals only apply to roles that can admit / approve (or the whole
  // hospital view). Off-limits figures are simply not shown for that person.
  const showDeposits = everyone || meta.canAdmit;
  const showApproved = !everyone && meta.canApprove;

  // The subject picker options: the combined "Hospital total" first, then each
  // staff member.
  const subjectOptions: ComboboxOption[] = [
    { value: EVERYONE, label: "Hospital total" },
    ...staff.map((s): ComboboxOption => ({
      value: s.id,
      label: s.active ? s.name : `${s.name} (deactivated)`,
      hint: ROLE_HINT[s.role] ?? "Staff",
      keywords: s.role,
    })),
  ];

  return (
    <div className="w-full">
      {/* Controls - not part of the printed sheet. Title left; date + filters right. */}
      <div data-no-print className="mb-5 flex flex-nowrap items-center justify-between gap-4">
        <div className="shrink-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Daily report</h1>
          <p className="mt-0.5 text-sm font-medium text-muted-foreground">
            {everyone ? "Hospital-wide activity and collections" : isSelf ? "Your activity and collections" : `${subjectName}'s activity and collections`}
          </p>
        </div>

        <div className="flex flex-nowrap items-center justify-end gap-2 overflow-x-auto">
          {/* Subject picker - admin only (server still enforces who they may pick). */}
          {meta.canChooseSubject ? (
            <Combobox
              options={subjectOptions}
              value={subject}
              onChange={(v) => setSubject(v || EVERYONE)}
              ariaLabel="Report subject"
              searchPlaceholder="Search staff…"
              className="h-9 min-w-[190px]"
            />
          ) : null}

          <div className="flex h-9 items-center gap-1 rounded-lg border bg-white px-1">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => setDayIso((d) => addDays(d, -1))}
              className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <input
              type="date"
              value={dayIso}
              max={todayIso}
              onChange={(e) => e.target.value && setDayIso(e.target.value)}
              aria-label="Report date"
              className="h-7 rounded bg-transparent px-1 text-sm text-foreground outline-none"
            />
            <button
              type="button"
              aria-label="Next day"
              disabled={atToday}
              onClick={() => setDayIso((d) => addDays(d, 1))}
              className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDayIso(todayIso)}
            disabled={dayIso === todayIso}
          >
            Today
          </Button>
          {printable ? (
            <Button type="button" size="sm" onClick={() => printEndDay(dayIso, subject)}>
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
          ) : null}
        </div>
      </div>

      {/* The report body. */}
      <div className={cn("relative", pending && "opacity-60")}>
        {pending ? (
          <div
            data-no-print
            className="absolute right-0 top-0 z-10 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : null}

        {report.isEmpty ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <ClipboardList className="size-7" aria-hidden />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">No transactions on this day</p>
              <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
                {everyone
                  ? `Nothing was recorded at ${meta.hospitalName} for ${meta.dayLabel}.`
                  : isSelf
                    ? `Nothing was recorded under your account for ${meta.dayLabel}.`
                    : `Nothing was recorded under ${subjectName} for ${meta.dayLabel}.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* Collected - a headline KPI strip that fills the width. */}
            <section>
              <h2 className="mb-3 text-sm font-bold text-foreground">{collectedHeading}</h2>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
                {/* Hero: total collected, emphasised in the brand accent. */}
                <div className="rounded-xl border border-primary/20 bg-accent p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-foreground/80">
                    Total collected
                  </div>
                  <div className="mt-1.5 text-3xl font-bold tabular-nums text-accent-foreground">
                    ₹{formatPaise(report.collectedTotalPaise)}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-accent-foreground/70">
                    across {report.collectedCount} {report.collectedCount === 1 ? "bill" : "bills"}
                  </div>
                </div>

                <StatTile
                  label={everyone ? "Discounts given" : isSelf ? "Discounts on my bills" : "Discounts on bills"}
                  paise={report.discountOnMyBillsPaise}
                />
                {showApproved ? (
                  <StatTile
                    label={isSelf ? "Discounts I approved" : "Discounts approved"}
                    paise={report.discountsApproved.totalPaise}
                    note={`${report.discountsApproved.count} ${report.discountsApproved.count === 1 ? "approval" : "approvals"}`}
                  />
                ) : null}
                {showDeposits ? (
                  <StatTile
                    label="Admission deposits"
                    paise={report.advancesTotalPaise}
                    note={`${report.advancesCount} ${report.advancesCount === 1 ? "advance" : "advances"} · held`}
                  />
                ) : null}
              </div>

              {/* Charts row. */}
              <div
                className={cn(
                  "mt-4 grid gap-4 lg:grid-cols-2",
                  showDeposits && report.advancesCount > 0 && "xl:grid-cols-3",
                )}
              >
                <ChartCard
                  caption="By payment mode (reconciliation)"
                  footerLabel="Total collected"
                  footerValue={`₹${formatPaise(report.collectedTotalPaise)}`}
                >
                  <PaymentModeDonut lines={report.byMode} totalPaise={report.collectedTotalPaise} />
                </ChartCard>
                <ChartCard
                  caption="By bill type"
                  footerLabel="Total collected"
                  footerValue={`₹${formatPaise(report.collectedTotalPaise)}`}
                >
                  <MoneyBarChart lines={byType} />
                </ChartCard>
                {showDeposits && report.advancesCount > 0 ? (
                  <ChartCard
                    caption="Admission deposits by mode"
                    footerLabel="Total deposits"
                    footerValue={`₹${formatPaise(report.advancesTotalPaise)}`}
                  >
                    <MoneyBarChart lines={report.advancesByMode} />
                  </ChartCard>
                ) : null}
              </div>
            </section>

            {/* Activity - a compact tile grid across the full width. */}
            <section>
              <h2 className="mb-3 text-sm font-bold text-foreground">{activityHeading}</h2>
              {report.activity.length === 0 ? (
                <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No logged actions on this day.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                  {report.activity.map((a) => (
                    <div key={a.action} className="rounded-xl border bg-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {a.label}
                        </span>
                        <span className={cn("size-2 shrink-0 rounded-full", DOT_TINT[a.tone])} aria-hidden />
                      </div>
                      <div className="mt-2 text-3xl font-bold tabular-nums text-foreground">{a.count}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
