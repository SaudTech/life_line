import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth/dal";
import {
  getUserName,
  getUserStats,
  listRecentActivity,
} from "@/lib/users/repository";
import { getReportContext } from "@/lib/reports/repository";
import { getRevenueByDay } from "@/lib/dashboard/repository";
import { FinancialOverview } from "./financial-overview";
import { RevenueChart } from "./revenue-chart";
import {
  formatActivity,
  greetingForHour,
  relativeTime,
  type Tone,
} from "@/lib/admin/activity";
import { clinicToday } from "@/lib/date-range";
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
export default async function AdminHome() {
  const session = await requireAdmin();
  const clinicDay = clinicToday();

  const reportCtx = await getReportContext(session.sub);
  const [name, activity, revenueAllTime] = await Promise.all([
    getUserName(session.sub),
    listRecentActivity(30),
    reportCtx ? getRevenueByDay("2026-01-01", clinicDay, reportCtx.locationId) : Promise.resolve([]),
  ]);

  const now = new Date();
  const greeting = greetingForHour(now.getHours(), name ?? "Admin");
  const todayDisplay = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

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

      {/* Financial overview - live revenue, patients, and department split for the
          admin's location. Skipped only if the viewer row is somehow gone. */}
      {reportCtx && <FinancialOverview locationId={reportCtx.locationId} />}

      {/* Revenue chart + Recent activity */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        {/* All time revenue chart */}
        {reportCtx && (
          <RevenueChart
            data={revenueAllTime}
            title="Total revenue (all time)"
            total={sumPaise(revenueAllTime.map((r) => r.paise))}
          />
        )}

        {/* Recent activity - client feed: hide tags + refresh. */}
        <ActivityFeed items={activityItems} />
      </div>
    </div>
  );
}
