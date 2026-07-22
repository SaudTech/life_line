import { ArrowDownLeft, ArrowUpRight, Minus } from "lucide-react";
import { PaymentModeIcon } from "@/components/payment-mode-icon";
import type { PaymentModeValue } from "@/lib/consultations/schema";
import { listRecentMovements } from "@/lib/dashboard/repository";
import {
  movementDirection,
  movementEffectPaise,
  movementLabel,
  movementNote,
  type MovementDirection,
} from "@/lib/dashboard/ledger";
import { formatPaise } from "@/lib/money";
import { relativeTime } from "@/lib/admin/activity";
import { cn } from "@/lib/utils";

// The admin's money ledger: every movement of money, in or out, newest first. Async
// server component - each row is read, shaped by the pure rules in lib/dashboard/ledger,
// and rendered. No business logic here, and no client JS: the panel has no state.
//
// Why this sits where the activity feed used to: activity tells you what STAFF did;
// this tells you what the MONEY did. On a screen about the hospital's money, the second
// is the headline and the first is context, so activity moved below.
//
// It covers BOTH places money is recorded - bills and admission advances - because an
// advance is cash taken at the counter that never becomes a bill. A bills-only list
// would silently omit it. Voided and pending bills are shown but marked and never
// counted, matching exactly how the cards above them reckon money (lib/money-in.ts).
//
// A TABLE, not a list: every row carries the same facts, so they belong in fixed
// columns an admin's eye can run down, with amounts right-aligned and tabular so the
// digits line up. The card fills its grid cell (h-full) and scrolls INTERNALLY, so it
// always matches the chart beside it instead of stretching the row (§5, nothing moves).

// Colour is for status only (§5): green = money in, red = money out, grey = no movement.
const DIRECTION_STYLE: Record<MovementDirection, { amount: string; chip: string }> = {
  in: { amount: "text-green-700", chip: "bg-green-100 text-green-700" },
  out: { amount: "text-destructive", chip: "bg-destructive/10 text-destructive" },
  none: { amount: "text-muted-foreground", chip: "bg-muted text-muted-foreground" },
};

function DirectionIcon({ direction }: { direction: MovementDirection }) {
  if (direction === "in") return <ArrowDownLeft className="size-3" aria-hidden />;
  if (direction === "out") return <ArrowUpRight className="size-3" aria-hidden />;
  return <Minus className="size-3" aria-hidden />;
}

// A payment mode is only meaningful for money that actually moved.
function isPaymentMode(v: string | null): v is PaymentModeValue {
  return v === "cash" || v === "card" || v === "upi" || v === "other";
}

const TH = "px-2 pb-1.5 text-left text-[11px] font-semibold text-muted-foreground";

export async function RecentInvoices({ locationId }: { locationId: string }) {
  const movements = await listRecentMovements(locationId, 30);
  // One server `now` for every row: relative times are computed here, so there is no
  // client clock to disagree with the server's (the hydration bug pattern §5).
  const now = new Date();

  return (
    <section className="flex h-full max-h-[420px] flex-col rounded-xl border bg-card p-4.5 lg:max-h-none">
      <div className="mb-2.5 flex flex-none items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">Recent invoices</h2>
        <span className="text-[11px] font-medium text-muted-foreground">Money in and out</span>
      </div>

      {movements.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No money has moved yet.</p>
      ) : (
        // min-h-0 is what actually lets this scroll: without it a flex child refuses to
        // shrink below its content, and the card would grow past the chart's height.
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <th scope="col" className={TH}>
                  Patient
                </th>
                <th scope="col" className={TH}>
                  Type
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Amount
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const direction = movementDirection(m);
                const effect = movementEffectPaise(m);
                const note = movementNote(m);
                const style = DIRECTION_STYLE[direction];
                // Show the magnitude and let the sign live in the +/- prefix, so a
                // refund reads "- ₹2,000" rather than "₹-2,000".
                const shown = Math.abs(direction === "none" ? m.grossPaise : effect);
                const sign = direction === "in" ? "+" : direction === "out" ? "-" : "";

                return (
                  <tr key={m.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-2 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-5 flex-none items-center justify-center rounded",
                            style.chip,
                          )}
                        >
                          <DirectionIcon direction={direction} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-foreground">
                            {m.patientName}
                          </span>
                          <span className="block text-[11px] font-medium tabular-nums text-muted-foreground">
                            {m.patientCode}
                          </span>
                        </span>
                      </div>
                    </td>

                    <td className="px-2 py-2 align-middle">
                      <span className="block text-xs font-medium text-foreground">
                        {movementLabel(m)}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        {m.billNumber ? (
                          <span className="tabular-nums">#{m.billNumber}</span>
                        ) : (
                          <span>No bill</span>
                        )}
                        {isPaymentMode(m.paymentMode) && direction !== "none" && (
                          <PaymentModeIcon mode={m.paymentMode} className="size-3 flex-none" />
                        )}
                      </span>
                    </td>

                    <td
                      className={cn(
                        "whitespace-nowrap px-2 py-2 text-right align-middle text-[13px] font-bold tabular-nums",
                        style.amount,
                        // A voided invoice's amount is struck through: the number is
                        // real history, but it is not money the hospital holds.
                        m.status === "void" && "line-through decoration-1",
                      )}
                    >
                      {sign}
                      {sign && " "}₹{formatPaise(shown)}
                    </td>

                    <td className="whitespace-nowrap px-2 py-2 text-right align-middle text-[11px] font-medium text-muted-foreground">
                      {note ?? relativeTime(m.at, now)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
