"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Plus, Printer, ReceiptText, Trash2 } from "lucide-react";

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
import { RoomChargeInput } from "@/components/room-charge-input";
import { VoidBillDialog } from "@/components/void-bill-dialog";
import { printAdvanceReceipt } from "@/components/print-advance-receipt";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import type { ServiceRow } from "@/lib/services/repository";
import type { AdmissionDetail, AdmissionExpenseRow } from "@/lib/admissions/repository";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/admissions/schema";
import {
  addExpenseAction,
  removeExpenseAction,
  previewDischargeAction,
  authorizeDischargeDiscountAction,
  dischargeAction,
  type ExpenseTally,
  type DischargePreview,
  type DischargeOutcome,
} from "@/lib/admissions/actions";
import type { DischargeBalance } from "@/lib/billing/discharge";

const PAY_LABELS: Record<PaymentModeValue, string> = { cash: "Cash", card: "Card", upi: "UPI", other: "Other" };
const DISCOUNT_PCTS = [10, 15, 20, 25];

type Discount = {
  pct?: number;
  amountRupees?: string;
  pin: string;
  approverName: string;
  // The full server-computed balance WITH this discount applied - so the settle
  // box shows server money, never a client formula (dev-rules §4).
  balance: DischargeBalance;
};

// One admission's working screen (plan §5c/§6). Admitted → add catalog-only,
// server-priced expenses with a live running total, then discharge (confirm room
// charge, optional supervisor-PIN discount, collect balance OR record a refund).
// Discharged → the final invoice summary with reprint + cancel. Every amount is
// server-computed; this screen never runs a money formula (dev-rules §4).
export function AdmissionDetailView({
  detail,
  services,
  justAdmitted = false,
}: {
  detail: AdmissionDetail;
  services: ServiceRow[];
  justAdmitted?: boolean;
}) {
  const dischargedInitially = detail.status === "discharged";

  // Live tally (server-authoritative), seeded from the initial detail.
  const [expenses, setExpenses] = useState<AdmissionExpenseRow[]>(detail.expenses);
  const [roomChargePaise, setRoomChargePaise] = useState<number>(Number(detail.room_charge_paise));
  const advancePaise = Number(detail.advance_paid_paise);
  const expensesTotalPaise = expenses.reduce((sum, e) => sum + Number(e.total_paise), 0);
  const runningTotalPaise = roomChargePaise + expensesTotalPaise;

  // Just-discharged outcome (so we can show the success + print without a reload).
  const [outcome, setOutcome] = useState<DischargeOutcome | null>(null);

  if (dischargedInitially || outcome) {
    return (
      <DischargedView
        detail={detail}
        outcome={outcome}
        expenses={expenses}
        advancePaise={advancePaise}
      />
    );
  }

  return (
    <AdmittedView
      detail={detail}
      services={services}
      justAdmitted={justAdmitted}
      expenses={expenses}
      setExpenses={setExpenses}
      roomChargePaise={roomChargePaise}
      setRoomChargePaise={setRoomChargePaise}
      advancePaise={advancePaise}
      expensesTotalPaise={expensesTotalPaise}
      runningTotalPaise={runningTotalPaise}
      onDischarged={setOutcome}
    />
  );
}

