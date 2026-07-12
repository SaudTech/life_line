"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Eye, EyeOff, Loader2, ClipboardList, Printer, RotateCcw } from "lucide-react";

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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PaymentModeIcon } from "@/components/payment-mode-icon";
import { printReceipt } from "@/components/print-receipt";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { DoctorListRow } from "@/lib/doctors/repository";
import { newPatientSchema, GENDERS } from "@/lib/patients/schema";
import { zodFieldErrors } from "@/lib/forms/action-result";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/consultations/schema";
import {
  lookupPatientsAction,
  previewConsultationAction,
  authorizeDiscountAction,
  startConsultationAction,
  type PatientPickRow,
  type ConsultationPreview,
  type ConsultationOutcome,
} from "@/lib/consultations/actions";
import type { ReissueSource } from "@/lib/billing/repository";

const PHONE_RE = /^\d{10}$/;
const PAY_LABELS: Record<PaymentModeValue, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};
const DISCOUNT_PCTS = [10, 15, 20, 25];
// Gender choices for the app-wide <Combobox> (searchable dropdown).
const GENDER_OPTIONS: ComboboxOption[] = GENDERS.map((g) => ({
  value: g,
  label: g.charAt(0).toUpperCase() + g.slice(1),
}));

type Discount = {
  pct?: number; // set when a percentage was chosen
  amountRupees?: string; // set when a custom rupee amount was entered
  pin: string;
  approverName: string;
  discountPaise: number;
  totalPaise: number;
};

