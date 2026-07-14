import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  ChevronRight,
  Lock,
  ReceiptText,
  Users,
  UsersRound,
} from "lucide-react";

import { requireRole } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { getSupervisorTeam, type TeamMemberRow } from "@/lib/team/repository";
import { clinicToday } from "@/lib/date-range";
import { formatPaise } from "@/lib/money";
import { ROLE_LABELS } from "@/lib/users/schema";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Supervisor - Life Line Hospital",
};

// Supervisor home. Two parts: the supervisor's TEAM (the staff assigned to them
// via users.supervisor_id) with at-a-glance figures for today, and their own
// daily report. Every figure is server-computed for the current clinic day and
// scoped to the supervisor's location - a supervisor sees only their own people.
export default async function SupervisorHome() {
  const session = await requireRole(["supervisor", "admin"]);
  const locationId = await getUserLocationId(session.sub);
  const today = clinicToday();
  const team = locationId ? await getSupervisorTeam(session.sub, locationId, today) : [];

  const activeCount = team.filter((m) => m.active).length;
  const collectedPaise = team.reduce((sum, m) => sum + Number(m.collected_paise), 0);
  const billCount = team.reduce((sum, m) => sum + m.bill_count, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My team</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            The staff you supervise, and what they have done today.
          </p>
        </div>
        <Button href="/reports" icon={<BarChart3 className="size-4" aria-hidden />}>
          My day
        </Button>
      </div>

      {team.length === 0 ? (
        <EmptyTeam />
      ) : (
        <>
          {/* Summary strip */}
          <div className="mt-5 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <SummaryTile
              icon={<Users className="size-4" aria-hidden />}
              label="Staff supervised"
              value={String(team.length)}
              note={`${activeCount} active`}
            />
            <SummaryTile
              icon={<ReceiptText className="size-4" aria-hidden />}
              label="Bills today"
              value={String(billCount)}
              note={billCount > 0 ? "view all →" : "across your team"}
              href={billCount > 0 ? "/supervisor/bills" : undefined}
            />
            <SummaryTile
              icon={<Activity className="size-4" aria-hidden />}
              label="Collected today"
              value={`₹${formatPaise(collectedPaise)}`}
              note="team total"
              accent
            />
          </div>

          {/* Team members */}
          <h2 className="mb-3 mt-8 text-sm font-bold text-foreground">
            Team ({team.length})
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(288px,1fr))] gap-3.5">
            {team.map((m) => (
              <TeamCard key={m.id} member={m} />
            ))}
          </div>
        </>
      )}

      {/* Own daily report */}
      <h2 className="mb-3 mt-8 text-sm font-bold text-foreground">Close out your day</h2>
      <Link
        href="/reports"
        className="group flex max-w-md items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-accent hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

// A link styled as the primary button (server component - no client Button here).
function Button({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      {children}
    </Link>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  note,
  accent,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  accent?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
          accent ? "text-accent-foreground/80" : "text-muted-foreground",
        )}
      >
        {icon}
        {label}
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums", accent ? "text-accent-foreground" : "text-foreground")}>
        {value}
      </div>
      <div
        className={cn(
          "mt-0.5 text-xs font-medium",
          href ? "text-primary" : accent ? "text-accent-foreground/70" : "text-muted-foreground",
        )}
      >
        {note}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={cn("rounded-xl border bg-card p-4", accent && "border-primary/20 bg-accent")}>{body}</div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function TeamCard({ member }: { member: TeamMemberRow }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-md border bg-card p-4", !member.active && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
        >
          {initials(member.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">{member.name}</div>
          <div className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[member.role]}</div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold",
            member.active ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
          )}
        >
          <span className={cn("size-1.5 rounded-full", member.active ? "bg-primary" : "bg-destructive")} />
          {member.active ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 text-xs font-medium">
        <Row label="Phone" value={member.phone} mono />
        <Row label="Collected today" value={`₹${formatPaise(member.collected_paise)}`} />
        <Row label="Bills today" value={String(member.bill_count)} />
        <Row label="Actions today" value={String(member.action_count)} />
      </div>

      {member.has_pin ? (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          <Lock className="size-3" aria-hidden />
          Discount PIN set
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right text-secondary-foreground", mono && "font-mono tabular-nums")}>
        {value}
      </span>
    </div>
  );
}

function EmptyTeam() {
  return (
    <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <UsersRound className="size-7" aria-hidden />
      </span>
      <div>
        <p className="text-base font-semibold text-foreground">No staff assigned to you yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm font-medium text-muted-foreground">
          An admin assigns staff to a supervisor from User Management. Once assigned, your
          team and their daily activity show up here.
        </p>
      </div>
    </div>
  );
}
