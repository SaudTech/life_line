"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Loader2,
  Printer,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DayStepper } from "@/components/day-stepper";
import { printEndDay } from "@/components/print-end-day";
import { describeShareRate } from "@/lib/doctors/share";
import { formatPaise } from "@/lib/money";
import { roleTitle } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/activity/actions";
import {
  generateDailyReportAction,
  type DailyReportResult,
} from "@/lib/reports/actions";
import type { ReportableStaff } from "@/lib/reports/repository";
import type {
  BillTypeValue,
  DocumentComplianceLine,
  DoctorShareRow,
} from "@/lib/reports/summary";
import { PaymentModeDonut } from "./charts";

// The daily report screen (plan §5). Display + a date/subject control only - every
// number is server-computed by the pure shaper and arrives already shaped; this
// component NEVER sums money itself (dev-rules §2/§26). An admin gets a subject
// picker (Hospital total + any staff member); everyone else is pinned to their own
// data (server-enforced).
//
// PRINTING - two routes onto paper, and they are NOT redundant:
//   • Print → window.print(). The screen IS the paper (@media print in globals.css).
//     Exact, includes the donut, can never drift from what was reviewed on screen.
//   • PDF → the `end_day` pdfme template (lib/printing/defaults/end_day.ts), which is
//     laid out as this sheet's paper twin. A true A4 PDF: no browser URL/date in the
//     margins, letterhead band reserved, re-designable by an admin in Receipt
//     Templates. Gated on a template existing; the route re-authorizes regardless.
// The template is a SECOND expression of this design - change one, change the other.
//
// WHY THIS IS A SHEET AND NOT A DASHBOARD: /admin answers "how is the hospital doing
// right now" - it is live, unbounded in time, and asks the admin to ACT. This screen
// answers "does the till match, and who did what" for ONE clinic day and ONE subject,
// and its whole purpose is the A4 sheet it prints. When both screens wore the same
// KPI-tiles-then-charts costume they read as the same page, so this one is deliberately
// a DOCUMENT: a paper surface, a masthead naming hospital/day/subject, ruled ledger
// rows with right-aligned tabular amounts, and a double-ruled grand total. Keep it that
// way - do not reintroduce trend badges, sparklines, or hero stat cards here. Those are
// dashboard vocabulary and they belong on /admin.

const EVERYONE = "everyone";

// Status dot colour for an activity row - colour is for status only (§5).
const DOT_TINT: Record<Tone, string> = {
  accent: "bg-primary",
  success: "bg-green-600",
  warning: "bg-amber-600",
  danger: "bg-destructive",
};

// ── Document primitives ───────────────────────────────────────────────────────
// A rupee figure on a ledger line. A negative is written "-₹2,000.00", NEVER
// "₹-2,000.00": the sign belongs to the quantity, not inside the currency, and a
// minus hidden after the symbol is exactly what gets skipped by an eye running down
// a column of amounts - on the sheet someone counts the drawer against. Negatives are
// real here (a discharge whose advance exceeded the final bill lands as a negative IP
// total), so this is not a theoretical case.
function Money({ paise }: { paise: number }) {
  return (
    <>
      {paise < 0 ? "-" : ""}₹{formatPaise(Math.abs(paise))}
    </>
  );
}

