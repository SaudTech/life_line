"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

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
import { voidBillAction } from "@/lib/billing/actions";

// The one place a finalized bill is cancelled from either history screen (plan
// §Part A - "void" internally). Cancelling reverses money, so it is gated on a
// supervisor PIN (server-verified) and needs a reason - both surfaced inline,
// never a silent failure. Mirrors the discount PinDialog in the flows so the
// counter sees a familiar dialog: primary (danger) action left, dismiss right.
export interface VoidableBill {
  id: string; // bill id
  billNumber: string;
  patientName: string;
  patientCode: string;
  totalLabel: string; // pre-formatted, e.g. "₹600.00"
}

export function VoidBillDialog({
  bill,
  onClose,
  onVoided,
}: {
  bill: VoidableBill;
  onClose: () => void;
  onVoided: (billId: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = reason.trim() !== "" && pin.length === 4 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setReasonError(null);
    setError(null);
    try {
      const res = await voidBillAction({ billId: bill.id, reason: reason.trim(), pin });
      if (!res.ok) {
        setReasonError(res.fieldErrors?.reason ?? null);
        setError(
          res.fieldErrors?.pin ??
            res.formError ??
            (res.fieldErrors ? Object.values(res.fieldErrors)[0] : null) ??
            "Could not cancel this bill.",
        );
        return;
      }
      onVoided(bill.id);
    } catch {
      // Cancel is one guarded transaction - a thrown action means nothing changed.
      setError("Could not cancel - nothing was changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel bill #{bill.billNumber}</DialogTitle>
          <DialogDescription>
            The bill stays on record, marked cancelled, and can be re-issued corrected.
            A supervisor PIN is required.
          </DialogDescription>
        </DialogHeader>

        {/* Summary of what's being reversed */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Patient</span>
            <span className="text-right font-medium text-foreground">
              {bill.patientName} · <span className="font-mono">{bill.patientCode}</span>
            </span>
          </div>
          <div className="mt-1.5 flex justify-between gap-3">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold text-foreground">{bill.totalLabel}</span>
          </div>
        </div>

        {/* Required reason */}
        <div>
          <label
            htmlFor="void-reason"
            className="text-xs font-semibold text-muted-foreground"
          >
            Reason for cancelling
          </label>
          <textarea
            id="void-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            rows={2}
            autoFocus
            placeholder="e.g. Wrong amount entered"
            className="mt-1.5 w-full resize-y rounded-lg border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary"
          />
          {reasonError ? (
            <p className="mt-1 text-xs font-medium text-destructive">{reasonError}</p>
          ) : null}
        </div>

        {/* Supervisor PIN */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground">Supervisor PIN</div>
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
                if (e.key === "Enter") submit();
              }}
            />
            <button
              type="button"
              onClick={() => setShowPin((val) => !val)}
              aria-label={showPin ? "Hide PIN" : "Show PIN"}
              aria-pressed={showPin}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showPin ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-2 text-center text-sm font-medium text-destructive">{error}</p>
        ) : null}

        <DialogFooter className="mt-4 flex-row justify-start gap-2">
          <Button type="button" variant="destructive" disabled={!canSubmit} onClick={submit}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Cancel bill
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Keep bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