// ── Admitted: expense tally + discharge ──────────────────────────────────────
function AdmittedView({
  detail,
  services,
  justAdmitted,
  expenses,
  setExpenses,
  roomChargePaise,
  setRoomChargePaise,
  advancePaise,
  expensesTotalPaise,
  runningTotalPaise,
  onDischarged,
}: {
  detail: AdmissionDetail;
  services: ServiceRow[];
  justAdmitted: boolean;
  expenses: AdmissionExpenseRow[];
  setExpenses: (e: AdmissionExpenseRow[]) => void;
  roomChargePaise: number;
  setRoomChargePaise: (p: number) => void;
  advancePaise: number;
  expensesTotalPaise: number;
  runningTotalPaise: number;
  onDischarged: (o: DischargeOutcome) => void;
}) {
  // Add-expense row.
  const [serviceId, setServiceId] = useState("");
  const [qty, setQty] = useState("1");
  const [adding, setAdding] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const serviceRef = useRef<HTMLButtonElement>(null);

  // Discharge panel. Room = rate/day × days: pre-fill the rate from the admission
  // (or a stored flat total split as rate×1), and the days from the recorded days
  // else the actual stay length (a helpful default for a multi-day stay).
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [roomRate, setRoomRate] = useState(
    detail.room_rate_paise != null
      ? paiseToRupeesInput(Number(detail.room_rate_paise))
      : roomChargePaise > 0
        ? paiseToRupeesInput(roomChargePaise)
        : "",
  );
  const [roomDays, setRoomDays] = useState(String(detail.room_days ?? detail.stay_days ?? 1));
  const [payMode, setPayMode] = useState<PaymentModeValue>("cash");
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [preview, setPreview] = useState<DischargePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const previewSeq = useRef(0);
  const submittingRef = useRef(false);

  const qtyNum = Number(qty);
  const canAdd = serviceId !== "" && Number.isInteger(qtyNum) && qtyNum >= 1 && !adding;

  async function addExpense() {
    if (!canAdd) return;
    setAdding(true);
    setExpenseError(null);
    try {
      const res = await addExpenseAction({ admissionId: detail.id, serviceId, quantity: qtyNum });
      if (!res.ok) {
        setExpenseError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not add.");
        return;
      }
      applyTally(res.data!);
      setServiceId("");
      setQty("1");
      serviceRef.current?.focus();
    } catch {
      setExpenseError("Could not add - please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function removeExpense(expenseId: string) {
    const res = await removeExpenseAction({ admissionId: detail.id, expenseId });
    if (res.ok) applyTally(res.data!);
  }

  function applyTally(t: ExpenseTally) {
    setExpenses(t.expenses);
    setRoomChargePaise(Number(t.roomChargePaise));
  }

  // Debounced discharge preview - re-priced server-side whenever the room charge
  // changes (the discount, when set, is applied via its own authorize call).
  useEffect(() => {
    if (!dischargeOpen) return;
    setDiscount(null);
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const res = await previewDischargeAction({
        admissionId: detail.id,
        roomRate: roomRate.trim() || undefined,
        roomDays: roomDays.trim() ? Number(roomDays) : undefined,
      });
      if (seq !== previewSeq.current) return;
      setPreviewing(false);
      setPreview(res.ok ? res.data ?? null : null);
      if (!res.ok) setFormError(res.formError ?? null);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dischargeOpen, roomRate, roomDays, expensesTotalPaise]);

  // Server-authoritative figures for the settle box: the discount's balance when
  // one is applied, else the (discount-free) preview. Every amount below is
  // computed by the server (calculateDischargeBalance) - this screen runs no money
  // formula (dev-rules §4). Falls back to the running tally only until the first
  // preview lands.
  const activeBalance: DischargeBalance | null = discount ? discount.balance : preview;
  const subtotalPaise = activeBalance?.subtotalPaise ?? runningTotalPaise;
  const discountPaise = activeBalance?.discountPaise ?? 0;
  const totalPaise = activeBalance?.totalPaise ?? Math.max(0, runningTotalPaise);
  const balanceDuePaise = activeBalance?.balanceDuePaise ?? Math.max(0, runningTotalPaise - advancePaise);
  const refundPaise = activeBalance?.refundPaise ?? Math.max(0, advancePaise - runningTotalPaise);

  async function confirmDischarge() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await dischargeAction({
        admissionId: detail.id,
        roomRate: roomRate.trim() || undefined,
        roomDays: roomDays.trim() ? Number(roomDays) : undefined,
        paymentMode: payMode,
        discountPct: discount?.pct,
        discountAmount: discount?.amountRupees,
        discountPin: discount?.pin,
      });
      if (!res.ok) {
        setFormError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "Could not discharge.");
        return;
      }
      onDischarged(res.data!);
    } catch {
      setFormError("Could not discharge - nothing was recorded. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl pb-24 lg:pb-0">
      <BackLink />
      <PatientHeader detail={detail} status="admitted" />

      {/* Just-admitted banner: print the advance receipt + reassure that items are
          added now and discharge is a separate, later step. */}
      {justAdmitted ? (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-accent p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3.5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-accent-foreground">
                  Admitted · advance ₹{formatPaise(advancePaise)} recorded
                </p>
                <p className="mt-0.5 text-xs text-accent-foreground/80">
                  Print the advance receipt for the family, then add any service items below.
                  You don&apos;t discharge yet - that&apos;s a separate step when the patient leaves.
                </p>
              </div>
            </div>
            <Button type="button" size="sm" className="shrink-0" onClick={() => printAdvanceReceipt(detail.id)}>
              <ReceiptText aria-hidden />
              Print advance receipt
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          {/* Expenses */}
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-[15px] font-bold text-foreground">Expenses</h2>

            {expenses.length === 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">No expenses added yet.</p>
            ) : (
              <div className="mb-3 grid gap-1.5">
                {expenses.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {e.item} <span className="text-muted-foreground">×{e.quantity}</span>
                    </span>
                    <span className="w-24 shrink-0 text-right font-semibold text-foreground">
                      ₹{formatPaise(e.total_paise)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExpense(e.id)}
                      aria-label={`Remove ${e.item}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add row (catalog-only) */}
            <div className="flex items-center gap-2">
              <ServiceCombobox
                ref={serviceRef}
                services={services}
                value={serviceId}
                onChange={setServiceId}
                className="flex-1"
              />
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => {
                  if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(e.key)) {
                    e.preventDefault();
                    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1;
                    setQty(String(Math.max(1, (Number(qty) || 0) + step)));
                  }
                  if (e.key === "Enter") addExpense();
                }}
                type="text"
                inputMode="numeric"
                aria-label="Quantity"
                placeholder="Qty"
                className="h-10 w-16 rounded-lg border bg-background px-2 text-center text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
              <Button type="button" variant="outline" size="sm" className="h-10" disabled={!canAdd} onClick={addExpense}>
                {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                Add
              </Button>
            </div>
            {expenseError ? <p className="mt-2 text-sm font-medium text-destructive">{expenseError}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Expenses come from the services catalog and are priced live on the server. Each item
              is <b>saved as you add it</b> - you can leave and come back; nothing is billed until
              you discharge.
            </p>
          </section>
        </div>

        {/* Right: running total + discharge (sticky) */}
        <div className="space-y-3 lg:sticky lg:top-4">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-[15px] font-bold text-foreground">Running bill</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={roomLabel(detail)} value={`₹${formatPaise(roomChargePaise)}`} />
              <Row label="Expenses" value={`₹${formatPaise(expensesTotalPaise)}`} />
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <span className="text-sm font-bold text-foreground">Running total</span>
                <span className="text-lg font-bold text-foreground">₹{formatPaise(runningTotalPaise)}</span>
              </div>
              <Row label="Advance paid" value={`−₹${formatPaise(advancePaise)}`} muted />
            </dl>

            {!dischargeOpen ? (
              <div className="mt-4 space-y-2">
                <Button type="button" size="lg" className="w-full" onClick={() => setDischargeOpen(true)}>
                  Proceed to discharge
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/admissions">Save &amp; keep admitted</Link>
                </Button>
                <button
                  type="button"
                  onClick={() => printAdvanceReceipt(detail.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ReceiptText className="size-3.5" aria-hidden />
                  Reprint advance receipt
                </button>
              </div>
            ) : null}
          </section>

          {dischargeOpen ? (
            <section className="rounded-2xl border border-primary/30 bg-card p-4 shadow-sm">
              <h2 className="mb-3 text-[15px] font-bold text-foreground">Discharge</h2>

              <RoomChargeInput rate={roomRate} days={roomDays} onRateChange={setRoomRate} onDaysChange={setRoomDays} />
              <p className="mt-1 text-xs text-muted-foreground">
                Suggested {detail.stay_days} day{detail.stay_days === 1 ? "" : "s"} from the stay length - adjust if needed.
              </p>

              <div className="mt-3 mb-2 text-xs font-semibold text-muted-foreground">Payment mode</div>
              <div className="mb-3 flex gap-2">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayMode(m)}
                    aria-pressed={payMode === m}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      payMode === m ? "border-primary bg-accent text-accent-foreground" : "hover:border-foreground/20 hover:bg-muted/40",
                    )}
                  >
                    <PaymentModeIcon mode={m} className="size-4" />
                    {PAY_LABELS[m]}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border bg-muted/20 p-4">
                <SettleRow label="Subtotal" value={`₹${formatPaise(subtotalPaise)}`} loading={previewing} />
                {discount ? (
                  <div className="mt-2 flex items-start justify-between text-sm text-accent-foreground">
                    <span>
                      <span className="block">Discount{discount.pct ? ` (${discount.pct}%)` : ""}</span>
                      <span className="block text-xs text-accent-foreground/80">approved by {discount.approverName}</span>
                    </span>
                    <span className="font-medium">−₹{formatPaise(discount.balance.discountPaise)}</span>
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium text-foreground">₹{formatPaise(totalPaise)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Advance paid</span>
                  <span className="font-medium text-foreground">−₹{formatPaise(advancePaise)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  {refundPaise > 0 ? (
                    <>
                      <span className="text-sm font-bold text-emerald-700">Refund to patient</span>
                      <span className="text-lg font-bold text-emerald-700">₹{formatPaise(refundPaise)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-foreground">Balance due</span>
                      <span className="text-lg font-bold text-foreground">₹{formatPaise(balanceDuePaise)}</span>
                    </>
                  )}
                </div>

                {discount ? (
                  <Button type="button" variant="outline" size="sm" className="mt-3 w-full text-destructive hover:text-destructive" onClick={() => setDiscount(null)}>
                    Remove discount
                  </Button>
                ) : subtotalPaise > 0 ? (
                  <Button type="button" variant="outline" size="sm" className="mt-3 w-full border-dashed text-accent-foreground" onClick={() => setPinOpen(true)}>
                    ＋ Apply discount (supervisor PIN)
                  </Button>
                ) : null}
              </div>

              {refundPaise > 0 ? (
                <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                  The advance exceeds the bill - hand back ₹{formatPaise(refundPaise)} to the patient. This is recorded on the invoice.
                </p>
              ) : null}

              {formError ? <p className="mt-3 text-sm font-medium text-destructive">{formError}</p> : null}
              <Button type="button" size="lg" className="mt-3 w-full" disabled={submitting || previewing} onClick={confirmDischarge}>
                {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {refundPaise > 0 ? "Discharge & record refund" : `Discharge · collect ₹${formatPaise(balanceDuePaise)}`}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setDischargeOpen(false)}>
                Back to expenses
              </Button>
            </section>
          ) : null}
        </div>
      </div>

      {/* Mobile running total */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-2.5 shadow-[0_-2px_12px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">Running total</span>
          <span className="text-xl font-bold text-foreground">₹{formatPaise(runningTotalPaise)}</span>
        </div>
      </div>

      {pinOpen ? (
        <DischargePinDialog
          admissionId={detail.id}
          roomRate={roomRate.trim() || undefined}
          roomDays={roomDays.trim() ? Number(roomDays) : undefined}
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

// ── Discharged: final invoice ────────────────────────────────────────────────
function DischargedView({
  detail,
  outcome,
  expenses,
  advancePaise,
}: {
  detail: AdmissionDetail;
  outcome: DischargeOutcome | null;
  expenses: AdmissionExpenseRow[];
  advancePaise: number;
}) {
  const [voidOpen, setVoidOpen] = useState(false);
  const [voided, setVoided] = useState(false);

  // Prefer the just-discharged outcome; otherwise read the persisted bill figures.
  const billId = outcome?.billId ?? detail.bill_id;
  const billNumber = outcome?.billNumber ?? detail.bill_number;
  const subtotalPaise = outcome ? outcome.balance.subtotalPaise : Number(detail.bill_subtotal_paise ?? 0);
  const discountPaise = outcome ? outcome.balance.discountPaise : Number(detail.bill_discount_paise ?? 0);
  const totalPaise = outcome ? outcome.balance.totalPaise : Number(detail.bill_total_paise ?? 0);
  const balanceDuePaise = outcome ? outcome.balance.balanceDuePaise : Math.max(0, totalPaise - advancePaise);
  const refundPaise = outcome ? outcome.balance.refundPaise : Math.max(0, advancePaise - totalPaise);
  const isVoid = voided || detail.bill_status === "void";

  const printBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    printBtnRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!billId || !billNumber) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        printReceipt(billId!, billNumber!, outcome ? undefined : { copy: "duplicate" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [billId, billNumber, outcome]);

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className={cn("border-b px-6 py-6 text-center", isVoid ? "border-destructive/20 bg-destructive/5" : "border-primary/20 bg-accent")}>
          <div className={cn("mx-auto mb-3 flex size-12 items-center justify-center rounded-full", isVoid ? "bg-destructive text-white" : "bg-primary text-primary-foreground")}>
            <Check className="size-6" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            {isVoid ? "Discharge bill cancelled" : outcome ? "Patient discharged" : "Discharged"}
          </h1>
          <p className="mt-1 text-sm text-accent-foreground">
            {detail.patient_name} · <span className="font-mono text-xs">{detail.patient_code}</span>
            {billNumber ? <> · Invoice <b>#{billNumber}</b></> : null}
          </p>
        </div>

        <div className="px-6 py-5">
          {/* Charges */}
          <div className="mb-3">
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Charges</div>
            <div className="grid gap-1 text-sm">
              <Row label={roomLabel(detail)} value={`₹${formatPaise(detail.room_charge_paise)}`} />
              {expenses.map((e) => (
                <Row key={e.id} label={`${e.item} ×${e.quantity}`} value={`₹${formatPaise(e.total_paise)}`} />
              ))}
            </div>
          </div>

          <dl className="space-y-1 border-t pt-3 text-sm">
            <Row label="Subtotal" value={`₹${formatPaise(subtotalPaise)}`} />
            {discountPaise > 0 ? <Row label="Discount" value={`−₹${formatPaise(discountPaise)}`} /> : null}
            <Row label="Total" value={`₹${formatPaise(totalPaise)}`} />
            <Row label="Advance paid" value={`−₹${formatPaise(advancePaise)}`} muted />
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              {refundPaise > 0 ? (
                <>
                  <span className="text-sm font-bold text-emerald-700">Refund to patient</span>
                  <span className="text-lg font-bold text-emerald-700">₹{formatPaise(refundPaise)}</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-bold text-foreground">Balance {balanceDuePaise > 0 ? "collected" : "settled"}</span>
                  <span className="text-lg font-bold text-foreground">₹{formatPaise(balanceDuePaise)}</span>
                </>
              )}
            </div>
          </dl>
        </div>

        {billId && billNumber ? (
          <div className="flex flex-col gap-2 px-6 pb-6">
            <Button ref={printBtnRef} type="button" className="w-full" onClick={() => printReceipt(billId, billNumber, outcome ? undefined : { copy: "duplicate" })}>
              <Printer aria-hidden />
              Print invoice
            </Button>
            {!isVoid ? (
              <Button type="button" variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setVoidOpen(true)}>
                Cancel this bill
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {voidOpen && billId && billNumber ? (
        <VoidBillDialog
          bill={{
            id: billId,
            billNumber,
            patientName: detail.patient_name,
            patientCode: detail.patient_code,
            totalLabel: `₹${formatPaise(totalPaise)}`,
          }}
          onClose={() => setVoidOpen(false)}
          onVoided={() => {
            setVoided(true);
            setVoidOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ── Discharge discount PIN dialog ────────────────────────────────────────────
function DischargePinDialog({
  admissionId,
  roomRate,
  roomDays,
  onClose,
  onApproved,
}: {
  admissionId: string;
  roomRate?: string;
  roomDays?: number;
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
      const res = await authorizeDischargeDiscountAction({
        admissionId,
        roomRate,
        roomDays,
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
        balance: d.balance,
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
          <DialogDescription>Choose a discount, then enter a supervisor&apos;s 4-digit PIN to authorize it.</DialogDescription>
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

// ── Small pieces ─────────────────────────────────────────────────────────────
function BackLink() {
  return (
    <Link
      href="/admissions"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All in-patients
    </Link>
  );
}

function PatientHeader({ detail, status }: { detail: AdmissionDetail; status: "admitted" | "discharged" }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div>
        <h1 className="text-lg font-bold text-foreground">
          {detail.patient_name} <span className="font-mono text-sm text-muted-foreground">{detail.patient_code}</span>
        </h1>
        <p className="text-xs text-muted-foreground">
          Admitted {detail.admitted_label}
          {detail.phone ? ` · ${detail.phone}` : ""}
        </p>
      </div>
      <span
        className={cn(
          "rounded-full px-3 py-1 text-xs font-semibold",
          status === "admitted" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {status === "admitted" ? "Admitted" : "Discharged"}
      </span>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-muted-foreground", muted && "text-xs")}>{label}</span>
      <span className={cn("font-medium text-foreground", muted && "text-xs text-muted-foreground")}>{value}</span>
    </div>
  );
}

function SettleRow({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : value}
      </span>
    </div>
  );
}

// "Room charge" with the per-day breakdown when the room was billed as rate × days
// (e.g. "Room charge (₹800.00/day × 7)"), else just "Room charge".
function roomLabel(detail: AdmissionDetail): string {
  if (detail.room_rate_paise != null && detail.room_days != null && Number(detail.room_charge_paise) > 0) {
    return `Room charge (₹${formatPaise(detail.room_rate_paise)}/day × ${detail.room_days})`;
  }
  return "Room charge";
}

// Stored paise → a plain rupee string for a number input ("200000" → "2000",
// "205050" → "2050.5"). No thousands separators (a number input rejects them).
function paiseToRupeesInput(paise: number): string {
  if (!paise) return "";
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}
