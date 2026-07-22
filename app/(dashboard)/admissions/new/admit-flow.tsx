"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BedDouble, Check, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PaymentModeIcon } from "@/components/payment-mode-icon";
import { printAdvanceReceipt } from "@/components/print-advance-receipt";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { newPatientSchema, GENDERS } from "@/lib/patients/schema";
import { zodFieldErrors } from "@/lib/forms/action-result";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/admissions/schema";
import { lookupForAdmitAction, admitAction, type AdmitOutcome } from "@/lib/admissions/actions";
import type { PatientRow } from "@/lib/patients/repository";

const PHONE_RE = /^\d{10}$/;
const PAY_LABELS: Record<PaymentModeValue, string> = { cash: "Cash", card: "Card", upi: "UPI", other: "Other" };
const GENDER_OPTIONS: ComboboxOption[] = GENDERS.map((g) => ({
  value: g,
  label: g.charAt(0).toUpperCase() + g.slice(1),
}));

// Admit an in-patient with an advance (plan §5b). Look up the patient by phone
// (register-if-new, reusing the same intake as OPD/procedures), record the advance
// + payment mode + optional room RATE/day, and save. On success this screen shows
// a confirmation (Admission #, advance receipt print) - mirrors the OPD/procedure
// flows' own success screens - before the desk moves on to add expenses. The
// number of room days is set later, at discharge. This screen computes no money.
export function AdmitFlow({ advancePrintable }: { advancePrintable: boolean }) {
  const [outcome, setOutcome] = useState<AdmitOutcome | null>(null);
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<PatientRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PatientRow | null>(null);
  const [registerNew, setRegisterNew] = useState(false);
  const [np, setNp] = useState({ name: "", age: "", gender: "", area: "" });
  const [npErrors, setNpErrors] = useState<Record<string, string>>({});

  const [advance, setAdvance] = useState("");
  const [roomRate, setRoomRate] = useState("");
  const [payMode, setPayMode] = useState<PaymentModeValue>("cash");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const searchSeq = useRef(0);
  const submittingRef = useRef(false);
  const validPhone = PHONE_RE.test(phone);

  useEffect(() => {
    setSelected(null);
    setRegisterNew(false);
    setNpErrors({});
    if (!validPhone) {
      searchSeq.current += 1;
      setMatches(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await lookupForAdmitAction({ phone });
      if (seq !== searchSeq.current) return;
      setSearching(false);
      const rows = res.ok ? res.data ?? [] : [];
      setMatches(rows);
      if (rows.length === 0) setRegisterNew(true);
      else if (rows.length === 1) setSelected(rows[0]);
    }, 250);
    return () => clearTimeout(t);
  }, [phone, validPhone]);

  const patientReady = selected !== null || (registerNew && np.name.trim() !== "");
  const advanceValid = /^\d{1,7}(\.\d{1,2})?$/.test(advance.trim());
  const canSubmit = patientReady && advanceValid && !submitting;

  async function confirm() {
    if (submittingRef.current) return;
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
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await admitAction({
        ...patientPart,
        advanceAmount: advance.trim(),
        paymentMode: payMode,
        roomRate: roomRate.trim() || undefined,
      });
      if (!res.ok) {
        setNpErrors(res.fieldErrors ?? {});
        setFormError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not admit.");
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
      setOutcome(res.data!);
    } catch {
      setFormError("Could not save - nothing was recorded. Please try again.");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function resetAll() {
    setOutcome(null);
    setPhone("");
    setMatches(null);
    setSelected(null);
    setRegisterNew(false);
    setNp({ name: "", age: "", gender: "", area: "" });
    setNpErrors({});
    setAdvance("");
    setRoomRate("");
    setPayMode("cash");
    submittingRef.current = false;
    setSubmitting(false);
    setFormError(null);
  }

  if (outcome) {
    return <SuccessScreen outcome={outcome} advancePrintable={advancePrintable} onReset={resetAll} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Admit a patient</h1>
          <p className="text-sm text-muted-foreground">
            Look up the patient by phone, record the advance, and admit.
          </p>
        </div>
        <Link
          href="/admissions"
          className="rounded-lg border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All in-patients
        </Link>
      </div>

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

          {validPhone && matches && matches.length > 0 ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted-foreground">
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
                        "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        sel ? "border-primary bg-accent" : "hover:border-foreground/20 hover:bg-muted/40",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.patient_code}
                          {p.age != null ? ` · ${p.age} yrs` : ""}
                          {p.gender ? ` · ${cap(p.gender)}` : ""}
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
            </div>
          ) : null}
        </StepCard>

        {/* STEP 2 - Advance */}
        {patientReady ? (
          <StepCard n={2} title="Advance & payment" done={advanceValid}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
                Advance received (₹)
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                  <span className="text-sm font-semibold text-muted-foreground">₹</span>
                  <input
                    value={advance}
                    onChange={(e) => setAdvance(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    // Focus the advance only when an existing patient was picked -
                    // NOT while registering a new one, or it steals focus from the
                    // Full Name field on the first keystroke (that flips patientReady,
                    // mounting this step).
                    autoFocus={selected !== null}
                    placeholder="5000"
                    aria-label="Advance received in rupees"
                    className="h-10 flex-1 bg-transparent text-sm text-foreground outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
                Room rate / day (₹, optional)
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                  <span className="text-sm font-semibold text-muted-foreground">₹</span>
                  <input
                    value={roomRate}
                    onChange={(e) => setRoomRate(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="e.g. 800 / day"
                    aria-label="Room rate per day, in rupees"
                    className="h-10 flex-1 bg-transparent text-sm text-foreground outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <span className="text-[11px] font-normal text-muted-foreground">Days are set at discharge.</span>
              </label>
            </div>

            <div className="mt-4 mb-2 text-xs font-semibold text-muted-foreground">Payment mode</div>
            <div className="flex gap-2">
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

            {formError ? <p className="mt-3 text-sm font-medium text-destructive">{formError}</p> : null}
            <Button type="button" size="lg" className="mt-4 w-full" disabled={!canSubmit} onClick={confirm}>
              {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <BedDouble aria-hidden />}
              {advanceValid ? `Admit · advance ₹${formatPaise(rupeesToPaiseSafe(advance))}` : "Admit patient"}
            </Button>
          </StepCard>
        ) : (
          <div className="rounded-2xl border border-dashed bg-card/40 p-8 text-center text-sm text-muted-foreground">
            Find or register a patient to record the advance.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Success screen ───────────────────────────────────────────────────────────
// Mirrors app/(dashboard)/consultations/consultation-flow.tsx's SuccessScreen:
// the admission's OWN id (created here, well before any bill exists - the
// discharge invoice's bill_number comes later) is the headline, not a bill
// number. Print is the advance receipt, gated by the server-resolved template
// check (print-updates §1c) - never shown when no design exists to print it.
function SuccessScreen({
  outcome,
  advancePrintable,
  onReset,
}: {
  outcome: AdmitOutcome;
  advancePrintable: boolean;
  onReset: () => void;
}) {
  const printBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    printBtnRef.current?.focus();
  }, []);

  const rows: [string, string][] = [
    ["Patient", `${outcome.patientName} · ${outcome.patientCode}`],
    ["Advance paid", `₹${formatPaise(outcome.advancePaise)}`],
    ["Payment", PAY_LABELS[outcome.paymentMode]],
  ];
  if (outcome.roomRatePaise != null) {
    rows.push(["Room rate", `₹${formatPaise(outcome.roomRatePaise)}/day`]);
  }

  return (
    <div className="mx-auto max-w-md pt-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b border-primary/20 bg-accent px-6 py-8 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-7" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-foreground">Patient admitted</h1>
          <p className="mt-1 text-sm text-accent-foreground">
            Admission <b>#{outcome.admissionId}</b> · add expenses any time before discharge.
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
          {advancePrintable ? (
            <Button
              ref={printBtnRef}
              type="button"
              className="w-full"
              onClick={() => printAdvanceReceipt(outcome.admissionId)}
            >
              <Printer aria-hidden />
              Print advance receipt
            </Button>
          ) : null}
          <Button asChild variant={advancePrintable ? "outline" : "default"} className="w-full">
            <Link href={`/admissions/${outcome.admissionId}`}>Go to admission</Link>
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={onReset}>
            Admit another patient
          </Button>
        </div>
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
      <Input value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} {...rest} />
      {error ? <span className="text-xs font-medium text-destructive">{error}</span> : null}
    </label>
  );
}

// Display-only paise for the button label (the server is authoritative on save).
// Guarded so an in-progress "1." never throws in the label.
function rupeesToPaiseSafe(input: string): number {
  const s = input.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return 0;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function prettyPhone(digits: string): string {
  return digits.replace(/(\d{5})(\d{5})/, "$1 $2");
}
