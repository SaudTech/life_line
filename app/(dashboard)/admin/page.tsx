import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Archive,
  ArrowRight,
  BarChart3,
  ChevronRight,
  Hash,
  KeyRound,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/dal";
import {
  getUserName,
  getUserStats,
  listRecentActivity,
} from "@/lib/users/repository";
import {
  formatActivity,
  greetingForHour,
  relativeTime,
  type Tone,
} from "@/lib/admin/activity";
import { cn } from "@/lib/utils";
import { ActivityFeed, type ActivityItem } from "./activity-feed";

export const metadata: Metadata = {
  title: "Admin - Life Line Hospital",
};

// Status tint for a stat tag. Colour is for status only (§5):
// teal = neutral/primary, green = good, amber = attention, red = inactive.
const TAG_TINT: Record<Tone, string> = {
  accent: "bg-accent text-accent-foreground",
  success: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-destructive/10 text-destructive",
};

// Common admin tasks. All live under Users today; Reports has no page yet, so it
// renders disabled rather than linking to a 404 (top-nav plan §2).
const QUICK_ACTIONS: {
  href?: string;
  icon: LucideIcon;
  label: string;
  sub: string;
}[] = [
  { href: "/admin/users", icon: UserPlus, label: "Add new user", sub: "Create a staff account" },
  { href: "/admin/doctors", icon: Stethoscope, label: "Manage doctors", sub: "Fees and revisit validity" },
  { href: "/admin/users", icon: KeyRound, label: "Reset password", sub: "Issue a temporary password" },
  { href: "/admin/users", icon: Hash, label: "Set discount PIN", sub: "Supervisor approval authority" },
  { href: "/reports", icon: BarChart3, label: "Reports", sub: "Hospital day-close totals" },
];

// Admin home dashboard. Server component: gates the role (§8) and reads live
// counts + audit activity, so every number on screen is real, never a mock
// (§5, honest system state). Display only - no business logic here. The activity
// rows are pre-formatted here (text/tone/time) and handed to the client feed,
// which only toggles visibility + refreshes (see activity-feed.tsx).
export default async function AdminHome() {
  const session = await requireAdmin();
  const [name, stats, activity] = await Promise.all([
    getUserName(session.sub),
    getUserStats(),
    // Fetch a wider window than the 6 shown before, so the per-tag hide filter
    // has enough to work with.
    listRecentActivity(30),
  ]);

  const now = new Date();
  const greeting = greetingForHour(now.getHours(), name ?? "Admin");
  const today = now.toLocaleDateString("en-US", {
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

  const tiles: {
    label: string;
    value: number;
    sub: string;
    tone: Tone;
    icon: LucideIcon;
  }[] = [
    { label: "Total staff", value: stats.total, sub: "all staff accounts", tone: "accent", icon: Users },
    { label: "Active", value: stats.active, sub: "can sign in", tone: "success", icon: Activity },
    { label: "Supervisors", value: stats.supervisors, sub: "discount authority", tone: "accent", icon: ShieldCheck },
    { label: "Deactivated", value: stats.archived, sub: "deactivated accounts", tone: "danger", icon: Archive },
  ];

  return (
    <div className="mx-auto max-w-[1240px]">
      {/* Greeting */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {today} · Here&apos;s what&apos;s happening across the hospital.
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

      {/* Stat tiles */}
      <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border bg-card p-4.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{tile.label}</span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg",
                  TAG_TINT[tile.tone],
                )}
              >
                <tile.icon className="size-4" aria-hidden />
              </span>
            </div>
            <div className="mt-2.5 text-3xl font-bold tracking-tight tabular-nums text-foreground">
              {tile.value}
            </div>
            <div className="mt-0.5 text-xs font-medium text-muted-foreground">{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick actions + Recent activity */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        {/* Quick actions */}
        <section className="rounded-xl border bg-card p-4.5">
          <h2 className="text-sm font-bold text-foreground">Quick actions</h2>
          <p className="mt-0.5 mb-3.5 text-xs font-medium text-muted-foreground">
            Jump into common admin tasks.
          </p>
          <div className="flex flex-col gap-2.5">
            {QUICK_ACTIONS.map((action) => {
              const inner = (
                <>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <action.icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{action.label}</span>
                    <span className="block text-xs font-medium text-muted-foreground">{action.sub}</span>
                  </span>
                </>
              );
              return action.href ? (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-accent hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {inner}
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              ) : (
                <div
                  key={action.label}
                  className="flex items-center gap-3 rounded-lg border border-dashed p-3 opacity-70"
                  aria-disabled="true"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </section>

        {/* Recent activity - client feed: hide tags + refresh. */}
        <ActivityFeed items={activityItems} />
      </div>
    </div>
  );
}
