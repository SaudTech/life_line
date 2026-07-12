"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ClipboardList, Eye, EyeOff, Loader2, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentModeIcon } from "@/components/payment-mode-icon";
import { printReceipt } from "@/components/print-receipt";
import { ServiceCombobox } from "@/components/service-combobox";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { ServiceRow } from "@/lib/services/repository";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/procedures/schema";
import {
  lookupForProcedureAction,
  previewProcedureAction,
  authorizeProcedureDiscountAction,
  submitProcedureAction,
  type ProcedureLookupPatient,
  type ProcedureLookupTarget,
  type ProcedurePreview,
  type ProcedureOutcome,
} from "@/lib/procedures/actions";
import type { ReissueSource } from "@/lib/billing/repository";

const PAY_LABELS: Record<PaymentModeValue, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};
const DISCOUNT_PCTS = [10, 15, 20, 25];

type Target = {
  patientId: string;
  patientCode: string;
  patientName: string;
  // Null when billing this patient standalone, with no linked consultation
  // (a procedure doesn't require one - only OPD's revisit/fee logic does).
  consultationId: string | null;
  doctorName: string | null;
  // How this target was found - a phone lookup can list several consultations
  // (or "no consultation") to choose from (so "Change" makes sense to go back
  // to that list); a consultation-number lookup resolves directly to one, so
  // there's nothing to go "back" to - re-typing the query is the only way to
  // search again.
  source: "phone" | "number";
};

type Line = { key: string; serviceId: string; quantity: string };

type Discount = {
  pct?: number;
  amountRupees?: string;
  pin: string;
  approverName: string;
  discountPaise: number;
  totalPaise: number;
};

let lineSeq = 0;
function newLine(): Line {
  lineSeq += 1;
  return { key: `l${lineSeq}`, serviceId: "", quantity: "1" };
}

function isValidLine(l: Line): boolean {
  const q = Number(l.quantity);
  return l.serviceId !== "" && Number.isInteger(q) && q >= 1;
}

