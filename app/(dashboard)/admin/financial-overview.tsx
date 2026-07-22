import Link from "next/link";
import {
  BedDouble,
  IndianRupee,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { addDays, clinicToday } from "@/lib/date-range";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  getCurrentCensus,
  getDepartmentRevenue,
  getInPatientRevenue,
  getPatientCounts,
  getPendingApprovalCount,
  getRevenueByDay,
} from "@/lib/dashboard/repository";
import {
  changePct,
  monthToDateRange,
  prevMonthComparableRange,
  seriesFromRows,
  shapeDepartmentSplit,
  sumPaise,
  type ChangeResult,
} from "@/lib/dashboard/summary";
import { Sparkline } from "./sparkline";

// The financial overview strip on the admin home (revenue today, MTD, patients
// today, revenue by department). Async server component: it reads live figures for
// the admin's own location and renders them - display only, no business logic here
// (the money reconciliation lives in the repository, the math in the pure shaper).
// Every number is real, never a mock (§5, honest system state).

// Status tint for the change badge. Colour is for status only (§5): green = up,
// red = down, grey = flat / no baseline.
function badgeTint(direction: ChangeResult["direction"]): string {
  if (direction === "up") return "bg-green-100 text-green-700";
  if (direction === "down") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

// The change badge text: a signed percentage, "New" when there's money off a zero
// baseline (no percentage to show), or a dash when nothing moved.
function badgeLabel(change: ChangeResult): string {
  if (change.pct === null) return change.direction === "up" ? "New" : "--";
  const sign = change.pct > 0 ? "+" : "";
  return `${sign}${change.pct}%`;
}

function RevenueCard({
  title,
  paise,
  change,
  series,
  footer,
}: {
  title: string;
  paise: number;
  change: ChangeResult;
  series: number[];
  footer: string;
}) {
  const isUp = change.direction === "up";
  const isDown = change.direction === "down";
  return (
    <div className="rounded-xl border bg-card p-4.5">
      {/* Title top-left, change badge top-right */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{title}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
            badgeTint(change.direction),
          )}
        >
          {isUp ? (
            <TrendingUp className="size-3" aria-hidden />
          ) : isDown ? (
            <TrendingDown className="size-3" aria-hidden />
          ) : null}
          {badgeLabel(change)}
        </span>
      </div>

      {/* Amount bottom-left, sparkline bottom-right */}
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-3xl">
          <span className="text-lg font-semibold text-muted-foreground sm:text-xl">₹</span>
          {formatPaise(paise)}
        </div>
        <Sparkline
          values={series}
          className={cn(
            "h-8 w-24 flex-none",
            isUp ? "text-green-600" : isDown ? "text-destructive" : "text-muted-foreground",
          )}
        />
      </div>

      <div className="mt-1.5 text-[11px] font-medium text-muted-foreground sm:text-xs">
        {footer}
      </div>
    </div>
  );
}

