import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth/dal";
import { getUserName, listRecentActivity } from "@/lib/users/repository";
import { getReportContext } from "@/lib/reports/repository";
import {
  getDoctorShareTotal,
  getFirstRevenueDay,
  getRevenueByDay,
} from "@/lib/dashboard/repository";
import { FinancialOverview } from "./financial-overview";
import { RevenueChart } from "./revenue-chart";
import { RecentInvoices } from "./recent-invoices";
import { CardsSkeleton, ChartSkeleton, InvoicesSkeleton } from "./skeletons";
import { formatActivity, greetingForHour, relativeTime } from "@/lib/admin/activity";
import { clinicDateLabel, clinicHour, clinicToday } from "@/lib/date-range";
import { sumPaise } from "@/lib/dashboard/summary";
import { ActivityFeed, type ActivityItem } from "./activity-feed";

export const metadata: Metadata = {
  title: "Admin - Life Line Hospital",
};

// Admin home dashboard. Server component: gates the role (§8) and reads live
// counts + audit activity, so every number on screen is real, never a mock
// (§5, honest system state). Display only - no business logic here. The activity
// rows are pre-formatted here (text/tone/time) and handed to the client feed,
// which only toggles visibility + refreshes (see activity-feed.tsx).
//
// STREAMING (§1, the counter must feel instant): the greeting + shell are rendered
// from one cheap query and flushed immediately; the expensive money reads hang off
// <Suspense> so they fill in behind skeletons instead of holding the whole page
// blank. Everything below a boundary must therefore do its own awaiting - do not
// hoist those queries back up here "to parallelise them", or the page blocks again.

// The all-time revenue chart, behind its own Suspense boundary: it is the widest scan
// on the page (every bill this location ever issued), so it must never gate first paint.
async function AllTimeRevenue({ locationId }: { locationId: string }) {
  const clinicDay = clinicToday();
  // The floor comes from the DATA, never a literal. A hardcoded start date silently
  // truncates history under a chart still labelled "all time" - and the ~174k migrated
  // Access rows all predate any date we would have picked.
  const firstDay = await getFirstRevenueDay(locationId);
  if (!firstDay) {
    return <RevenueChart data={[]} title="Total revenue (all time)" total={0} />;
  }
  // The all-time doctors' cut rides along so the card can show the split: gross
  // revenue, less doctors' share, hospital net. The subtraction happens HERE on the
  // server (the chart only renders what it is given), and the share is informational -
  // it is inside the gross figure, not a second movement of money (lib/doctors/share.ts).
  const [rows, doctorSharePaise] = await Promise.all([
    getRevenueByDay(firstDay, clinicDay, locationId),
    getDoctorShareTotal(firstDay, clinicDay, locationId),
  ]);
  const total = sumPaise(rows.map((r) => r.paise));
  return (
    <RevenueChart
      data={rows}
      title="Total revenue (all time)"
      total={total}
      doctorSharePaise={doctorSharePaise}
      hospitalNetPaise={total - doctorSharePaise}
    />
  );
}

export default async function AdminHome() {
  const session = await requireAdmin();

  const reportCtx = await getReportContext(session.sub);
  const [name, activity] = await Promise.all([
    getUserName(session.sub),
    reportCtx ? listRecentActivity(reportCtx.locationId, 30) : Promise.resolve([]),
  ]);

  // The clinic's clock, not the server's: these sit directly beside figures computed
  // for the clinic day, and a header that disagrees with the numbers under it makes
  // both untrustworthy (§5).
  const now = new Date();
  const greeting = greetingForHour(clinicHour(now), name ?? "Admin");
  const todayDisplay = clinicDateLabel(now);

  // Pre-format each row on the server: relative time is computed with the server
  // `now` (no client date logic → no hydration drift), and the display text/tone
  // come from the canonical registry via formatActivity.
  const activityItems: ActivityItem[] = activity.map((ev) => {
    const { text, tone } = formatActivity(ev.action, ev.target_name, ev.details);
    return {
      id: ev.id,
      action: ev.action,
      text,
      tone,
      timeLabel: relativeTime(new Date(ev.at), now),
      actorName: ev.actor_name,
    };
  });

  return (
    <div className="mx-auto max-w-[1240px]">
      {/* Greeting */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {todayDisplay} · Here&apos;s what&apos;s happening across the hospital.
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Manage users
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      {/* No location = we cannot compute this admin's money. SAY SO. Rendering the
          page without these blocks would look like a designed empty state and read as
          "the hospital took nothing today" - the exact dishonesty §5 forbids. */}
      {!reportCtx ? (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-destructive/50 bg-destructive/10 p-4.5"
        >
          <p className="text-sm font-semibold text-destructive">
            Could not load your hospital&apos;s figures.
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            Your account isn&apos;t linked to a location, so revenue and patient counts
            can&apos;t be calculated. These numbers are missing, not zero. Sign in again, and
            if it persists this needs an administrator to fix the account.
          </p>
        </div>
      ) : (
        <>
          {/* Financial overview - live revenue, patients, and department split. */}
          <Suspense fallback={<CardsSkeleton />}>
            <FinancialOverview locationId={reportCtx.locationId} />
          </Suspense>

          {/* Revenue chart + the money ledger. Invoices sit beside the chart because
              this screen is about the hospital's money: what the money did is the
              headline, what staff did is context - so the activity feed follows below
              rather than competing for the same row. */}
          {/* The row TRACK is pinned to the chart's natural height (16rem plot + header
              + padding) so both cards are exactly that tall and the ledger scrolls
              inside. It has to be `grid-rows`, not a height on this container: an auto
              row still sizes to its tallest item (30 invoices), so the cards would spill
              out of a short container instead of being constrained by it.
              Only from `lg`, where they sit side by side; stacked on a narrow screen each
              card takes the height it needs. */}
          <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_1.4fr] lg:grid-rows-[368px]">
            <Suspense fallback={<ChartSkeleton />}>
              <AllTimeRevenue locationId={reportCtx.locationId} />
            </Suspense>

            <Suspense fallback={<InvoicesSkeleton />}>
              <RecentInvoices locationId={reportCtx.locationId} />
            </Suspense>
          </div>

          {/* Recent activity - client feed: hide tags + refresh. */}
          <div className="mt-4">
            <ActivityFeed items={activityItems} />
          </div>
        </>
      )}
    </div>
  );
}
