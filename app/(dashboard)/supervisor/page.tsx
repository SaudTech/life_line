import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Supervisor - Life Line Hospital",
};

// Supervisor home. Discount approvals and discounted-bill review will live here;
// for now the one card is the supervisor's own daily report (plan §5) - including
// the discounts they approved.
export default function SupervisorHome() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold text-foreground">Supervisor</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Close out your own day, including the discounts you approved.
      </p>

      <Link
        href="/reports"
        className="group mt-5 flex max-w-md items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-accent hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <BarChart3 className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">My day</span>
          <span className="block text-xs font-medium text-muted-foreground">
            Everything you did and collected today, plus discounts you approved
          </span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}
