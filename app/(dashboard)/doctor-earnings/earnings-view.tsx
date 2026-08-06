"use client";

import { useState, useTransition } from "react";
import {
  BadgeIndianRupee,
  CheckCircle2,
  Clock,
  Loader2,
  Printer,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DayStepper } from "@/components/day-stepper";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  generateDoctorEarningsAction,
  settleDoctorPayoutAction,
} from "@/lib/doctors/earnings-actions";
import type { EarningsDoctorOption } from "@/lib/doctors/earnings-repository";
import type {
  DoctorEarningLine,
  DoctorEarningsReport,
  DoctorEarningsResult,
} from "@/lib/doctors/earnings";
import {
  MAX_GAP_MINUTES,
  MIN_GAP_MINUTES,
  type DoctorSession,
} from "@/lib/doctors/sessions";

// The doctor-earnings sheet. Display + controls only: every figure arrives already
// computed by the pure shaper (lib/doctors/earnings.ts) and this component NEVER
// sums money itself (dev-rules §2/§26).
//
// WHY THIS IS ITS OWN SCREEN. /reports answers "does MY till match" - it is scoped
// to one staff member and one clinic day, and the doctor's cut appears there only as
// a sub-line decomposing that person's consultation collections. This screen answers
// a different question with a different subject: "what does DR KHALID have coming",
// across every desk that billed for him, for a window that can be narrower than a
// day. It is deliberately a DOCUMENT in the same vocabulary as the day sheet (ruled
// ledger rows, right-aligned tabular amounts, a masthead naming its own scope) so
// the two read as one system - but it is not a variant of it and must not grow
// drawer/till vocabulary.
//
// WHAT IT CLAIMS. Since migration 0026 this is both a statement of what is OWED and
// a record of what has been PAID: settling a window writes a payout row, and no
// consultation can belong to two live payouts. So the headline figure is always the
// UNPAID remainder, never the window's gross.
//
// THE CONTROLS ARE TWO QUESTIONS, IN ORDER, and the layout says so:
//   row 1 - WHEN: the day, and optionally a time window inside it.
//   row 2 - WHO, and WHICH SITTING of theirs.
// Everything that only matters once (how sittings are detected) lives behind one
// settings button. A counter clerk meeting this screen for the first time should see
// four controls, not a wall of chips and explanatory prose.

