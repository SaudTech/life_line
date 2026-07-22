"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/date-range";

// A single clinic day picker with prev/next arrows, a date input, and a Today
// button - the one day-at-a-time control shared by /reports and
// /consultations/history. Not a range picker: it always points at exactly one
// calendar day, never past `todayIso` (there is no "future" clinic data).
export function DayStepper({
  day,
  todayIso,
  onChange,
}: {
  day: string;
  todayIso: string;
  onChange: (day: string) => void;
}) {
  const atToday = day >= todayIso;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 items-center gap-1 rounded-lg border bg-card px-1">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => onChange(addDays(day, -1))}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <input
          type="date"
          value={day}
          max={todayIso}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Date"
          className="h-7 rounded bg-transparent px-1 text-sm text-foreground outline-none"
        />
        <button
          type="button"
          aria-label="Next day"
          disabled={atToday}
          onClick={() => onChange(addDays(day, 1))}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(todayIso)}
        disabled={day === todayIso}
      >
        Today
      </Button>
    </div>
  );
}
