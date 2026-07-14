import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, ReceiptText } from "lucide-react";

import { requireRole } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { getSupervisorTeamBills, type TeamBillRow } from "@/lib/team/repository";
import { clinicToday } from "@/lib/date-range";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Team bills today - Life Line Hospital",
};

const TYPE_LABELS: Record<TeamBillRow["type"], string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  ip: "In-patient",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

// Every FINAL bill the supervisor's team created today - the list behind the "Bills
// today" figure on the supervisor dashboard. Server-gated (supervisor/admin) and
// scoped to the supervisor's own team + location. Each bill opens as its receipt
// PDF (the app's canonical bill view), in a new tab.
export default async function TeamBillsPage() {
  const session = await requireRole(["supervisor", "admin"]);
  const locationId = await getUserLocationId(session.sub);
  const today = clinicToday();
  const bills = locationId ? await getSupervisorTeamBills(session.sub, locationId, today) : [];

  const totalPaise = bills.reduce((sum, b) => sum + Number(b.total_paise), 0);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/supervisor"
        className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to My team
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Today&apos;s team bills</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Every bill your staff finalized today. Open any one to view its receipt.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {bills.length} {bills.length === 1 ? "bill" : "bills"}
          </div>
          <div className="text-xl font-bold tabular-nums text-foreground">₹{formatPaise(totalPaise)}</div>
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <ReceiptText className="size-7" aria-hidden />
          </span>
          <p className="text-base font-semibold text-foreground">No bills from your team today</p>
          <p className="mx-auto max-w-sm text-sm font-medium text-muted-foreground">
            Bills your staff finalize today will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-md border">
          {bills.map((b) => (
            <div key={b.id} className="flex items-center gap-3 bg-card px-4 py-3 text-sm">
              <div className="w-16 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                {b.time_label}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">#{b.bill_number}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {TYPE_LABELS[b.type]}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {b.patient_name} <span className="font-mono">{b.patient_code}</span> · by {b.staff_name}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums text-foreground">₹{formatPaise(b.total_paise)}</div>
                {b.payment_mode ? (
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {MODE_LABELS[b.payment_mode] ?? b.payment_mode}
                  </div>
                ) : null}
              </div>
              <a
                href={`/api/receipts/${b.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open receipt for bill #${b.bill_number}`}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Open
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
