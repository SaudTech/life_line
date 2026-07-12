import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  BedDouble,
  ChevronRight,
  ClipboardList,
  History,
  Receipt,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { getUserName } from "@/lib/users/repository";
import { getReportContext, getMoneySummary } from "@/lib/reports/repository";
import { shapeDailyReport } from "@/lib/reports/summary";
import { clinicToday, presetRange } from "@/lib/date-range";
import { formatPaise } from "@/lib/money";
import { roleTitle } from "@/lib/nav";
import { deskActionsFor, type DeskGroup } from "@/lib/desk/actions";
import { greetingForHour } from "@/lib/admin/activity";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Counter - Life Line Hospital",
};

// Icon key (kept pure in lib/desk/actions.ts) → Lucide component, mapped only here
// at the UI edge. Every catalogue action's `icon` string must have an entry.
const ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  receipt: Receipt,
  bedDouble: BedDouble,
  clipboardList: ClipboardList,
  history: History,
  users: Users,
  barChart: BarChart3,
};

// Section headings, in tab order (Bill → Manage → Close out). A group renders only
// when it has visible actions for this user - no empty headings.
const GROUPS: { group: DeskGroup; title: string; sub: string }[] = [
  { group: "bill", title: "Bill a patient", sub: "Ring up a new visit, procedure or admission." },
  { group: "manage", title: "Manage & correct", sub: "Look up, reprint, void or re-issue." },
  { group: "closeout", title: "Close out", sub: "Reconcile and hand over your day." },
];

// Role-adaptive counter home for the desk roles (and usable by supervisor/admin if
// opened). Server component: it re-checks the role itself - the layout already
// gates /desk, but hiding UI is not security (dev-rules §8) - then renders only the
// tiles this user can actually use, driven by the pure, tested desk catalogue whose
// gates mirror each route's real server gate. Tiles are hints; every destination
// re-checks its own role, so a wrongly-shown tile still bounces. No role or userId
// ever comes from the client - only session.sub / session.role.
export default async function DeskHome() {
  const s = await requireRole(["op_desk", "op_ip_desk", "supervisor", "admin"]);

  // "Your day so far" strip - reuse the existing, tested reports layer scoped to
  // THIS user (self, never the whole hospital). No new money math: shapeDailyReport
  // derives collected total/count from the same grouped rows My day uses. Integer
  // paise throughout; formatted only for display.
  const [name, ctx] = await Promise.all([
    getUserName(s.sub),
    getReportContext(s.sub),
  ]);
  let collectedTotalPaise = 0;
  let collectedCount = 0;
  if (ctx) {
    const { dateFrom, dateTo } = presetRange("today", clinicToday());
    const money = await getMoneySummary(s.sub, dateFrom, dateTo, ctx.locationId);
    const report = shapeDailyReport([], money);
    collectedTotalPaise = report.collectedTotalPaise;
    collectedCount = report.collectedCount;
  }

  const actions = deskActionsFor({ role: s.role });
  const onlyMyDay = actions.length === 1 && actions[0].key === "my_day";

  const now = new Date();
  const greeting = greetingForHour(now.getHours(), name ?? "there");
  const today = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Global tab index across groups so Tab flows Bill → Manage → Close out and the
  // first few tiles get accessKey digits (1..9) for power users.
  let tileIndex = 0;

  return (
    <div className="mx-auto max-w-[1240px]">
      {/* Header: greeting + role + date, with the day strip on the right. */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {roleTitle(s.role)} · {today} · Bill a patient, then close out your day.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5">
          <div className="text-right">
            <div className="text-xs font-semibold text-muted-foreground">Collected today</div>
            <div className="text-lg font-bold tracking-tight tabular-nums text-foreground">
              Rs {formatPaise(collectedTotalPaise)}
            </div>
          </div>
          <div className="h-8 w-px bg-border" aria-hidden />
          <div className="text-right">
            <div className="text-xs font-semibold text-muted-foreground">Bills today</div>
            <div className="text-lg font-bold tracking-tight tabular-nums text-foreground">
              {collectedCount}
            </div>
          </div>
        </div>
      </div>

      {onlyMyDay ? (
        // Thin state (an edge/unknown role reaching the desk with no counter
        // capability): an honest explainer instead of a lonely card, never a blank
        // screen. Every full counter role - op_desk, op_ip_desk, supervisor, admin -
        // gets real tiles below.
        <div className="max-w-2xl rounded-xl border bg-card p-5">
          <p className="text-sm font-medium text-foreground">
            You can close out your day here.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You do not have counter billing access on this account. If that is not
            right, ask an administrator to check your role.
          </p>
          <DeskTile action={actions[0]} accessKey="1" className="mt-4" />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {GROUPS.map(({ group, title, sub }) => {
            const groupActions = actions.filter((a) => a.group === group);
            if (groupActions.length === 0) return null;
            return (
              <section key={group}>
                <h2 className="text-sm font-bold text-foreground">{title}</h2>
                <p className="mt-0.5 mb-3.5 text-xs font-medium text-muted-foreground">{sub}</p>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
                  {groupActions.map((action) => {
                    tileIndex += 1;
                    return (
                      <DeskTile
                        key={action.key}
                        action={action}
                        accessKey={tileIndex <= 9 ? String(tileIndex) : undefined}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A single launcher tile: icon chip + label + sub + chevron, matching the admin
// home's quick-action markup. It is a plain Link (in tab order, Enter activates
// natively) - every tile just navigates, nothing is destructive (dev-rules §5).
function DeskTile({
  action,
  accessKey,
  className,
}: {
  action: ReturnType<typeof deskActionsFor>[number];
  accessKey?: string;
  className?: string;
}) {
  const Icon = ICONS[action.icon] ?? Receipt;
  return (
    <Link
      href={action.href}
      accessKey={accessKey}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-accent hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{action.label}</span>
        <span className="block text-xs font-medium text-muted-foreground">
          {action.description}
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