// A titled band of the sheet. The heading is a small letterspaced rule-line, not a
// card header - sections here are parts of one document, not separate panels.
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  // break-inside-avoid: a ledger split across a page boundary puts rows on one sheet
  // and their subtotal on another, which is how a figure gets counted twice.
  return (
    <section className="mt-7 break-inside-avoid first:mt-0">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h2>
      {note ? (
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground/80">{note}</p>
      ) : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

// The ledger table frame. Fixed columns so an eye can run straight down the amounts.
function Ledger({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <colgroup>
        <col />
        <col className="w-28" />
        <col className="w-36" />
      </colgroup>
      <tbody>{children}</tbody>
    </table>
  );
}

// One ruled ledger line: label, an optional count, the amount. A zero line is muted
// but NEVER dropped - the shaper zero-fills every type/mode so the sheet's layout is
// identical every day (§5, nothing moves, muscle memory).
function Line({
  label,
  hint,
  count,
  countLabel,
  paise,
  muted,
  strike,
  indent,
  strong,
}: {
  label: string;
  hint?: string;
  count?: number;
  countLabel?: string;
  paise: number;
  muted?: boolean;
  strike?: boolean;
  // A sub-row of the line above it (the consultation split's doctor/hospital
  // rows) - indented so the eye reads it as a breakdown, not a new item.
  indent?: boolean;
  // Bold label + amount for a line that is a conclusion (the hospital share)
  // without being a section Subtotal.
  strong?: boolean;
}) {
  const dim = muted ?? paise === 0;
  return (
    <tr className="border-b border-border/70">
      <td className={cn("py-2 pr-3 align-top", indent && "pl-5")}>
        <span
          className={cn(
            "text-sm",
            strong ? "font-bold" : "font-medium",
            dim ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground/80">{hint}</span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right align-top text-xs font-medium tabular-nums text-muted-foreground">
        {countLabel ?? (count != null ? count : "")}
      </td>
      <td
        className={cn(
          "py-2 pl-3 text-right align-top text-sm tabular-nums",
          strong ? "font-bold" : "font-semibold",
          dim ? "text-muted-foreground" : "text-foreground",
          strike && "text-muted-foreground line-through decoration-1",
        )}
      >
        <Money paise={paise} />
      </td>
    </tr>
  );
}

// The doctor's rate beside their name, from the ONE wording rule
// (describeShareRate) so this sheet and the doctor-earnings sheet can never word
// the same rate differently. A payout figure with no visible rate invites an
// argument at settlement time.
//
// The rate is the one FROZEN onto those bills (migration 0025), not the doctor's
// configuration today - it is exactly what the figure beside it was computed with,
// which is the whole point of showing it. A doctor whose rate changed mid-day
// therefore appears once per rate.
//
// Legacy bills from before 0025 carry an amount but no recorded rate; those read
// "rate not recorded" rather than being given a rate they never had.
function shareRateLabel(d: DoctorShareRow): string {
  return describeShareRate(d, formatPaise) ?? "rate not recorded";
}

// A doctor can now contribute SEVERAL rows in one window (one per rate they were
// billed at), so the row key has to carry the rate too - keyed on doctorId alone,
// React would drop every row after the first.
function shareRowKey(d: DoctorShareRow): string {
  return `share-${d.doctorId}-${d.shareType ?? "none"}-${d.sharePercentage ?? ""}-${d.shareFlatPaise ?? ""}`;
}

// How many pending records are listed by name before collapsing to "+N more" -
// keeps a badly-behind day from turning the sheet into pages of chips while
// still giving enough to start working through.
const MAX_PENDING_LISTED = 24;

// One record-kind block of the Document uploads section: the "90 of 100 with
// documents" tally, then - when something is owed - the exact records still
// pending as compact chips (record # + patient), so the staff member can go
// finish the work instead of hunting for which ones are missing. Amber = work
// outstanding, green = complete; colour is for status only (§5).
function DocumentComplianceRows({
  label,
  line,
}: {
  label: string;
  line: DocumentComplianceLine;
}) {
  const pendingCount = line.pending.length;
  const shown = line.pending.slice(0, MAX_PENDING_LISTED);
  const more = pendingCount - shown.length;
  return (
    <>
      <tr className={cn(pendingCount === 0 && "border-b border-border/70")}>
        <td className="py-2 pr-3 text-sm font-medium text-foreground">{label}</td>
        <td className="w-48 py-2 pl-3 text-right text-sm tabular-nums">
          <span className="font-semibold text-foreground">
            {line.withDocuments} of {line.total}
          </span>
          <span className="text-muted-foreground"> with documents</span>
        </td>
        <td className="w-28 py-2 pl-3 text-right text-sm font-semibold tabular-nums">
          {pendingCount > 0 ? (
            <span className="text-amber-600">{pendingCount} pending</span>
          ) : (
            <span className="text-green-600">Complete</span>
          )}
        </td>
      </tr>
      {pendingCount > 0 ? (
        <tr className="border-b border-border/70">
          <td colSpan={3} className="pb-2.5 pt-0.5">
            <div className="flex flex-wrap gap-1.5">
              {shown.map((p) => (
                <span
                  key={p.recordId}
                  className="rounded border border-amber-600/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                >
                  #{p.recordId} · {p.patientName}{" "}
                  <span className="font-mono">{p.patientCode}</span>
                </span>
              ))}
              {more > 0 ? (
                <span className="self-center text-[11px] font-medium text-muted-foreground">
                  +{more} more
                </span>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// A section subtotal: a single rule above, bolder type. Ledger convention.
function Subtotal({ label, count, paise }: { label: string; count?: number; paise: number }) {
  return (
    <tr className="border-t-2 border-foreground/70">
      <td className="pt-2 pr-3 text-sm font-bold text-foreground">{label}</td>
      <td className="px-3 pt-2 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {count != null ? count : ""}
      </td>
      <td className="pt-2 pl-3 text-right text-sm font-bold tabular-nums text-foreground">
        <Money paise={paise} />
      </td>
    </tr>
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
  // Server-resolved: is there an active `end_day` design to render a PDF through?
  // Gates the PDF button only (print-updates plan §1c/§4c). The browser Print button
  // never depends on it - that one prints the DOM, which always exists.
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
  const everyone = meta.scope === "everyone";
  const isSelf = meta.subjectIsSelf;

  // Subject-adaptive wording - the numbers are the same shape either way.
  const subjectName = meta.subjectName ?? "";
  const subjectLabel = everyone ? "Hospital total (all staff)" : subjectName;
  const activityHeading = everyone ? "Hospital activity" : isSelf ? "What I did" : "Activity";

  // Only the bill types this subject can actually produce (server-derived from role).
  const byType = report.byType.filter((l) =>
    meta.allowedBillTypes.includes(l.key as BillTypeValue),
  );
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
      hint: roleTitle(s.role),
      keywords: s.role,
    })),
  ];

  // The pending-uploads callout, phrased for the subject: "3 consultations and
  // 1 IP discharge". Counts come straight off the shaped report - never re-derived.
  const docs = report.documents;
  const pendingParts: string[] = [];
  if (docs.opd.pending.length > 0) {
    pendingParts.push(
      `${docs.opd.pending.length} ${docs.opd.pending.length === 1 ? "consultation" : "consultations"}`,
    );
  }
  if (docs.ipd.pending.length > 0) {
    pendingParts.push(
      `${docs.ipd.pending.length} ${docs.ipd.pending.length === 1 ? "IP discharge" : "IP discharges"}`,
    );
  }
  const pendingCallout =
    pendingParts.length === 0
      ? ""
      : everyone
        ? `Pending across the hospital: documents still to be uploaded for ${pendingParts.join(" and ")}.`
        : isSelf
          ? `Pending work: you still need to upload documents for ${pendingParts.join(" and ")}.`
          : `Pending work: ${subjectName} still needs to upload documents for ${pendingParts.join(" and ")}.`;

  // Refunds are NOT here any more: they are a subtracted line in the money-in working
  // below, because they are real cash leaving the drawer, not a footnote.
  const hasAdjustments =
    report.discountOnMyBillsPaise > 0 ||
    (showApproved && report.discountsApproved.count > 0) ||
    report.voids.count > 0;

  return (
    <div className="w-full pb-10 print:pb-0">
      {/* ── Toolbar. Not part of the sheet and not part of the print: this is the
          desk furniture you use to CHOOSE which document to look at. It sits above
          the paper, deliberately in the app's normal UI language. */}
      <div data-no-print className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-3">
        {/* Back to Admin - only for an admin, who reached this from the admin
            dashboard and expects the same back link every other admin screen has.
            A desk/supervisor lands here as their own nav destination, so there is
            no /admin to go back to (and they can't open it). `canChooseSubject` is
            the server's admin flag (§8) - this never grants access, only a link. */}
        {meta.canChooseSubject ? (
          <Link
            href="/admin"
            className="inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to Admin
          </Link>
        ) : null}

        {/* flex-wrap, not overflow-x-auto: on a phone the old sideways scroll
            clipped the day picker off the left edge; wrapping keeps every
            control visible. Desktop widths never wrap - nothing changes there. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {pending ? (
            <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-medium text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading…
            </span>
          ) : null}

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

          <DayStepper day={dayIso} todayIso={todayIso} onChange={setDayIso} />
          {/* TWO ways onto paper, deliberately. They are not duplicates:
              - Print: window.print(). The sheet below IS the printed page (the
                @media print rules in globals.css hide this toolbar and the app bar),
                so what comes out is exactly what is on screen, including the donut.
                Nothing to design, nothing to drift.
              - PDF: the `end_day` pdfme template. A real A4 PDF - no browser URL/date
                stamped in the margins, letterhead band reserved, and an admin can
                re-lay it out in Receipt Templates. Gated on a template existing, the
                same rule every other print button follows (§1b); the route re-checks.
              Both are pure GETs of the same day+subject and fully retryable. */}
          <Button type="button" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            Print
          </Button>
          {printable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => printEndDay(dayIso, subject)}
            >
              <FileText className="size-4" aria-hidden />
              PDF
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── The sheet. White paper on the cool canvas, A4-ish measure. */}
      {/* On paper the sheet IS the page, so it sheds the affordances that made it
          look like paper on screen: the card border, the drop shadow, the rounded
          corners and the centred measure all exist to sell "a document on a desk",
          and printing them would draw a box around the page inside the page. */}
      <article
        className={cn(
          "mx-auto max-w-4xl rounded-lg border bg-card shadow-sm transition-opacity",
          "print:max-w-none print:rounded-none print:border-0 print:shadow-none",
          pending && "opacity-60",
        )}
      >
        {/* Masthead: who, what, when, for whom. This is what makes the screen a
            document - it states its own scope, so a printed copy left on a desk is
            never ambiguous about which day or which person it covers. */}
        <header className="border-b-2 border-foreground/80 px-8 pb-5 pt-7 print:px-0 print:pt-0">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div>
              <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
                {meta.hospitalName}
              </h1>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                End of day report
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:text-right">
              <dt className="font-medium text-muted-foreground">Date</dt>
              <dd className="font-semibold text-foreground">{meta.dayLabel}</dd>
              <dt className="font-medium text-muted-foreground">Subject</dt>
              <dd className="font-semibold text-foreground">
                {subjectLabel}
                {meta.subjectRoleTitle ? (
                  <span className="font-medium text-muted-foreground"> · {meta.subjectRoleTitle}</span>
                ) : null}
              </dd>
              <dt className="font-medium text-muted-foreground">Generated</dt>
              <dd className="font-medium text-muted-foreground">
                {meta.generatedAtLabel} · {meta.generatedByName}
              </dd>
            </dl>
          </div>
        </header>

        <div className="px-8 pb-8 pt-6 print:px-0 print:pb-0">
          {report.isEmpty ? (
            // An honest empty day, still inside the sheet: the masthead above already
            // says which day and whose - so this reads as a document that certifies
            // nothing happened, not as a page that failed to load (§7).
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <ClipboardList className="size-6" aria-hidden />
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
            <>
              {/* Collections, by what was billed. */}
              <Section
                title="Collections"
                note="Money taken at the counter for bills issued today."
              >
                <Ledger>
                  {byType.map((l) => (
                    <Fragment key={l.key}>
                      <Line
                        label={l.label}
                        // An in-patient bill collects only the BALANCE left after its
                        // advance, so this figure is routinely far below what was billed -
                        // and ₹0 for a stay the advance covered in full. Say so on the row
                        // itself; a bare "In-patient · 1 bill · ₹0.00" invites the reader
                        // to conclude the sheet lost their money.
                        hint={
                          l.key === "ip"
                            ? "Balance settled at discharge only - the advance is under Admission deposits."
                            : undefined
                        }
                        count={l.count}
                        countLabel={`${l.count} ${l.count === 1 ? "bill" : "bills"}`}
                        paise={l.totalPaise}
                      />
                      {/* The consultation split, indented under its parent row: each
                          doctor's cut deducted per their configured rate (percentage or
                          flat - the row says which), then the hospital's share as the
                          remainder. All shaper-computed. INFORMATIONAL: these rows
                          decompose the Consultation figure above - they are NOT extra
                          items, so Total collected does not sum them, and the doctors'
                          cut never touches Money in below.

                          This is what the day EARNED the doctors, not what they were
                          handed: the cash is still in the drawer until somebody settles
                          it on /doctor-earnings, and that settlement appears as its own
                          "Doctors paid" deduction in the money-in working. Subtracting
                          this figure as well would take the same rupees out twice. */}
                      {l.key === "consultation" && report.doctorShares.length > 0
                        ? [
                            ...report.doctorShares.map((d) => (
                              <Line
                                key={shareRowKey(d)}
                                indent
                                label={`${d.doctorName} (${shareRateLabel(d)})`}
                                countLabel={`${d.count} ${d.count === 1 ? "consultation" : "consultations"}`}
                                paise={-d.sharePaise}
                              />
                            )),
                            <Line
                              key="hospital-share"
                              indent
                              strong
                              label="Hospital share"
                              paise={report.hospitalShareTotalPaise}
                              muted={false}
                            />,
                          ]
                        : null}
                    </Fragment>
                  ))}
                  <Subtotal
                    label="Total collected"
                    count={report.collectedCount}
                    paise={report.collectedTotalPaise}
                  />
                </Ledger>
              </Section>

              {/* By payment mode - the breakdown you physically count against. The
                  donut sits beside the rows as the share-of-drawer read; the rows
                  remain the authority (every mode, zero-filled, exact). */}
              <Section
                title="By payment mode"
                note="Count these against the drawer and the machine settlements."
              >
                {/* print: variants are load-bearing here, not polish. A printed page
                    lays out at ~688px (A4 less margins), which is BELOW `lg` - so the
                    lg: rules silently do not apply on paper and this would print as a
                    stacked, full-width donut. */}
                <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center print:grid-cols-[1fr_auto] print:items-center">
                  <Ledger>
                    {report.byMode.map((l) => (
                      <Line key={l.key} label={l.label} count={l.count} paise={l.totalPaise} />
                    ))}
                    <Subtotal
                      label="Total collected"
                      count={report.collectedCount}
                      paise={report.collectedTotalPaise}
                    />
                  </Ledger>
                  {/* Deliberately NOT `hidden lg:block`. Recharts sizes itself by
                      measuring this box, and a display:none box measures zero and
                      never renders - so hiding the donut on a narrow screen would
                      leave nothing for the printer to put on paper either, and the
                      chart would vanish from the sheet without a trace. It always
                      renders; the grid stacks it under the ledger when space is tight. */}
                  <div className="break-inside-avoid">
                    <PaymentModeDonut
                      lines={report.byMode}
                      totalPaise={report.collectedTotalPaise}
                      showLegend={false}
                    />
                  </div>
                </div>
              </Section>

              {/* Admission deposits: cash taken at admit that never becomes a bill.
                  It is in the drawer, so it must be on the sheet - by mode, for the
                  same reason the bills are. */}
              {showDeposits && report.advancesCount > 0 ? (
                <Section title="Admission deposits" note="Held against a future discharge bill.">
                  <Ledger>
                    {report.advancesByMode.map((l) => (
                      <Line key={l.key} label={l.label} count={l.count} paise={l.totalPaise} />
                    ))}
                    <Subtotal
                      label="Total deposits held"
                      count={report.advancesCount}
                      paise={report.advancesTotalPaise}
                    />
                  </Ledger>
                </Section>
              ) : null}

              {/* Memoranda: real figures that must NOT be added or subtracted again.
                  Each says so on its own line - an unlabelled number on a money sheet
                  is an invitation to double-count it. */}
              {hasAdjustments ? (
                <Section title="Memoranda" note="For the record - already reflected in the totals above.">
                  <Ledger>
                    {report.discountOnMyBillsPaise > 0 ? (
                      <Line
                        label={everyone ? "Discounts given" : isSelf ? "Discounts on my bills" : "Discounts on bills"}
                        hint="Already deducted from the collected figure."
                        paise={report.discountOnMyBillsPaise}
                      />
                    ) : null}
                    {showApproved && report.discountsApproved.count > 0 ? (
                      <Line
                        label={isSelf ? "Discounts I approved" : "Discounts approved"}
                        hint="Approved for other staff's bills - not this subject's revenue."
                        count={report.discountsApproved.count}
                        countLabel={`${report.discountsApproved.count} ${report.discountsApproved.count === 1 ? "approval" : "approvals"}`}
                        paise={report.discountsApproved.totalPaise}
                      />
                    ) : null}
                    {report.voids.count > 0 ? (
                      <Line
                        label="Bills voided"
                        hint="Cancelled - never counted as money in."
                        count={report.voids.count}
                        countLabel={`${report.voids.count} ${report.voids.count === 1 ? "bill" : "bills"}`}
                        paise={report.voids.totalPaise}
                        strike
                      />
                    ) : null}
                  </Ledger>
                </Section>
              ) : null}

              {/* The one number that has to match the drawer at close - shown as its
                  WORKING, not as a lump. Every part is a real movement of cash, in the
                  order it moved, so a person counting the till can follow the arithmetic
                  instead of reconstructing it: money taken for bills, money taken as
                  deposits, money handed back. The old sheet folded the refund into the
                  in-patient bill line, which made a stay billed ₹18,000 against a
                  ₹20,000 advance read "In-patient · 1 bill · −₹2,000". Right total,
                  unreadable line. Keep the parts visible. */}
              <section className="mt-8 break-inside-avoid">
                <Ledger>
                  <Line label="Bills collected" paise={report.collectedTotalPaise} muted={false} />
                  {showDeposits && report.advancesCount > 0 ? (
                    <Line
                      label="Admission deposits taken"
                      hint="Cash in at admit, against a future discharge bill."
                      paise={report.advancesTotalPaise}
                      muted={false}
                    />
                  ) : null}
                  {report.refunds.count > 0 ? (
                    <Line
                      label="Refunds paid out"
                      hint="Cash back to the patient where an advance exceeded the final bill."
                      countLabel={`${report.refunds.count} ${report.refunds.count === 1 ? "refund" : "refunds"}`}
                      paise={-report.refunds.totalPaise}
                      muted={false}
                    />
                  ) : null}
                  {/* Doctors paid. The one outflow nothing else on this sheet knows
                      about: a refund is already netted inside the bill it came from,
                      but no bill records a payout, so before this line the sheet asked
                      the counter to produce cash that had physically left hours
                      earlier. Do NOT confuse it with the doctors' cut under
                      Collections above - that money is still in the drawer.

                      The per-doctor rows are indented BREAKDOWN, not extra items: the
                      parent line already carries the whole deduction, exactly like the
                      consultation split decomposes its own parent. "Which doctor, for
                      how many consultations" is the first question asked when a till
                      is short, so the sheet answers it by name. */}
                  {report.doctorPayouts.length > 0
                    ? [
                        <Line
                          key="doctors-paid"
                          label="Doctors paid"
                          hint="Cash handed to doctors for their consultations - it has left the drawer."
                          countLabel={`${report.doctorPayoutCount} ${report.doctorPayoutCount === 1 ? "consultation" : "consultations"}`}
                          paise={-report.doctorPayoutTotalPaise}
                          muted={false}
                        />,
                        ...report.doctorPayouts.map((p) => (
                          <Line
                            key={`paid-${p.doctorId}`}
                            indent
                            label={p.doctorName}
                            countLabel={`${p.count} ${p.count === 1 ? "consultation" : "consultations"}`}
                            paise={-p.paise}
                          />
                        )),
                      ]
                    : null}
                </Ledger>

                <div className="mt-1 border-t-4 border-double border-foreground/80 pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <div>
                      <span className="text-sm font-bold uppercase tracking-widest text-foreground">
                        Money in
                      </span>
                      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                        {report.doctorPayouts.length > 0
                          ? "Taken in, less what was handed back and paid to doctors. Reconcile the drawer against this."
                          : "This is the figure to reconcile against the drawer at close."}
                      </p>
                    </div>
                    <span className="font-serif text-3xl font-bold tabular-nums text-foreground">
                      <Money paise={report.moneyInTotalPaise} />
                    </span>
                  </div>
                </div>
              </section>

              {/* Activity - counts of what was logged, as ruled rows rather than
                  number tiles. Same reason as everything above: this is a sheet. */}
              <Section title={activityHeading}>
                {report.activity.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">No logged actions on this day.</p>
                ) : (
                  <table className="w-full border-collapse">
                    <tbody>
                      {report.activity.map((a) => (
                        <tr key={a.action} className="border-b border-border/70">
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-2">
                              <span
                                className={cn("size-1.5 shrink-0 rounded-full", DOT_TINT[a.tone])}
                                aria-hidden
                              />
                              <span className="text-sm font-medium text-foreground">{a.label}</span>
                            </span>
                          </td>
                          <td className="w-20 py-2 pl-3 text-right text-sm font-semibold tabular-nums text-foreground">
                            {a.count}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-foreground/70">
                        <td className="pt-2 pr-3 text-sm font-bold text-foreground">Total actions</td>
                        <td className="pt-2 pl-3 text-right text-sm font-bold tabular-nums text-foreground">
                          {report.activityTotal}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </Section>

              {/* Document uploads - pending WORK, not money. Every consultation and
                  IP discharge is supposed to get its scans uploaded (the paperclip on
                  the OPD/IPD lists); this section is where a shortfall is called out
                  per subject, with the exact records still owing. Checked live, so
                  yesterday's sheet cleans itself up as the uploads come in. Only
                  rendered when the day actually produced records of a kind - an
                  op_desk sheet never shows an empty IP row. */}
              {docs.opd.total > 0 || docs.ipd.total > 0 ? (
                <Section
                  title="Document uploads"
                  note="Scans and case studies for the day's records - checked live, so later uploads clear from here."
                >
                  <table className="w-full border-collapse">
                    <tbody>
                      {docs.opd.total > 0 ? (
                        <DocumentComplianceRows label="OPD consultations" line={docs.opd} />
                      ) : null}
                      {docs.ipd.total > 0 ? (
                        <DocumentComplianceRows label="IP discharges" line={docs.ipd} />
                      ) : null}
                    </tbody>
                  </table>
                  {docs.pendingTotal > 0 ? (
                    <p className="mt-2 text-xs font-semibold text-amber-600">{pendingCallout}</p>
                  ) : (
                    <p className="mt-2 text-xs font-medium text-green-600">
                      All of this day&apos;s records have their documents uploaded.
                    </p>
                  )}
                </Section>
              ) : null}
            </>
          )}
        </div>
      </article>
    </div>
  );
}
