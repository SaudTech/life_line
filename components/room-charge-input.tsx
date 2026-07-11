"use client";

import { formatPaise } from "@/lib/money";

// The room charge is a per-day rate × number of days (a week-long stay is
// ₹800/day × 7). This widget captures both and shows the computed total live -
// DISPLAY ONLY; the server re-derives the money on save (dev-rules §4). Used at
// admit (room optional, can be deferred) and at discharge (rate pre-filled, days
// pre-filled from the stay length). Keyboard-first: arrows step the day count.
export function RoomChargeInput({
  rate,
  days,
  onRateChange,
  onDaysChange,
}: {
  rate: string;
  days: string;
  onRateChange: (v: string) => void;
  onDaysChange: (v: string) => void;
}) {
  const ratePaise = safeRupeesToPaise(rate);
  const daysNum = Number(days) || 0;
  const totalPaise = ratePaise > 0 && daysNum >= 1 ? ratePaise * daysNum : 0;

  return (
    <div>
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
          Rate / day (₹)
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
            <span className="text-sm font-semibold text-muted-foreground">₹</span>
            <input
              value={rate}
              onChange={(e) => onRateChange(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="800"
              aria-label="Room rate per day, in rupees"
              className="h-10 w-full bg-transparent text-sm text-foreground outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </label>

        <span className="pb-2.5 text-sm font-semibold text-muted-foreground">×</span>

        <label className="flex w-24 flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
          Days
          <input
            value={days}
            onChange={(e) => onDaysChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onKeyDown={(e) => {
              if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(e.key)) {
                e.preventDefault();
                const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1;
                onDaysChange(String(Math.max(0, (Number(days) || 0) + step)));
              }
            }}
            type="text"
            inputMode="numeric"
            placeholder="1"
            aria-label="Number of days"
            className="h-10 rounded-lg border bg-background px-2 text-center text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
          />
        </label>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Room charge</span>
        <span className="font-semibold text-foreground">
          {totalPaise > 0 ? `₹${formatPaise(totalPaise)}` : "—"}
        </span>
      </div>
    </div>
  );
}

// Display-only rupees→paise (the server is authoritative on save). Guarded so an
// in-progress "1." never throws.
function safeRupeesToPaise(input: string): number {
  const s = input.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return 0;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}