// The lookup query to pre-fill when re-issuing (plan §Part B): prefer the source
// bill's consultation number (it resolves straight to that consultation), else
// the patient's 10-digit phone. "" when neither is usable - the operator searches.
function initialReissueQuery(reissue?: ReissueSource | null): string {
  if (!reissue) return "";
  if (reissue.consultationId) return reissue.consultationId;
  const digits = (reissue.phone ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

// The source bill's service lines as editable rows, to pre-fill on re-issue.
function initialReissueLines(reissue?: ReissueSource | null): Line[] {
  if (!reissue || reissue.lines.length === 0) return [newLine()];
  return reissue.lines.map((l) => ({ ...newLine(), serviceId: l.serviceId, quantity: String(l.quantity) }));
}

// preview.lines is server-priced in the SAME order as the valid subset of
// `lines` sent to previewProcedureAction - map back by that position, not by
// serviceId, so two rows billing the same service each show their own total.
function pricedLineFor(
  line: Line,
  lines: Line[],
  preview: ProcedurePreview | null,
): ProcedurePreview["lines"][number] | undefined {
  if (!preview) return undefined;
  const idx = lines.filter(isValidLine).findIndex((l) => l.key === line.key);
  if (idx === -1) return undefined;
  return preview.lines[idx];
}

// OPD procedures counter (plan §Part2): find the patient's active consultation
// by phone or consultation number, add/remove service lines, and save a
// finalized procedure bill - no doctor fee, no new consultation. Every amount
// shown comes from the server (previewProcedureAction / submitProcedureAction);
// this screen never computes money itself (dev-rules §4).
export function ProcedureFlow({
  services,
  reissue,
  printable,
}: {
  services: ServiceRow[];
  reissue?: ReissueSource | null;
  // Server-resolved: is there a procedure design a print can use for this
  // location? Gates the Print button (print-updates plan §1c).
  printable: boolean;
}) {
  // STEP 1 - find
  const [query, setQuery] = useState(() => initialReissueQuery(reissue));
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [phonePatients, setPhonePatients] = useState<ProcedureLookupPatient[] | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<ProcedureLookupPatient | null>(null);
  const [expiredTarget, setExpiredTarget] = useState<ProcedureLookupTarget | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  // STEP 2 - lines
  const [lines, setLines] = useState<Line[]>(() => initialReissueLines(reissue));
  const [preview, setPreview] = useState<ProcedurePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // STEP 3 - settle
  const [payMode, setPayMode] = useState<PaymentModeValue>("cash");
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ProcedureOutcome | null>(null);

  const lookupSeq = useRef(0);
  const previewSeq = useRef(0);
  // Synchronous re-entry guard for the money write (see consultation-flow): the
  // disabled Save button blocks the common double-click, but a mobile double-tap
  // can dispatch two handlers before React repaints, and this action writes a
  // bill. A ref checked/flipped synchronously means a second call is a no-op.
  const submittingRef = useRef(false);
  const serviceTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);

  // Move focus to the newly added row's service field, so an operator can keep
  // adding lines without reaching for the mouse (dev-rules §5, keyboard-first).
  useEffect(() => {
    if (!focusLineKey) return;
    const btn = serviceTriggerRefs.current.get(focusLineKey);
    if (btn) btn.focus();
    setFocusLineKey(null);
  }, [focusLineKey]);

  const validLines = lines.filter(isValidLine).map((l) => ({
    serviceId: l.serviceId,
    quantity: Number(l.quantity),
  }));

  // Debounced preview - every valid line change re-prices from the server.
  useEffect(() => {
    setDiscount(null);
    if (!target || validLines.length === 0) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const res = await previewProcedureAction({ lines: validLines });
      if (seq !== previewSeq.current) return;
      setPreviewing(false);
      setPreview(res.ok ? res.data ?? null : null);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(validLines), target?.patientId]);

  // Re-issue prefill (plan §Part B): picking a target from the auto-search resets
  // the lines to a single blank row (pickTarget), so re-apply the source bill's
  // lines once a target is chosen. Runs once; a deactivated/removed service simply
  // won't price and the operator adjusts it.
  const reissueLinesAppliedRef = useRef(false);
  useEffect(() => {
    if (!reissue || reissueLinesAppliedRef.current) return;
    if (!target) return;
    if (reissue.lines.length > 0) setLines(initialReissueLines(reissue));
    reissueLinesAppliedRef.current = true;
  }, [reissue, target]);

  function resetAll() {
    setQuery("");
    setPhonePatients(null);
    setSelectedPatient(null);
    setExpiredTarget(null);
    setTarget(null);
    setLines([newLine()]);
    setPreview(null);
    setPayMode("cash");
    setDiscount(null);
    setSubmitting(false);
    setFormError(null);
    setOutcome(null);
  }

  function pickTarget(
    t: {
      patientId: string;
      patientCode: string;
      patientName: string;
      // Omitted (or null) to bill this patient with no linked consultation.
      consultation?: { id: string; doctor_name: string; valid_until: string } | null;
    },
    source: "phone" | "number",
  ) {
    setTarget({
      patientId: t.patientId,
      patientCode: t.patientCode,
      patientName: t.patientName,
      consultationId: t.consultation ? t.consultation.id : null,
      doctorName: t.consultation ? t.consultation.doctor_name : null,
      source,
    });
    setExpiredTarget(null);
    setLines([newLine()]);
    setPreview(null);
  }

  // A mobile number is always exactly 10 digits (dev-rules: no manual mode
  // switch - detect it from the digit count alone). Anything else is looked up
  // as a consultation number, however short.
  function isPhoneShaped(q: string): boolean {
    return q.length === 10;
  }

  async function runSearch(q: string) {
    const isPhone = isPhoneShaped(q);
    const seq = ++lookupSeq.current;
    setSearching(true);
    const input = isPhone ? { phone: q } : { consultationNumber: q };
    const res = await lookupForProcedureAction(input);
    if (seq !== lookupSeq.current) return;
    setSearching(false);
    if (!res.ok) {
      const base = res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Not found.";
      // A non-10-digit query that comes back empty is very often an incomplete
      // or mistyped phone number - say so plainly instead of leaving the
      // operator wondering why nothing is happening (dev-rules §1).
      setLookupError(isPhone ? base : `${base} A mobile number needs exactly 10 digits.`);
      return;
    }
    const data = res.data!;
    if (data.mode === "phone") {
      setPhonePatients(data.patients);
      if (data.patients.length === 0) {
        setLookupError("No patient found on that phone number.");
      }
    } else {
      if (!data.target.active) {
        setExpiredTarget(data.target);
        return;
      }
      pickTarget(data.target, "number");
    }
  }

  // Auto-detect and auto-search as the operator types - no mode toggle, no
  // Find button (dev-rules §5, keyboard-first: the fewer actions the better).
  // A shorter debounce once the input reaches phone length (10 digits) gets a
  // clean phone number found almost instantly; a longer one for anything else
  // avoids firing a lookup on every keystroke while a consultation number (or
  // an in-progress phone number) is still being typed.
  useEffect(() => {
    setPhonePatients(null);
    setSelectedPatient(null);
    setExpiredTarget(null);
    setLookupError(null);
    setTarget(null);
    if (query === "") {
      setSearching(false);
      return;
    }
    const delay = isPhoneShaped(query) ? 200 : 500;
    const t = setTimeout(() => {
      runSearch(query);
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeLine(key: string) {
    setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  const subtotalPaise = preview?.subtotalPaise ?? 0;
  const totalPaise = discount ? discount.totalPaise : subtotalPaise;
  const canSubmit = !!target && validLines.length > 0 && !!preview && !submitting;

  async function confirm() {
    if (!target) return;
    if (submittingRef.current) return; // guard against a double-fire
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await submitProcedureAction({
        patientId: target.patientId,
        consultationId: target.consultationId ?? undefined,
        lines: validLines,
        paymentMode: payMode,
        discountPct: discount?.pct,
        discountAmount: discount?.amountRupees,
        discountPin: discount?.pin,
        // Carry the correction link when re-issuing (plan §Part B).
        replacesBillId: reissue?.billId,
      });
      if (!res.ok) {
        setFormError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not save.");
        return;
      }
      setOutcome(res.data ?? null);
    } catch {
      setFormError("Could not save - nothing was recorded. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (outcome) return <SuccessScreen outcome={outcome} onReset={resetAll} printable={printable} />;

  return (
    <div className={cn("mx-auto max-w-5xl", target && "pb-24 lg:pb-0")}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Bill a procedure</h1>
          <p className="text-sm text-muted-foreground">
            Find the patient by phone or consultation number, then add the service lines to bill -
            a consultation isn&apos;t required.
          </p>
        </div>
        <Link
          href="/procedures/history"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ClipboardList className="size-4" aria-hidden />
          All procedures
        </Link>
      </div>

      {reissue ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-primary/30 bg-accent p-3.5 text-sm text-accent-foreground">
          <RotateCcw className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Fixing cancelled bill <b>#{reissue.billNumber}</b> for {reissue.patientName}. The
            original lines are pre-filled - correct them and save. This creates a new bill linked to the cancelled one.
          </span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column: find + lines */}
        <div className="space-y-3">
          {/* STEP 1 - Find */}
          <StepCard n={1} title="Find the patient" done={!!target}>
            <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query) runSearch(query);
                }}
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="Mobile number or consultation number"
                aria-label="Mobile number or consultation number"
                className="h-12 flex-1 bg-transparent text-base font-semibold tracking-wide text-foreground outline-none placeholder:font-normal placeholder:tracking-normal"
              />
              {searching ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              ) : null}
            </div>

            {!lookupError && !target && !expiredTarget && !phonePatients ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Enter 10 digits of a mobile number, or a
                consultation number.
              </p>
            ) : null}

            {lookupError ? (
              <p className="mt-2 text-sm font-medium text-destructive">{lookupError}</p>
            ) : null}

            {expiredTarget ? (
              <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-semibold text-destructive">
                  This consultation has expired
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {expiredTarget.patientName} · {expiredTarget.consultation.doctor_name} · valid
                  until {formatDay(expiredTarget.consultation.valid_until)}.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    pickTarget(
                      {
                        patientId: expiredTarget.patientId,
                        patientCode: expiredTarget.patientCode,
                        patientName: expiredTarget.patientName,
                      },
                      "phone",
                    )
                  }
                  className="mt-2 rounded text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Bill {expiredTarget.patientName} without a consultation
                </button>
              </div>
            ) : null}

            {phonePatients && phonePatients.length > 0 && !target ? (
              <div className="mt-3 grid gap-2">
                {phonePatients.map((p) => {
                  const sel = selectedPatient?.patientId === p.patientId;
                  return (
                    <div key={p.patientId} className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedPatient(sel ? null : p)}
                        aria-pressed={sel}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          sel ? "border-primary bg-accent" : "hover:border-foreground/20 hover:bg-muted/40",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-foreground">{p.patientName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {p.patientCode} ·{" "}
                            {p.consultations.length === 0
                              ? "no active consultation"
                              : `${p.consultations.length} active consultation${p.consultations.length > 1 ? "s" : ""}`}
                          </span>
                        </span>
                      </button>
                      {sel ? (
                        <div className="ml-3 grid gap-1.5 border-l pl-3">
                          {p.consultations.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                pickTarget(
                                  {
                                    patientId: p.patientId,
                                    patientCode: p.patientCode,
                                    patientName: p.patientName,
                                    consultation: c,
                                  },
                                  "phone",
                                )
                              }
                              className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="font-medium text-foreground">{c.doctor_name}</span>
                              <span className="text-xs text-muted-foreground">
                                valid until {formatDay(c.valid_until)}
                              </span>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              pickTarget(
                                {
                                  patientId: p.patientId,
                                  patientCode: p.patientCode,
                                  patientName: p.patientName,
                                },
                                "phone",
                              )
                            }
                            className="rounded-lg border border-dashed px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Bill without a consultation
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {target ? (
              <div className="mt-3 rounded-xl border border-primary/30 bg-accent p-4">
                <p className="text-sm font-semibold text-accent-foreground">
                  {target.patientName} · {target.patientCode}
                </p>
                <p className="mt-1 text-sm text-accent-foreground/80">
                  {target.consultationId
                    ? `${target.doctorName} · consultation #${target.consultationId}`
                    : "No linked consultation"}
                </p>
                {target.source === "phone" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(null);
                      setPreview(null);
                      setLines([newLine()]);
                    }}
                    className="mt-2 rounded text-xs font-medium text-accent-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Change
                  </button>
                ) : null}
              </div>
            ) : null}
          </StepCard>

          {/* STEP 2 - Lines */}
          {target ? (
            <StepCard n={2} title="Service lines" done={validLines.length > 0}>
              <div className="grid gap-2">
                {lines.map((line) => {
                  const service = services.find((s) => s.id === line.serviceId);
                  // Consume matching priced entries IN ORDER, not just the first
                  // match by serviceId - two rows can bill the same service, and
                  // each must show its own line total, not a repeated one.
                  const priced = pricedLineFor(line, lines, preview);
                  return (
                    <div key={line.key} className="flex items-center gap-2">
                      <ServiceCombobox
                        ref={(el) => {
                          if (el) serviceTriggerRefs.current.set(line.key, el);
                          else serviceTriggerRefs.current.delete(line.key);
                        }}
                        services={services}
                        value={line.serviceId}
                        onChange={(serviceId) => updateLine(line.key, { serviceId })}
                        className="flex-1"
                      />
                      <input
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, { quantity: e.target.value.replace(/\D/g, "").slice(0, 4) })
                        }
                        onKeyDown={(e) => {
                          // A quantity field is a counter, not free text - all
                          // four arrows step it by 1 rather than moving the
                          // caret, so an operator can adjust without touching
                          // the mouse (dev-rules §5, keyboard-first).
                          if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(e.key)) {
                            e.preventDefault();
                            const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1;
                            const next = Math.max(1, (Number(line.quantity) || 0) + step);
                            updateLine(line.key, { quantity: String(next) });
                          }
                        }}
                        type="text"
                        inputMode="numeric"
                        aria-label="Quantity"
                        placeholder="Qty"
                        className="h-10 w-16 rounded-lg border bg-background px-2 text-center text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
                      />
                      <span className="w-24 shrink-0 text-right text-sm font-semibold text-foreground">
                        {service && priced ? `₹${formatPaise(priced.lineTotalPaise)}` : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  const line = newLine();
                  setLines((rows) => [...rows, line]);
                  setFocusLineKey(line.key);
                }}
              >
                <Plus className="size-4" aria-hidden /> Add line
              </Button>
            </StepCard>
          ) : null}
        </div>

        {/* Right column: settle + confirm (sticky) */}
        <div className="space-y-3 lg:sticky lg:top-4">
          {target ? (
            <StepCard n={3} title="Settle" done={canSubmit}>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Payment mode</div>
              <div className="mb-4 flex gap-2">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayMode(m)}
                    aria-pressed={payMode === m}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      payMode === m
                        ? "border-primary bg-accent text-accent-foreground"
                        : "hover:border-foreground/20 hover:bg-muted/40",
                    )}
                  >
                    <PaymentModeIcon mode={m} className="size-4" />
                    {PAY_LABELS[m]}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium text-foreground">
                    {previewing ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      `₹${formatPaise(subtotalPaise)}`
                    )}
                  </span>
                </div>
                {discount ? (
                  <div className="mt-2 flex items-start justify-between text-sm text-accent-foreground">
                    <span>
                      <span className="block">
                        Discount{discount.pct ? ` (${discount.pct}%)` : ""}
                      </span>
                      <span className="block text-xs text-accent-foreground/80">
                        approved by {discount.approverName}
                      </span>
                    </span>
                    <span className="font-medium">−₹{formatPaise(discount.discountPaise)}</span>
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <span className="text-sm font-bold text-foreground">Total payable</span>
                  <span className="text-lg font-bold text-foreground">₹{formatPaise(totalPaise)}</span>
                </div>
                {discount ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full text-destructive hover:text-destructive"
                    onClick={() => setDiscount(null)}
                  >
                    Remove discount
                  </Button>
                ) : subtotalPaise > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full border-dashed text-accent-foreground"
                    onClick={() => setPinOpen(true)}
                  >
                    ＋ Apply discount (supervisor PIN)
                  </Button>
                ) : null}
              </div>

              {formError ? (
                <p className="mt-3 text-sm font-medium text-destructive">{formError}</p>
              ) : null}
              <Button type="button" size="lg" className="mt-3 w-full" disabled={!canSubmit} onClick={confirm}>
                {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {`Save bill · ₹${formatPaise(totalPaise)}`}
              </Button>
            </StepCard>
          ) : (
            <div className="rounded-2xl border border-dashed bg-card/40 p-8 text-center text-sm text-muted-foreground">
              Find a patient to start billing.
            </div>
          )}
        </div>
      </div>

      {/* Mobile running total - always visible while billing (dev-rules §5), so
          the operator never scrolls to know the amount. The full Settle card (pay
          mode, discount, Save) stays in flow below on small screens. */}
      {target ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-2.5 shadow-[0_-2px_12px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">Total payable</span>
            <span className="flex items-center text-xl font-bold text-foreground">
              {previewing ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                `₹${formatPaise(totalPaise)}`
              )}
            </span>
          </div>
        </div>
      ) : null}

      {pinOpen && target ? (
        <PinDialog
          consultationId={target.consultationId ?? undefined}
          lines={validLines}
          onClose={() => setPinOpen(false)}
          onApproved={(d) => {
            setDiscount(d);
            setPinOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ── PIN discount dialog ──────────────────────────────────────────────────────
function PinDialog({
  consultationId,
  lines,
  onClose,
  onApproved,
}: {
  consultationId?: string;
  lines: { serviceId: string; quantity: number }[];
  onClose: () => void;
  onApproved: (d: Discount) => void;
}) {
  const [pct, setPct] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasDiscount = pct !== null || amount.trim() !== "";
  const canAuthorize = pin.length === 4 && hasDiscount && !busy;

  async function authorize() {
    if (!canAuthorize) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authorizeProcedureDiscountAction({
        consultationId,
        lines,
        pct: pct ?? undefined,
        amount: amount.trim() || undefined,
        pin,
      });
      if (!res.ok) {
        setError(res.fieldErrors?.pin ?? res.formError ?? "Could not authorize.");
        return;
      }
      const d = res.data!;
      onApproved({
        pct: pct ?? undefined,
        amountRupees: pct === null ? amount.trim() : undefined,
        pin,
        approverName: d.approverName,
        discountPaise: d.discountPaise,
        totalPaise: d.totalPaise,
      });
    } catch {
      setError("Could not authorize - please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Supervisor discount</DialogTitle>
          <DialogDescription>
            Choose a discount, then enter a supervisor&apos;s 4-digit PIN to authorize it.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-1 text-xs font-semibold text-muted-foreground">Percentage</div>
        <div className="flex gap-2">
          {DISCOUNT_PCTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPct(p);
                setAmount("");
              }}
              aria-pressed={pct === p}
              className={cn(
                "flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                pct === p ? "border-primary bg-accent text-accent-foreground" : "hover:border-foreground/20",
              )}
            >
              {p}%
            </button>
          ))}
        </div>

        <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or a custom amount
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
          <span className="text-sm font-semibold text-muted-foreground">₹</span>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setPct(null);
            }}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="Custom amount"
            aria-label="Custom discount amount, in rupees"
            className="h-10 flex-1 bg-transparent text-sm text-foreground outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <div className="mt-4 text-xs font-semibold text-muted-foreground">Supervisor PIN</div>
        <div className="relative mt-1.5">
          <Input
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
            type={showPin ? "text" : "password"}
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            aria-label="Supervisor PIN"
            className="pr-10 text-center text-lg tracking-[0.5em]"
            onKeyDown={(e) => {
              if (e.key === "Enter") authorize();
            }}
          />
          <button
            type="button"
            onClick={() => setShowPin((v) => !v)}
            aria-label={showPin ? "Hide PIN" : "Show PIN"}
            aria-pressed={showPin}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showPin ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {error ? <p className="mt-2 text-center text-sm font-medium text-destructive">{error}</p> : null}

        <DialogFooter className="mt-4 flex-row justify-start gap-2">
          <Button type="button" disabled={!canAuthorize} onClick={authorize}>
            {busy ? "Authorizing…" : "Authorize"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen({
  outcome,
  onReset,
  printable,
}: {
  outcome: ProcedureOutcome;
  onReset: () => void;
  printable: boolean;
}) {
  const printBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    printBtnRef.current?.focus();
  }, []);

  // Keyboard-first (dev-rules §5): "P" prints without reaching for the mouse -
  // only when a usable design exists (print-updates plan §1c).
  useEffect(() => {
    if (!printable) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        printReceipt(outcome.billId, outcome.billNumber);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [printable, outcome.billId, outcome.billNumber]);

  const rows: [string, string][] = [
    ["Patient", `${outcome.patientName} · ${outcome.patientCode}`],
  ];
  if (outcome.doctorName) {
    rows.push(["Doctor", outcome.doctorName]);
  }
  if (outcome.discountPaise > 0) {
    rows.push([
      "Discount",
      `−₹${formatPaise(outcome.discountPaise)}${outcome.approverName ? ` · ${outcome.approverName}` : ""}`,
    ]);
  }
  rows.push(["Payment", PAY_LABELS[outcome.paymentMode]]);
  rows.push(["Total paid", `₹${formatPaise(outcome.totalPaise)}`]);

  return (
    <div className="mx-auto max-w-md pt-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b border-primary/20 bg-accent px-6 py-8 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-7" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-foreground">Bill saved</h1>
          <p className="mt-1 text-sm text-accent-foreground">
            Bill <b>#{outcome.billNumber}</b> · share the receipt with the patient.
          </p>
        </div>
        <dl className="px-6 py-5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 px-6 pb-6">
          {printable ? (
            <Button
              ref={printBtnRef}
              type="button"
              className="w-full"
              onClick={() => printReceipt(outcome.billId, outcome.billNumber)}
            >
              <Printer aria-hidden />
              Print receipt
            </Button>
          ) : null}
          <Button
            type="button"
            variant={printable ? "outline" : "default"}
            className="w-full"
            onClick={onReset}
          >
            Bill another
          </Button>
        </div>
      </div>
      <div className="mt-4 text-center">
        <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function StepCard({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-bold",
            done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

// Format an ISO 'YYYY-MM-DD' day without touching time zones.
function formatDay(iso: string): string {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
