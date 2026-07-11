import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Counter - Life Line Hospital",
};

// Counter home for the desk roles (OP Desk and OP + IP Desk). The billing flow
// (register, consult, procedure, admit/discharge) lives under the nav; the one
// card here is the end-of-day handover: each user's own daily report (plan §5).
export default function DeskHome() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold text-foreground">Billing Counter</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Use the top bar to bill. At the end of your shift, close out your day.
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
            Everything you did and collected today - for your cash handover
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
