"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, RefreshCw, SlidersHorizontal } from "lucide-react";
import { activityMeta, type Tone } from "@/lib/activity/actions";
import { cn } from "@/lib/utils";

// The admin "Recent activity" feed. Client component so it can do two purely-
// presentational things the server can't: (1) let the admin HIDE activity tags
// they don't want to see, and (2) refresh the feed on demand. It contains NO
// business logic - every row arrives already formatted from the server
// (text/tone/time), and "hide" is view-only visibility (localStorage), never a
// delete. The activity log is append-only (DEVELOPMENT_RULES §4/§8); nothing here
// mutates it.

// One row, pre-formatted on the server so the client stays logic-free.
export interface ActivityItem {
  id: string;
  action: string; // canonical tag - used for the per-tag hide filter
  text: string; // display line, e.g. "Signed in - Saud"
  tone: Tone;
  timeLabel: string; // e.g. "2 hours ago" (computed server-side, no hydration drift)
  actorName: string | null;
}

// Status dot colour - colour is for status only (§5).
const DOT_TINT: Record<Tone, string> = {
  accent: "bg-primary",
  success: "bg-green-600",
  warning: "bg-amber-600",
  danger: "bg-destructive",
};

const STORAGE_KEY = "admin.activity.hiddenTags";

// Ties the Filter button's aria-expanded to the panel it actually expands, so a
// screen reader announces what opened. Static: only one feed renders per page.
const FILTER_PANEL_ID = "activity-filter-panel";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [showFilters, setShowFilters] = useState(false);

  // Hidden tags persist across refreshes/sessions. Start empty (matches the
  // server render), then hydrate from localStorage after mount to avoid a
  // hydration mismatch.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore corrupt/absent storage - just start with nothing hidden
    }
  }, []);

  function persist(next: Set<string>) {
    setHidden(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // storage may be unavailable (private mode) - filtering still works in-memory
    }
  }

  function toggleTag(action: string) {
    const next = new Set(hidden);
    if (next.has(action)) next.delete(action);
    else next.add(action);
    persist(next);
  }

  // The distinct tags present in the loaded feed - the set the admin can hide.
  // Sorted by label for a stable, predictable list (muscle memory, §5).
  const tags = useMemo(() => {
    const seen = new Map<string, { action: string; label: string; count: number }>();
    for (const it of items) {
      const existing = seen.get(it.action);
      if (existing) existing.count += 1;
      else seen.set(it.action, { action: it.action, label: activityMeta(it.action).label, count: 1 });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const visible = items.filter((it) => !hidden.has(it.action));
  const hiddenCount = hidden.size;

  return (
    <section className="rounded-xl border bg-card p-4.5">
      {/* Header: title + filter toggle + refresh */}
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">Recent activity</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls={FILTER_PANEL_ID}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showFilters || hiddenCount > 0
                ? "border-accent bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Filter
            {hiddenCount > 0 && (
              <span className="rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums text-foreground">
                {hiddenCount} hidden
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={isRefreshing}
            aria-label="Refresh activity"
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {/* Tag filters - toggle which activity types are visible. */}
      {showFilters && (
        <div id={FILTER_PANEL_ID} className="mb-3.5 rounded-lg border border-dashed bg-muted/30 p-3">
          {tags.length === 0 ? (
            <p className="text-xs font-medium text-muted-foreground">No activity types to filter yet.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Show these activity types
                </span>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => persist(new Set())}
                    className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Show all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const isHidden = hidden.has(t.action);
                  return (
                    <button
                      key={t.action}
                      type="button"
                      onClick={() => toggleTag(t.action)}
                      aria-pressed={!isHidden}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isHidden
                          ? "border-border bg-transparent text-muted-foreground line-through decoration-1"
                          : "border-accent bg-accent text-accent-foreground",
                      )}
                    >
                      {isHidden ? (
                        <EyeOff className="size-3 shrink-0 no-underline" aria-hidden />
                      ) : (
                        <Eye className="size-3 shrink-0" aria-hidden />
                      )}
                      <span>{t.label}</span>
                      <span className="tabular-nums opacity-70">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* The feed */}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : visible.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">All activity types are hidden.</p>
          <button
            type="button"
            onClick={() => persist(new Set())}
            className="mt-1.5 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show all
          </button>
        </div>
      ) : (
        <ul className="flex max-h-[420px] flex-col overflow-y-auto">
          {visible.map((ev) => (
            <li key={ev.id} className="flex gap-3 border-t border-border/60 py-3 first:border-t-0">
              <span
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_TINT[ev.tone])}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">{ev.text}</div>
                <div className="mt-0.5 text-xs font-medium text-muted-foreground">
                  {ev.timeLabel}
                  {ev.actorName ? ` · by ${ev.actorName}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