// ── Document primitives (the day sheet's vocabulary, kept in step) ────────────
function Money({ paise }: { paise: number }) {
  return (
    <>
      {paise < 0 ? "-" : ""}₹{formatPaise(Math.abs(paise))}
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  // break-inside-avoid: a ledger split across a page boundary puts rows on one sheet
  // and their subtotal on another, which is how a figure gets counted twice.
  return (
    <section className="mt-7 break-inside-avoid first:mt-0">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h2>
      {note ? <p className="mt-0.5 text-[11px] font-medium text-muted-foreground/80">{note}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────
// Shared chip shape for the session strip. A pill that reads as pressed or not, in
// the same two states the whole app uses for a toggle.
const CHIP =
  "h-8 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";
const CHIP_OFF = "bg-card hover:bg-muted";

// The time window, as ONE control instead of two bare inputs and a Clear button.
// Closed it says "Any time" or "12:00 - 14:00", which is the entire state; open it
// asks the only two questions it has.
//
// The draft is local and commits on Apply, for two reasons. A half-filled window is
// not a window, so typing "1" into the hour must not fire a query; and the fields are
// cleared from OUTSIDE whenever a session is picked, so the draft re-syncs on open
// rather than putting back a window nobody asked for.
function TimeWindowPicker({
  startTime,
  endTime,
  onChange,
}: {
  startTime: string;
  endTime: string;
  onChange: (next: { startTime: string; endTime: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(startTime);
  const [to, setTo] = useState(endTime);
  const active = Boolean(startTime && endTime);

  const field =
    "h-9 w-full rounded-md border bg-card px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setFrom(startTime);
          setTo(endTime);
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Time of day"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm outline-none",
            "focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
            active
              ? "border-primary bg-primary/5 font-medium text-foreground"
              : "bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          <Clock className="size-4 shrink-0" aria-hidden />
          {active ? `${startTime} - ${endTime}` : "Any time"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 bg-white p-3">
        <p className="text-xs font-semibold text-foreground">Time of day</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="time"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From"
            className={field}
          />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <input
            type="time"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
            className={field}
          />
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active && !from && !to}
            onClick={() => {
              setFrom("");
              setTo("");
              onChange({ startTime: "", endTime: "" });
              setOpen(false);
            }}
          >
            Whole day
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!from || !to}
            onClick={() => {
              onChange({ startTime: from, endTime: to });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// How sittings are detected. This is a setting, not a filter: it is touched once in a
// blue moon, and on the strip it was three buttons, a number field and a paragraph of
// prose sitting permanently beside the thing they configure. Behind one button the
// strip reads as "here are their sittings, pick one" - which is all it ever needed to
// say - and the explanation is one click away for whoever wants it.
function SplitSettings({
  smart,
  minutes,
  reason,
  onSmart,
  onManual,
}: {
  smart: boolean;
  minutes: number;
  reason: string;
  onSmart: () => void;
  onManual: (minutes: number) => void;
}) {
  // The threshold field types freely and only fires a query once the value is one the
  // server will accept. Bound straight to state it queried on every keystroke, so
  // typing "30" first asked for a 3-minute split - out of range, and an error toast on
  // the way to a perfectly good number.
  const [draft, setDraft] = useState(String(minutes));
  const row =
    "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How sessions are split"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 bg-white p-3">
        <p className="text-xs font-semibold text-foreground">How sessions are split</p>
        <div className="mt-2 space-y-1.5">
          <button
            type="button"
            onClick={onSmart}
            aria-pressed={smart}
            className={cn(row, smart ? "border-primary bg-primary/5" : "hover:bg-muted")}
          >
            <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
            Detect automatically
          </button>
          <button
            type="button"
            onClick={() => onManual(minutes)}
            aria-pressed={!smart}
            className={cn(row, !smart ? "border-primary bg-primary/5" : "hover:bg-muted")}
          >
            Split on long breaks
          </button>
          {/* Only in manual mode: a threshold shown while "detect automatically" is
              on would look like the number being used, and it is not. */}
          {!smart ? (
            <label className="flex items-center gap-1.5 pl-2.5 text-[11px] text-muted-foreground">
              Break longer than
              <input
                type="number"
                min={MIN_GAP_MINUTES}
                max={MAX_GAP_MINUTES}
                step={5}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  const v = Number(e.target.value);
                  if (Number.isInteger(v) && v >= MIN_GAP_MINUTES && v <= MAX_GAP_MINUTES) {
                    onManual(v);
                  }
                }}
                onBlur={() => setDraft(String(minutes))}
                aria-label="Session gap threshold in minutes"
                className="h-7 w-16 rounded border bg-card px-1.5 text-center tabular-nums outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
              minutes
            </label>
          ) : null}
        </div>
        {/* A payout tool must never split someone's day by a rule they cannot read. */}
        <p className="mt-2.5 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">
          {reason} Sessions always add up to the whole day.
        </p>
      </PopoverContent>
    </Popover>
  );
}

// The session strip: the doctor's actual sittings, detected from when they were
// billed (lib/doctors/sessions.ts). Several can be selected at once - a doctor paid
// for the morning AND the evening in one go is two windows, which is why the report
// takes a LIST of windows rather than a range.
//
// These stay toggle chips rather than becoming a dropdown: there are only ever a
// handful, and the whole value is seeing the times side by side. That is the opposite
// of the doctor picker, a list of names that can grow long - hence a dropdown there.
//
// A chip carries its times and its count, and NOT its amount. The amount is on the
// sheet three inches below, and a row of chips each ending in a rupee figure reads as
// four numbers competing for the same glance.
function SessionStrip({
  sessions,
  selected,
  onToggle,
  onClear,
}: {
  sessions: DoctorSession[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClear}
        aria-pressed={selected.size === 0}
        className={cn(CHIP, "font-medium", selected.size === 0 ? CHIP_ON : CHIP_OFF)}
      >
        Whole day
      </button>
      {sessions.map((s) => {
        const on = selected.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            aria-pressed={on}
            className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
          >
            <span className="font-medium">
              {s.fromLabel} - {s.toLabel}
            </span>
            <span className={cn("ml-1.5", on ? "opacity-75" : "text-muted-foreground")}>
              {s.count}
            </span>
          </button>
        );
      })}
    </>
  );
}

// ── Sheet parts, shared by both layouts ───────────────────────────────────────
// The sheet has TWO layouts, and which one it uses is decided by the CONTENT, not by
// the filter: one doctor in the result gets a statement addressed to that doctor, two
// or more get a list. A slip that says "Earnings by doctor" above a single name, then
// repeats that name's figures again under "Total", is a list of one - and it reads
// like the reader is missing a page. Everything below is written once and used by
// both, so the two layouts can never disagree about a number or a word.

// ALREADY PAID. This has to be impossible to miss - it is the one thing standing
// between a busy counter and settling the same shift twice. Named and timestamped,
// because "who recorded it" is the first question asked.
//
// Stated as a FACT, never as an instruction: this slip is routinely handed across the
// counter to the doctor it concerns, and telling the room not to pay someone reads as
// an accusation. "Paid in full for this period" carries the same information and
// accuses nobody.
function PaidCallout({ d }: { d: DoctorEarningLine }) {
  if (d.paidCount === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
      <p className="font-semibold">
        {d.isFullySettled
          ? "Paid in full for this period."
          : `Partly paid - ${d.payableCount} of ${d.count} consultations still to pay.`}
      </p>
      <ul className="mt-1 space-y-0.5">
        {d.payouts.map((p) => (
          <li key={p.payoutId}>
            {p.count} {p.count === 1 ? "consultation" : "consultations"} (
            <Money paise={p.paise} />) marked paid by <strong>{p.paidByName}</strong> on{" "}
            {p.paidAtLabel}
          </li>
        ))}
      </ul>
    </div>
  );
}

// How the figure was arrived at. One line per rate FROZEN on those bills, so a rate
// that changed inside the window is visible rather than averaged into a single number
// nobody agreed to.
//
// `settlement` adds the paid/payable rows. On the multi-doctor sheet they belong here,
// because each doctor's own remainder has to be readable inside their block. On the
// single-doctor sheet they belong in the total band instead - stating them twice, four
// inches apart, is how a reader ends up unsure which of the two is the real figure.
function RateTable({ d, settlement }: { d: DoctorEarningLine; settlement: boolean }) {
  return (
    <table className="mt-2 w-full border-collapse text-[11px]">
      <colgroup>
        <col />
        <col className="w-24" />
        <col className="w-28" />
        <col className="w-28" />
      </colgroup>
      <tbody>
        <tr className="text-muted-foreground">
          <td className="py-0.5">Rate</td>
          <td className="py-0.5 text-right">Consults</td>
          <td className="py-0.5 text-right">Collected</td>
          <td className="py-0.5 text-right">Doctor&apos;s cut</td>
        </tr>
        {d.rates.map((r) => (
          <tr key={r.key} className="border-t">
            <td className="py-1">{r.rateLabel}</td>
            <td className="py-1 text-right tabular-nums">{r.count}</td>
            <td className="py-1 text-right tabular-nums">
              <Money paise={r.collectedPaise} />
            </td>
            <td className="py-1 text-right font-medium tabular-nums">
              <Money paise={r.sharePaise} />
            </td>
          </tr>
        ))}
        {settlement && d.paidCount > 0 ? (
          <>
            <tr className="border-t">
              <td className="py-1 text-muted-foreground">Already paid</td>
              <td className="py-1 text-right tabular-nums text-muted-foreground">{d.paidCount}</td>
              <td />
              <td className="py-1 text-right tabular-nums text-muted-foreground">
                -<Money paise={d.paidPaise} />
              </td>
            </tr>
            <tr className="border-t">
              <td className="py-1 font-semibold">Still payable</td>
              <td className="py-1 text-right font-semibold tabular-nums">{d.payableCount}</td>
              <td />
              <td className="py-1 text-right font-semibold tabular-nums">
                <Money paise={d.payablePaise} />
              </td>
            </tr>
          </>
        ) : null}
      </tbody>
    </table>
  );
}

// The settle button never prints - the slip is the record of what is owed, and a paper
// button is a nonsense.
function SettleButton({
  d,
  onSettle,
  settling,
  size = "sm",
}: {
  d: DoctorEarningLine;
  onSettle: (d: DoctorEarningLine) => void;
  settling: boolean;
  size?: "sm" | "default";
}) {
  return (
    <div data-no-print className="mt-3">
      <Button
        type="button"
        size={size}
        variant={d.isFullySettled ? "outline" : "default"}
        disabled={d.isFullySettled || settling}
        onClick={() => onSettle(d)}
      >
        {settling ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : d.isFullySettled ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <BadgeIndianRupee className="size-4" aria-hidden />
        )}
        {d.isFullySettled ? "Paid in full" : `Mark ₹${formatPaise(d.payablePaise)} as paid`}
      </Button>
    </div>
  );
}

// The conclusion of the sheet, in the day sheet's grammar: the working as ruled rows,
// then a double rule and the one figure that matters set large.
//
// The headline is what is still OWED, never the window's gross - a sheet whose big
// number includes work already paid for is how the same shift gets settled twice. With
// one doctor these totals ARE that doctor's figures, which is exactly why the
// single-doctor layout can end here instead of repeating them.
function TotalBand({ report, sole }: { report: DoctorEarningsReport; sole: boolean }) {
  const rowLabel = "py-2 pr-3 text-sm font-medium";
  const rowCount = "px-3 py-2 text-right text-xs font-medium tabular-nums text-muted-foreground";
  const rowAmount = "py-2 pl-3 text-right text-sm font-semibold tabular-nums";
  return (
    <section className="mt-8 break-inside-avoid">
      <table className="w-full border-collapse">
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-36" />
        </colgroup>
        <tbody>
          <tr className="border-b border-border/70">
            <td className={rowLabel}>Consultations</td>
            <td className={rowCount}>{report.totalCount}</td>
            <td className={rowAmount}>
              <Money paise={report.totalCollectedPaise} />
            </td>
          </tr>
          <tr className="border-b border-border/70">
            <td className={rowLabel}>
              {sole ? "Doctor's share" : "Doctors' share"} for this period
            </td>
            <td className={rowCount} />
            <td className={rowAmount}>
              <Money paise={report.totalSharePaise} />
            </td>
          </tr>
          {report.hasPaid ? (
            <tr className="border-b border-border/70">
              <td className={cn(rowLabel, "text-muted-foreground")}>Already paid</td>
              <td className={rowCount}>{report.totalPaidCount}</td>
              <td className={cn(rowAmount, "text-muted-foreground")}>
                -<Money paise={report.totalPaidPaise} />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="mt-1 border-t-4 border-double border-foreground/80 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div>
            <span className="text-sm font-bold uppercase tracking-widest text-foreground">
              Still payable
            </span>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {report.totalPayableCount === 0
                ? "Everything in this period is already settled."
                : `${report.totalPayableCount} ${report.totalPayableCount === 1 ? "consultation" : "consultations"} not yet settled${sole ? "" : ` across ${report.doctors.length} doctors`}.`}
            </p>
          </div>
          <span className="font-serif text-3xl font-bold tabular-nums text-foreground">
            <Money paise={report.totalPayablePaise} />
          </span>
        </div>
      </div>
    </section>
  );
}

// ── One doctor's block, on the MULTI-doctor sheet ─────────────────────────────
// Deliberately NOT an itemised list of consultations. A doctor at the counter wants
// the count and the amount; a page of patient names is noise on the way to the
// figure, and it puts every patient this doctor saw onto a slip that leaves the
// building. The count is the claim; the consultations behind it stay in the system.
//
// The hospital's own remainder is not shown either. This is the doctor's statement,
// not a P&L - what the hospital keeps belongs on /admin, and printing it on a sheet
// handed across the counter invites a conversation nobody wanted to have.
function DoctorBlock({
  d,
  onSettle,
  settling,
}: {
  d: DoctorEarningLine;
  onSettle: (d: DoctorEarningLine) => void;
  settling: boolean;
}) {
  return (
    <div className="break-inside-avoid border-t py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{d.doctorName}</p>
          <p className="text-[11px] text-muted-foreground">
            {d.department ? `${d.department} · ` : ""}
            {d.count} {d.count === 1 ? "consultation" : "consultations"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              d.isFullySettled && "text-muted-foreground line-through",
            )}
          >
            <Money paise={d.payablePaise} />
          </p>
          {d.paidCount > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              of <Money paise={d.sharePaise} /> total
            </p>
          ) : null}
        </div>
      </div>
      <PaidCallout d={d} />
      <RateTable d={d} settlement />
      <SettleButton d={d} onSettle={onSettle} settling={settling} />
    </div>
  );
}

// ── The screen ────────────────────────────────────────────────────────────────
export function DoctorEarningsView({
  initial,
  todayIso,
  doctors,
}: {
  initial: DoctorEarningsResult;
  todayIso: string;
  doctors: EarningsDoctorOption[];
}) {
  const [result, setResult] = useState(initial);
  const [day, setDay] = useState(initial.meta.dayIso);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);
  // Smart by default: the threshold is derived from this doctor's own pace rather
  // than applied from a fixed number. Manual is the override, kept because this is
  // money and whoever is at the counter must always be able to say "split it here".
  const [gapSmart, setGapSmart] = useState(true);
  const [gapMinutes, setGapMinutes] = useState(60);
  const [confirming, setConfirming] = useState<DoctorEarningLine | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { meta, report, sessions } = result;

  // Which layout the sheet uses is decided by the RESULT, not the filter: one doctor
  // with work in this period gets a statement addressed to them. Picking three of whom
  // only one actually worked still produces one doctor's slip, and it says whose.
  const sole = report.doctors.length === 1 ? report.doctors[0] : null;

  // An empty sheet has no doctor in the result to name, so this is the one place the
  // SELECTION is allowed to speak. "No consultations for Dr. Anita Rao in this period"
  // tells a reader whether they mis-picked; a bare "no consultations" does not.
  const emptySubject =
    doctorIds.length === 1
      ? (doctors.find((x) => x.id === doctorIds[0])?.name ?? "this doctor")
      : doctorIds.length > 1
        ? `these ${doctorIds.length} doctors`
        : "any doctor";

  const doctorOptions = doctors.map((d) => ({
    value: d.id,
    label: d.active ? d.name : `${d.name} (inactive)`,
    hint: d.department ?? undefined,
    // An inactive doctor stays pickable - they may have consulted before being
    // deactivated, and those windows must still be reportable.
    keywords: d.department ?? "",
  }));

  // One place that re-runs the report, so every control goes through the same server
  // call with the same validation - no control can produce a figure another couldn't.
  //
  // Session keys are resolved to concrete windows HERE, against the sessions the
  // server last returned, and the server re-validates them. A key that no longer
  // matches any session (the day changed, or the gap threshold re-clustered it)
  // simply drops out rather than silently widening the window.
  function run(next: {
    day?: string;
    startTime?: string;
    endTime?: string;
    ids?: string[];
    keys?: string[];
    gap?: number;
    smart?: boolean;
  }) {
    const query = queryFor(next);
    startTransition(async () => {
      const res = await generateDoctorEarningsAction(query);
      if (!res.ok) {
        toast.error(res.formError ?? "Could not load doctor earnings.");
        return;
      }
      if (!res.data) {
        toast.error("Could not load doctor earnings.");
        return;
      }
      setResult(res.data);
    });
  }

  // The current controls as the server input. Built ONCE so the report and the
  // settlement are always asking about the same window - if they could drift, a desk
  // could settle consultations the sheet in front of them never showed.
  function queryFor(next: {
    day?: string;
    startTime?: string;
    endTime?: string;
    ids?: string[];
    keys?: string[];
    gap?: number;
    smart?: boolean;
  }) {
    const st = next.startTime ?? startTime;
    const et = next.endTime ?? endTime;
    const keys = next.keys ?? sessionKeys;
    const chosen = sessions.filter((s) => keys.includes(s.key));
    return {
      day: next.day ?? day,
      windows: chosen.map((s) => ({ from: s.from, to: s.to })),
      // A half-filled manual window is not a window; treat it as absent until both
      // ends are set, rather than erroring on every keystroke.
      startTime: st && et ? st : undefined,
      endTime: st && et ? et : undefined,
      doctorIds: next.ids ?? doctorIds,
      gapSmart: next.smart ?? gapSmart,
      gapMinutes: next.gap ?? gapMinutes,
    };
  }

  // Record the payout, then re-run the report so the "already paid" callout the next
  // person sees is read back from the database, never assumed from a local edit.
  function settle(d: DoctorEarningLine) {
    setConfirming(null);
    setSettlingId(d.doctorId);
    startTransition(async () => {
      const res = await settleDoctorPayoutAction({ ...queryFor({}), doctorId: d.doctorId });
      setSettlingId(null);
      if (!res.ok) {
        toast.error(res.formError ?? "Could not mark as paid.");
        // Refresh anyway: the usual reason for failure is that somebody else settled
        // it first, and the screen must show that rather than the stale figure.
        run({});
        return;
      }
      toast.success(
        `${res.data?.doctorName ?? "Doctor"} marked as paid: ₹${formatPaise(res.data?.paise ?? 0)} for ${res.data?.count ?? 0} consultations.`,
      );
      run({});
    });
  }

  // Changing the doctor, the day, or the threshold invalidates the sessions the
  // current keys point at, so the selection is cleared with them. Keeping stale keys
  // would mean a sheet whose masthead names windows nobody chose.
  function changeDoctors(next: string[]) {
    setDoctorIds(next);
    setSessionKeys([]);
    run({ ids: next, keys: [] });
  }

  function toggleSession(key: string) {
    const next = sessionKeys.includes(key)
      ? sessionKeys.filter((k) => k !== key)
      : [...sessionKeys, key];
    setSessionKeys(next);
    // A session and a typed window are two answers to the same question - picking a
    // session clears the manual fields so only one of them is ever in effect.
    setStartTime("");
    setEndTime("");
    run({ keys: next, startTime: "", endTime: "" });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Controls never print - the sheet is the record, not the filter that made it.
          Two rows, one question each: WHEN, then WHO. */}
      <div data-no-print className="mb-6 space-y-3">
        {/* Row 1 - the page's own title, and the WHEN. The day and the time inside it
            are the same question at two resolutions, so they sit together. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Doctor Earnings</h1>
          <div className="flex flex-wrap items-center gap-2">
            <DayStepper
              day={day}
              todayIso={todayIso}
              onChange={(d) => {
                setDay(d);
                setSessionKeys([]);
                run({ day: d, keys: [] });
              }}
            />
            <TimeWindowPicker
              startTime={startTime}
              endTime={endTime}
              onChange={({ startTime: st, endTime: et }) => {
                setStartTime(st);
                setEndTime(et);
                // A typed window overrides the session strip, for the same reason the
                // reverse clears the fields: only one of them may be in effect.
                setSessionKeys([]);
                run({ startTime: st, endTime: et, keys: [] });
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
          </div>
        </div>

        {/* Row 2 - WHO, and which of their sittings. One bar, because picking the
            doctor is what makes the sittings appear: they are one thought, and split
            across two rows the strip looked like an unrelated filter. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/40 px-2.5 py-2">
          <div className="w-56">
            <MultiCombobox
              options={doctorOptions}
              values={doctorIds}
              onChange={changeDoctors}
              emptyLabel="All doctors"
              searchPlaceholder="Search doctors…"
              emptyText="No doctor matches."
              summarize={(n) => `${n} doctors`}
              ariaLabel="Filter by doctor"
            />
          </div>

          {/* Sessions are per-doctor, and the sheet's masthead names ONE set of
              windows - so the strip appears only when exactly one doctor is picked.
              Offering it for three at once would mean a header that cannot honestly
              say what it covers. The other two cases get one short line, not a
              paragraph explaining a rule nobody has hit yet. */}
          {doctorIds.length !== 1 ? (
            <p className="text-xs text-muted-foreground">
              Pick one doctor to see their sessions.
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No consultations on this day.</p>
          ) : (
            <>
              <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {/* ONE sitting is the whole day, so a "Whole day" chip beside it asks
                    the same question twice and a lone chip invites a click that
                    changes nothing. State it as a fact instead; the settings button
                    is still there for anyone who thinks the split is wrong. */}
                {sessions.length === 1 ? (
                  <span className="text-xs text-muted-foreground">
                    One session · {sessions[0].fromLabel} - {sessions[0].toLabel}
                  </span>
                ) : (
                  <SessionStrip
                    sessions={sessions}
                    selected={new Set(sessionKeys)}
                    onToggle={toggleSession}
                    onClear={() => {
                      setSessionKeys([]);
                      run({ keys: [] });
                    }}
                  />
                )}
                <SplitSettings
                  smart={gapSmart}
                  minutes={gapMinutes}
                  reason={meta.gapReason}
                  onSmart={() => {
                    setGapSmart(true);
                    setSessionKeys([]);
                    run({ smart: true, keys: [] });
                  }}
                  onManual={(m) => {
                    setGapSmart(false);
                    setGapMinutes(m);
                    setSessionKeys([]);
                    run({ gap: m, smart: false, keys: [] });
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className={cn("relative", pending && "opacity-60")}>
        {pending ? (
          <div data-no-print className="absolute right-0 top-0">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : null}

        {/* Masthead. A payout sheet that does not state its own periods is how the
            same shift gets paid twice - so EVERY window is named, not just the first
            and last. Two sittings paid together read as two lines, because they are
            not a range: the afternoon between them is somebody else's work. */}
        <header className="border-b-2 border-foreground/80 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
            <div>
              <p className="font-serif text-2xl font-bold tracking-tight text-foreground">
                {meta.hospitalName}
              </p>
              {/* Not an <h1>: the page above owns that. This is the document's own
                  kind-line, and it has to survive onto paper where the page heading
                  does not print. */}
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Doctor earnings
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:text-right">
              <dt className="font-medium text-muted-foreground">Date</dt>
              <dd className="font-semibold text-foreground">
                {meta.dayLabel}
                {meta.endDayLabel ? ` to ${meta.endDayLabel}` : null}
              </dd>
              <dt className="font-medium text-muted-foreground">Period</dt>
              <dd className="font-semibold text-foreground">
                {meta.windowKind === "day"
                  ? "Whole day"
                  : meta.windowKind === "range"
                    ? "Whole days"
                    : meta.windowKind === "shift"
                      ? meta.windowLabels[0]
                      : meta.windowLabels.join(" · ")}
              </dd>
              {/* Named, not counted. "1 selected" describes the FILTER; this sheet is
                  handed to a person, and a payout slip that does not say whose it is
                  cannot do its job. The name comes from the result, so it always
                  matches the figures below it - if three doctors were picked and only
                  one worked, the sheet is that one doctor's and says so. */}
              <dt className="font-medium text-muted-foreground">
                {sole ? "Doctor" : "Doctors"}
              </dt>
              <dd className="font-semibold text-foreground">
                {sole
                  ? sole.doctorName
                  : meta.doctorFilterCount === 0
                    ? "All"
                    : `${meta.doctorFilterCount} selected`}
                {sole?.department ? (
                  <span className="font-medium text-muted-foreground"> · {sole.department}</span>
                ) : null}
              </dd>
              <dt className="font-medium text-muted-foreground">Generated</dt>
              <dd className="font-medium text-muted-foreground">
                {meta.generatedAtLabel} · {meta.generatedByName}
              </dd>
            </dl>
          </div>
        </header>

        {report.isEmpty ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No consultations for {emptySubject} in this period.
          </p>
        ) : (
          <>
            {/* ONE doctor - a statement addressed to them. No "earnings by doctor"
                heading over a single name, and no per-doctor block repeating what the
                total band says four inches lower. The sheet reads: here is the work,
                here is what has been paid, here is what is owed. */}
            {sole ? (
              <Section
                title="Consultations"
                note="Every desk's consultations, combined. Amounts are the doctor's share as it was set when each bill was written."
              >
                <PaidCallout d={sole} />
                <RateTable d={sole} settlement={false} />
              </Section>
            ) : (
              <Section
                title="Earnings by doctor"
                note="Every desk's consultations, combined. Amounts are the doctor's share as it was set when each bill was written."
              >
                <div>
                  {report.doctors.map((d) => (
                    <DoctorBlock
                      key={d.doctorId}
                      d={d}
                      onSettle={setConfirming}
                      settling={settlingId === d.doctorId}
                    />
                  ))}
                </div>
              </Section>
            )}

            <TotalBand report={report} sole={sole !== null} />

            {/* With one doctor the action belongs to the whole sheet, under its
                conclusion, not tucked inside a block that no longer exists. */}
            {sole ? (
              <SettleButton
                d={sole}
                onSettle={setConfirming}
                settling={settlingId === sole.doctorId}
                size="default"
              />
            ) : null}

            <footer className="mt-6 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
              {report.hasMixedRates ? (
                <p className="mb-1 font-medium text-foreground">
                  {sole
                    ? "This doctor's share rate changed during the period. Each rate is listed separately above; the total uses the rate that applied to each consultation."
                    : "A doctor's share rate changed during the period. Each rate is listed separately above; the total uses the rate that applied to each consultation."}
                </p>
              ) : null}
              {/* "Part of" would be wrong on a sheet whose payable total is zero, and
                  a settlement note that misdescribes its own sheet is worse than none. */}
              {report.hasPaid ? (
                <p className="mb-1 font-medium text-foreground">
                  {report.totalPayableCount === 0
                    ? "This period is fully settled"
                    : "Part of this period has already been settled"}
                  {sole
                    ? " - the note above says who recorded it and when."
                    : " - see the note beside each doctor for who recorded it and when."}
                  {report.totalPayableCount === 0
                    ? ""
                    : " Only the unpaid consultations are in the payable total."}
                </p>
              ) : null}
              <p>
                Marking a doctor as paid records who did it and when. Settled consultations
                stay marked on every later report.
              </p>
            </footer>
          </>
        )}
      </div>

      {/* Confirmation. Marking as paid is money leaving the drawer and is not
          reversible from this screen, so it is one of the few actions here that
          deliberately does interrupt (dev-rules §5 prefers reversibility to popups -
          this one cannot be made reversible, so it gets the popup). Everything the
          person is about to commit to is restated: the doctor, the period, the count
          and the amount. */}
      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark {confirming?.doctorName} as paid?</DialogTitle>
            <DialogDescription>
              This records the payment against these consultations, so every later report
              shows them as settled. It cannot be undone from this screen.
            </DialogDescription>
          </DialogHeader>
          {confirming ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
              <dt className="text-muted-foreground">Period</dt>
              <dd className="text-right font-medium">
                {meta.dayLabel}
                {meta.windowKind === "day" ? " (whole day)" : ` · ${meta.windowLabels.join(" · ")}`}
              </dd>
              <dt className="text-muted-foreground">Consultations</dt>
              <dd className="text-right font-medium tabular-nums">{confirming.payableCount}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="text-right text-base font-bold tabular-nums">
                <Money paise={confirming.payablePaise} />
              </dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => confirming && settle(confirming)}>
              <BadgeIndianRupee className="size-4" aria-hidden />
              Confirm payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