export async function FinancialOverview({ locationId }: { locationId: string }) {
  const today = clinicToday();
  const sparkStart = addDays(today, -6); // 7-day window, today inclusive
  const mtd = monthToDateRange(today);
  const prevMtd = prevMonthComparableRange(today);

  const [rev7, revMtd, revPrevMtd, patients, deptRows, inPatientPaise, census, pending] =
    await Promise.all([
      getRevenueByDay(sparkStart, today, locationId),
      getRevenueByDay(mtd.from, mtd.to, locationId),
      getRevenueByDay(prevMtd.from, prevMtd.to, locationId),
      getPatientCounts(today, today, locationId),
      getDepartmentRevenue(today, today, locationId),
      getInPatientRevenue(today, today, locationId),
      getCurrentCensus(locationId),
      getPendingApprovalCount(locationId),
    ]);

  // Today card: pull today + yesterday out of the zero-filled 7-day series so the
  // sparkline and the headline figure come from one source.
  const series7 = seriesFromRows(rev7, sparkStart, today);
  const todayRevenue = series7[series7.length - 1] ?? 0;
  const yesterdayRevenue = series7[series7.length - 2] ?? 0;
  const todayChange = changePct(todayRevenue, yesterdayRevenue);

  // MTD card: total this month to date vs the same-length slice of last month.
  const mtdSeries = seriesFromRows(revMtd, mtd.from, mtd.to);
  const mtdTotal = sumPaise(mtdSeries);
  const prevMtdTotal = sumPaise(revPrevMtd.map((r) => r.paise));
  const mtdChange = changePct(mtdTotal, prevMtdTotal);

  const departments = shapeDepartmentSplit(deptRows, inPatientPaise);

  const patientRows: { label: string; value: number; icon?: LucideIcon }[] = [
    { label: "Out-patient", value: patients.op },
    { label: "In-patient", value: patients.ip },
  ];

  return (
    <>
    {/* The only thing on this page that asks the admin to ACT. A pending bill has an
        unapproved discount, so it cannot finalise: the money is uncollected and a
        patient is waiting at a counter right now. Amber = pending (§5, colour is for
        status only). Rendered only when the queue is non-empty - a permanent "0
        pending" banner is noise staff learn to ignore. */}
    {pending > 0 && (
      <Link
        href="/supervisor/bills"
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4.5 py-3 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-sm font-semibold text-amber-900">
          {pending} bill{pending === 1 ? "" : "s"} waiting for discount approval
        </span>
        <span className="text-xs font-semibold text-amber-800">Review →</span>
      </Link>
    )}

    <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr_1fr] xl:grid-cols-4">
      <RevenueCard
        title="Revenue today"
        paise={todayRevenue}
        change={todayChange}
        series={series7}
        footer={
          yesterdayRevenue > 0
            ? `vs ₹${formatPaise(yesterdayRevenue)} yesterday`
            : "vs yesterday · last 7 days"
        }
      />
      <RevenueCard
        title="Revenue this month"
        paise={mtdTotal}
        change={mtdChange}
        series={mtdSeries}
        footer={
          prevMtdTotal > 0
            ? `vs ₹${formatPaise(prevMtdTotal)} same time last month`
            : "month to date"
        }
      />

      {/* Patients today, with the IP / OP split below the headline count. */}
      <div className="rounded-xl border bg-card p-4.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">Patients today</span>
          <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Users className="size-4" aria-hidden />
          </span>
        </div>
        <div className="mt-2.5 text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-3xl">
          {patients.total}
        </div>
        <div className="mt-2 flex gap-4">
          {patientRows.map((r) => (
            <div key={r.label} className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{r.value}</span>
              <span className="text-[11px] font-medium text-muted-foreground">{r.label}</span>
            </div>
          ))}
        </div>
        {/* The live census - patients in a bed RIGHT NOW, not a figure for today.
            Unlike every other number here it is not bounded by the clinic day, so it
            is labelled "in hospital now" and never folded into the counts above. */}
        <div className="mt-3 flex items-center gap-1.5 border-t pt-2.5">
          <BedDouble className="size-3.5 flex-none text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-semibold tabular-nums text-foreground">{census}</span>
          <span className="text-[11px] font-medium text-muted-foreground">in hospital now</span>
        </div>
      </div>

      {/* Revenue by department - spans the row on xl. */}
      <div className="rounded-xl border bg-card p-4.5 lg:col-span-3 xl:col-span-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">Revenue by department</span>
          <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <IndianRupee className="size-4" aria-hidden />
          </span>
        </div>
        {departments.length === 0 ? (
          <p className="mt-3 text-xs font-medium text-muted-foreground">
            No revenue recorded yet today.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {departments.slice(0, 6).map((d) => (
              <div key={d.department}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-medium text-foreground">{d.department}</span>
                  <span className="flex-none font-semibold tabular-nums text-muted-foreground">
                    ₹{formatPaise(d.paise)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(d.pct, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