// Outpatient consultation counter (PROJECT_OVERVIEW §Flows). Look up the patient by
// phone, pick the doctor, add the reason + payment, and confirm. The server decides
// free-revisit vs. paid and computes every amount - this screen only displays what
// the actions return (no money formulas in the UI, §4).
// Digits of the source patient's phone, if it's a usable 10-digit lookup - else
// "" (the operator types it). Used to pre-fill the phone step when re-issuing.
function initialReissuePhone(reissue?: ReissueSource | null): string {
  const digits = (reissue?.phone ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

export function ConsultationFlow({
  doctors,
  reissue,
  printable,
}: {
  doctors: DoctorListRow[];
  reissue?: ReissueSource | null;
  // Server-resolved: is there a consultation design a print can use for this
  // location? Gates the Print button (print-updates plan §1c).
  printable: boolean;
}) {
  // Step 1 - phone + matches
  const [phone, setPhone] = useState(() => initialReissuePhone(reissue));
  const [matches, setMatches] = useState<PatientPickRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PatientPickRow | null>(null);
  const [registerNew, setRegisterNew] = useState(false);
  const [np, setNp] = useState({ name: "", age: "", gender: "", area: "" });
  const [npErrors, setNpErrors] = useState<Record<string, string>>({});

  // Step 3/4 - doctor, preview, details
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ConsultationPreview | null>(null);
  const [reason, setReason] = useState("");
  const [payMode, setPayMode] = useState<PaymentModeValue>("cash");
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ConsultationOutcome | null>(null);

  const searchSeq = useRef(0);
  const previewSeq = useRef(0);
  // Synchronous re-entry guard for the money write. The disabled Confirm button
  // already blocks the common double-click, but a mobile double-tap (touch +
  // synthetic click) can dispatch two handlers before React repaints - and this
  // action creates a bill (and possibly a new patient). A ref is checked/flipped
  // synchronously so a second call returns immediately: never a double bill.
  const confirmingRef = useRef(false);
  const validPhone = PHONE_RE.test(phone);

  // Live, debounced exact-phone lookup. A new phone resets everything downstream.
  useEffect(() => {
    setSelected(null);
    setRegisterNew(false);
    setNpErrors({});
    setDoctorId(null);
    if (!validPhone) {
      searchSeq.current += 1;
      setMatches(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await lookupPatientsAction({ phone });
      if (seq !== searchSeq.current) return;
      setSearching(false);
      const rows = res.ok ? res.data ?? [] : [];
      setMatches(rows);
      if (rows.length === 0) setRegisterNew(true); // nobody here → register
      else if (rows.length === 1) setSelected(rows[0]); // only one → pick it
    }, 250);
    return () => clearTimeout(t);
  }, [phone, validPhone]);

  // Re-issue prefill (plan §Part B): once the source patient's phone lookup has
  // returned, select that same patient and pre-pick the same doctor, so the
  // counter lands ready to fix the wrong detail. Runs once; if the stored phone
  // wasn't a clean 10-digit number the lookup never ran and this is a no-op (the
  // banner still shows and the replaces-link is still carried on confirm).
  const reissueAppliedRef = useRef(false);
  useEffect(() => {
    if (!reissue || reissueAppliedRef.current) return;
    if (matches === null) return; // wait for the lookup to resolve
    const match = matches.find((m) => m.id === reissue.patientId);
    if (match) {
      setSelected(match);
      setRegisterNew(false);
    }
    if (reissue.doctorId && doctors.some((d) => d.id === reissue.doctorId)) {
      setDoctorId(reissue.doctorId);
    }
    reissueAppliedRef.current = true;
  }, [reissue, matches, doctors]);

  const patientReady = selected !== null || (registerNew && np.name.trim() !== "");

  // Preview free-revisit vs. paid once patient + doctor are known.
  useEffect(() => {
    setDiscount(null);
    if (!doctorId || !patientReady) {
      setPreview(null);
      return;
    }
    const doc = doctors.find((d) => d.id === doctorId);
    if (!doc) return;
    // A brand-new patient can't have a prior consultation → always new & the
    // doctor's listed fee. Existing patients need the server's revisit check.
    if (!selected) {
      previewSeq.current += 1;
      setPreview({ kind: "new", feePaise: Number(doc.fee_paise), validUntil: "", doctorName: doc.name });
      return;
    }
    const seq = ++previewSeq.current;
    setPreview(null);
    previewConsultationAction({ patientId: selected.id, doctorId }).then((res) => {
      if (seq !== previewSeq.current) return;
      if (res.ok) setPreview(res.data ?? null);
    });
  }, [doctorId, selected, patientReady, doctors]);

  function resetAll() {
    setPhone("");
    setMatches(null);
    setSelected(null);
    setRegisterNew(false);
    setNp({ name: "", age: "", gender: "", area: "" });
    setNpErrors({});
    setDoctorId(null);
    setPreview(null);
    setReason("");
    setPayMode("cash");
    setDiscount(null);
    setSubmitting(false);
    setFormError(null);
    setOutcome(null);
  }

  const isRevisit = preview?.kind === "revisit";
  const subtotalPaise = preview ? preview.feePaise : 0;
  const totalPaise = discount ? discount.totalPaise : subtotalPaise;
  const detailsReady = !!preview;
  const reasonOk = isRevisit || reason.trim() !== "";
  const canConfirm = patientReady && detailsReady && reasonOk && !submitting;

  async function confirm() {
    if (!doctorId) return;
    if (confirmingRef.current) return; // guard against a double-fire
    let patientPart: Record<string, unknown>;
    if (selected) {
      patientPart = { patientId: selected.id };
    } else {
      const parsed = newPatientSchema.safeParse({
        name: np.name,
        phone,
        age: np.age === "" ? "" : np.age,
        gender: np.gender,
        area: np.area,
      });
      if (!parsed.success) {
        setNpErrors(zodFieldErrors(parsed.error));
        return;
      }
      patientPart = { newPatient: parsed.data };
    }
    confirmingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await startConsultationAction({
        doctorId,
        ...patientPart,
        reason,
        paymentMode: payMode,
        discountPct: discount?.pct,
        discountAmount: discount?.amountRupees,
        discountPin: discount?.pin,
        // Carry the correction link when re-issuing (plan §Part B).
        replacesBillId: reissue?.billId,
      });
      if (!res.ok) {
        setNpErrors(res.fieldErrors ?? {});
        setFormError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not confirm.");
        return;
      }
      setOutcome(res.data ?? null);
    } catch {
      // The write is one all-or-nothing transaction, so a thrown/rejected action
      // means NOTHING was saved - say so plainly (no silent stuck spinner) and let
      // the operator retry safely (dev-rules §1, "never make staff wonder").
      setFormError("Could not save - nothing was recorded. Please try again.");
    } finally {
      confirmingRef.current = false;
      setSubmitting(false);
    }
  }

  if (outcome) return <SuccessScreen outcome={outcome} onReset={resetAll} printable={printable} />;

  const showMobileTotal = patientReady && !!doctorId && !!preview;

  return (
    <div className={cn("mx-auto max-w-5xl", showMobileTotal && "pb-24 lg:pb-0")}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">New consultation</h1>
          <p className="text-sm text-muted-foreground">
            Look up the patient by phone, choose a doctor, and confirm.
          </p>
        </div>
        <Link
          href="/consultations/history"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ClipboardList className="size-4" aria-hidden />
          All consultations
        </Link>
      </div>

      {reissue ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-primary/30 bg-accent p-3.5 text-sm text-accent-foreground">
          <RotateCcw className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Fixing cancelled bill <b>#{reissue.billNumber}</b> for {reissue.patientName}. Correct the
            wrong detail and confirm - this creates a new bill linked to the cancelled one.
          </span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column: patient + doctor */}
        <div className="space-y-3">

      {/* STEP 1 - Phone */}
      <StepCard n={1} title="Patient phone number" done={patientReady}>
        <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
          <span className="shrink-0 text-sm font-semibold text-muted-foreground">+91</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            type="tel"
            inputMode="numeric"
            autoFocus
            placeholder="10-digit mobile number"
            aria-label="Patient phone number"
            className="h-12 flex-1 bg-transparent text-base font-semibold tracking-wide text-foreground outline-none placeholder:font-normal placeholder:tracking-normal"
          />
          {searching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>

        {/* New-patient registration (auto when no match) */}
        {validPhone && registerNew ? (
          <div className="mt-4 rounded-xl border border-dashed bg-muted/20 p-4">
            <p className="mb-3 text-sm font-medium text-foreground">
              {matches && matches.length === 0
                ? `No patient found for +91 ${prettyPhone(phone)} - register a new one`
                : "New patient details"}
            </p>
            <div className="grid gap-3">
              <LabeledInput
                label="Full name"
                value={np.name}
                onChange={(val) => setNp((s) => ({ ...s, name: val }))}
                error={npErrors.name}
                autoFocus
                placeholder="e.g. Meera Ann"
              />
              <div className="grid grid-cols-3 gap-3">
                <LabeledInput
                  label="Age"
                  type="number"
                  min="0"
                  max="130"
                  value={np.age}
                  onChange={(val) => setNp((s) => ({ ...s, age: val.replace(/\D/g, "").slice(0, 3) }))}
                  error={npErrors.age}
                  inputMode="numeric"
                  placeholder="34"
                />
                <div className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
                  Gender
                  <Combobox
                    options={GENDER_OPTIONS}
                    value={np.gender || ""}
                    onChange={(val) => setNp((s) => ({ ...s, gender: val }))}
                    ariaLabel="Gender"
                    placeholder="Select…"
                    searchPlaceholder="Search…"
                  />
                </div>
                <LabeledInput
                  label="Area"
                  value={np.area}
                  onChange={(val) => setNp((s) => ({ ...s, area: val }))}
                  error={npErrors.area}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
        ) : null}
      </StepCard>

      {/* STEP 2 - Select patient */}
      {validPhone && matches && matches.length > 0 ? (
        <StepCard n={2} title="Select patient" done={!!selected}>
          <p className="mb-3 text-xs text-muted-foreground">
            {matches.length} {matches.length === 1 ? "patient" : "patients"} on +91 {prettyPhone(phone)}.
          </p>
          <div className="grid gap-2">
            {matches.map((p) => {
              const sel = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelected(p);
                    setRegisterNew(false);
                    setNpErrors({});
                  }}
                  aria-pressed={sel}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    sel ? "border-primary bg-accent" : "hover:border-foreground/20 hover:bg-muted/40",
                  )}
                >
                  <Avatar text={initials(p.name)} active={sel} round />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.age != null ? `${p.age} yrs` : "Age -"}
                      {p.gender ? ` · ${cap(p.gender)}` : ""}
                      {" · Last visit "}
                      {p.last_visit ? formatDay(p.last_visit) : "Never"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
                      sel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                    )}
                    aria-hidden
                  >
                    {sel ? <Check className="size-3" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {!registerNew ? (
            <button
              type="button"
              onClick={() => {
                setRegisterNew(true);
                setSelected(null);
              }}
              className="mt-2 rounded text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Someone new on this number? Register a new patient
            </button>
          ) : null}
        </StepCard>
      ) : null}

      {/* STEP 3 - Doctor */}
      {patientReady ? (
        <StepCard n={3} title="Select doctor" done={!!doctorId}>
          {doctors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No doctors available right now. Check Doctors for status/leave, or add one.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {doctors.map((d) => {
                const sel = doctorId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDoctorId(d.id)}
                    aria-pressed={sel}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      sel ? "border-primary bg-accent" : "hover:border-foreground/20 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar text={initials(d.name)} active={sel} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{d.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {d.department ?? "-"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                      <span className="text-xs text-muted-foreground">
                        {d.revisit_validity_days}-day validity
                      </span>
                      <span className="text-sm font-bold text-foreground">₹{formatPaise(d.fee_paise)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </StepCard>
      ) : null}

        </div>

        {/* Right column: details + confirm (sticky) */}
        <div className="space-y-3 lg:sticky lg:top-4">

      {/* STEP 4 - Details */}
      {patientReady && doctorId ? (
        <StepCard n={4} title="Consultation details" done={canConfirm}>
          {!preview ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
            </div>
          ) : isRevisit ? (
            <>
              <div className="mb-4 rounded-xl border border-primary/30 bg-accent p-4">
                <p className="text-sm font-semibold text-accent-foreground">Free revisit</p>
                <p className="mt-1 text-sm text-accent-foreground/80">
                  Within validity for the same doctor - no consultation fee. Valid until{" "}
                  {formatDay(preview.validUntil)}.
                </p>
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
                Notes (optional)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Follow-up, wound healing well"
                  className="resize-y rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary"
                />
              </label>
            </>
          ) : (
            <>
              <label className="mb-4 flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
                Reason for visit / symptoms
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Fever and sore throat for 3 days"
                  className="resize-y rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary"
                />
              </label>

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

              {/* Fee + discount summary */}
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Consultation fee</span>
                  <span className="font-medium text-foreground">₹{formatPaise(subtotalPaise)}</span>
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
            </>
          )}
        </StepCard>
      ) : (
        <div className="rounded-2xl border border-dashed bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Pick a patient and doctor to see the fee and payment here.
        </div>
      )}

      {/* Confirm */}
      {patientReady && doctorId ? (
        <div>
          {formError ? <p className="mb-3 text-sm font-medium text-destructive">{formError}</p> : null}
          <Button type="button" size="lg" className="w-full" disabled={!canConfirm} onClick={confirm}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {isRevisit ? "Confirm free revisit" : `Confirm consultation · ₹${formatPaise(totalPaise)}`}
          </Button>
        </div>
      ) : null}
        </div>
      </div>

      {/* Mobile running total - always visible once the fee is known (dev-rules
          §5), so the operator never scrolls to see what is payable. */}
      {showMobileTotal ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-2.5 shadow-[0_-2px_12px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              {isRevisit ? "Free revisit" : "Total payable"}
            </span>
            <span className="text-xl font-bold text-foreground">
              {isRevisit ? "No charge" : `₹${formatPaise(totalPaise)}`}
            </span>
          </div>
        </div>
      ) : null}

      {pinOpen && doctorId ? (
        <PinDialog
          doctorId={doctorId}
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
  doctorId,
  onClose,
  onApproved,
}: {
  doctorId: string;
  onClose: () => void;
  onApproved: (d: Discount) => void;
}) {
  // A discount is a percentage OR a custom rupee amount - never both at once.
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
      const res = await authorizeDiscountAction({
        doctorId,
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
      // Never leave the dialog stuck on "Authorizing..." if the action rejects.
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
                setAmount(""); // percentage clears any custom amount
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
              setPct(null); // a custom amount clears the percentage
            }}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="Custom amount"
            aria-label="Custom discount amount in rupees"
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
  outcome: ConsultationOutcome;
  onReset: () => void;
  printable: boolean;
}) {
  const revisit = outcome.kind === "revisit";
  // A free revisit creates no bill - there's nothing to print (print plan §2b);
  // and no Print button at all unless a usable design exists (print-updates §1c).
  const canPrint = outcome.billId != null && printable;
  const printBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    printBtnRef.current?.focus();
  }, []);

  // Keyboard-first (dev-rules §5): "P" prints without reaching for the mouse.
  useEffect(() => {
    if (!canPrint) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        printReceipt(outcome.billId!, outcome.billNumber!);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPrint, outcome.billId, outcome.billNumber]);
  const rows: [string, string][] = [
    ["Patient", `${outcome.patientName} · ${outcome.patientCode}`],
    ["Doctor", outcome.doctorName],
    ["Valid until", formatDay(outcome.validUntil)],
  ];
  if (!revisit) {
    if (outcome.discountPaise > 0) {
      rows.push([
        "Discount",
        `−₹${formatPaise(outcome.discountPaise)}${outcome.approverName ? ` · ${outcome.approverName}` : ""}`,
      ]);
    }
    rows.push(["Payment", outcome.paymentMode ? PAY_LABELS[outcome.paymentMode] : "-"]);
    rows.push(["Total paid", `₹${formatPaise(outcome.totalPaise)}`]);
  }

  return (
    <div className="mx-auto max-w-md pt-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b border-primary/20 bg-accent px-6 py-8 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-7" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            {revisit ? "Free revisit recorded" : "Consultation booked"}
          </h1>
          <p className="mt-1 text-sm text-accent-foreground">
            {revisit ? (
              "No charge - recorded under the existing consultation."
            ) : (
              <>
                Token <b>{outcome.billNumber}</b> · share the receipt with the patient.
              </>
            )}
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
          {canPrint ? (
            <Button
              ref={printBtnRef}
              type="button"
              className="w-full"
              onClick={() => printReceipt(outcome.billId!, outcome.billNumber!)}
            >
              <Printer aria-hidden />
              Print receipt
            </Button>
          ) : null}
          <Button
            type="button"
            variant={canPrint ? "outline" : "default"}
            className="w-full"
            onClick={onReset}
          >
            Book another
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
        <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Avatar({ text, active, round }: { text: string; active?: boolean; round?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center text-xs font-bold",
        round ? "rounded-full" : "rounded-lg",
        active ? "bg-primary/15 text-accent-foreground" : "bg-muted text-muted-foreground",
      )}
      aria-hidden
    >
      {text}
    </span>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  error,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? <span className="text-xs font-medium text-destructive">{error}</span> : null}
    </label>
  );
}

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettyPhone(digits: string): string {
  return digits.replace(/(\d{5})(\d{5})/, "$1 $2");
}

// Format an ISO 'YYYY-MM-DD' day without touching time zones.
function formatDay(iso: string): string {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
