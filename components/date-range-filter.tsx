"use client";

import { useState } from "react";
import { CalendarDays, Check } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clinicToday,
  presetRange,
  PRESET_LABELS,
  type DatePreset,
} from "@/lib/date-range";

// Preset value carried by the parent. "" means no date filter ("Any date");
// otherwise one of the four presets. When "range" is active, the concrete
// dateFrom/dateTo drive the query.
export type DatePresetValue = "" | DatePreset;

const PRESETS: DatePreset[] = ["today", "yesterday", "week", "range"];

// Format an ISO 'YYYY-MM-DD' for the trigger label without touching time zones.
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

// Solid-background date filter shared by every history list (procedures,
// consultations, ...) - the ONE date-range picker, never re-implemented per
// page. A single trigger opens a popover with the four presets; Today /
// Yesterday / This Week apply and close instantly (ranges computed in the
// clinic timezone via the tested lib/date-range helper), while Range reveals
// From/To fields that apply on OK. The parent stays the one source of truth
// for the dateFrom/dateTo the server actually filters by.
export function DateRangeFilter({
  preset,
  dateFrom,
  dateTo,
  onChange,
}: {
  preset: DatePresetValue;
  dateFrom: string;
  dateTo: string;
  onChange: (next: { preset: DatePresetValue; dateFrom: string; dateTo: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  // Draft range while the popover is open, so nothing filters until OK.
  const [rangeFrom, setRangeFrom] = useState(dateFrom);
  const [rangeTo, setRangeTo] = useState(dateTo);

  const label =
    !preset
      ? "Any date"
      : preset === "range"
        ? dateFrom || dateTo
          ? `${dateFrom ? shortDay(dateFrom) : "…"} – ${dateTo ? shortDay(dateTo) : "…"}`
          : "Custom range"
        : PRESET_LABELS[preset];

  function choosePreset(p: DatePreset) {
    if (p === "range") {
      // Seed the draft fields from whatever is already applied, then stay open.
      setRangeFrom(dateFrom);
      setRangeTo(dateTo);
      onChange({ preset: "range", dateFrom, dateTo });
      return;
    }
    const r = presetRange(p, clinicToday());
    onChange({ preset: p, dateFrom: r.dateFrom, dateTo: r.dateTo });
    setOpen(false);
  }

  function applyRange() {
    onChange({ preset: "range", dateFrom: rangeFrom, dateTo: rangeTo });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter by date"
          className={cn(
            "inline-flex h-9 min-w-[140px] items-center gap-2 rounded-md border border-input bg-white px-3 text-sm shadow-xs transition-colors",
            "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
            preset ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate text-left">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-1 bg-white p-1.5">
        {PRESETS.map((p) => {
          const active = preset === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => choosePreset(p)}
              aria-pressed={active}
              className={cn(
                "flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
              )}
            >
              {PRESET_LABELS[p]}
              {active ? <Check className="size-4" aria-hidden /> : null}
            </button>
          );
        })}

        {preset === "range" ? (
          <div className="mt-1 space-y-2 border-t pt-2.5">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              From
              <input
                type="date"
                value={rangeFrom}
                max={rangeTo || undefined}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="h-9 rounded-md border bg-white px-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
              To
              <input
                type="date"
                value={rangeTo}
                min={rangeFrom || undefined}
                onChange={(e) => setRangeTo(e.target.value)}
                className="h-9 rounded-md border bg-white px-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
            </label>
            <div className="flex justify-start gap-2 pt-0.5">
              <Button type="button" size="sm" onClick={applyRange}>
                OK
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange({ preset: "", dateFrom: "", dateTo: "" });
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
