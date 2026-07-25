"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  Pencil,
  Search,
  Syringe,
  Trash2,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import {
  setServiceActiveAction,
  setServiceTrashedAction,
} from "@/lib/services/actions";
import { SERVICE_RETENTION_DAYS } from "@/lib/services/schema";
import type { ServiceRow } from "@/lib/services/repository";
import { ServiceFormDialog } from "./service-form-dialog";

type DialogState = { type: "add" | "edit"; serviceId: string | null } | null;
type View = "active" | "archived";

// A service plus its server-resolved purge countdown. The countdown is computed
// on the server page (one clock, no hydration drift) - this screen only displays
// it.
export type ServiceItem = ServiceRow & { trashDaysLeft: number };

// How the countdown reads on screen. Visible text, not a tooltip: it's the only
// warning before a service is destroyed for good, so it must reach a screen
// reader and survive a keyboard-only pass (§5).
function purgeLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Deletes today";
  return `Deletes in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
}

// Billable on/off switch (the `active` axis). A real switch (role, aria-checked),
// keyboard-operable, so status is changed without the mouse.
function BillableSwitch({
  active,
  name,
  disabled,
  onToggle,
}: {
  active: boolean;
  name: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${active ? "Deactivate" : "Activate"} ${name}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        active ? "bg-green-600" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow transition-transform",
          active ? "translate-x-4" : "translate-x-0.5",
        )}
        aria-hidden
      />
    </button>
  );
}

// Shared table for both views. `mode` decides the Status cell and the row actions:
// live services get a billable switch + Edit + Trash; archived (trashed) ones get
// the "deletes in N days" countdown + Restore.
function ServicesTable({
  services,
  mode,
  pendingId,
  onEdit,
  onToggleActive,
  onToggleTrashed,
}: {
  services: ServiceItem[];
  mode: View;
  pendingId: string | null;
  onEdit: (id: string) => void;
  onToggleActive: (service: ServiceItem) => void;
  onToggleTrashed: (service: ServiceItem) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* [contain:layout]: a table wider than this scroller leaks its min-content
          into the document's scroll area (Chromium quirk) - the page itself would
          pan sideways on phones even though the table scrolls in here. */}
      <div className="overflow-x-auto [contain:layout]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="px-4 py-3 font-semibold text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                Price
              </th>
              <th className="px-4 py-3 font-semibold text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr
                key={s.id}
                className={cn(
                  "border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30",
                  mode === "active" && !s.active && "opacity-70",
                  mode === "archived" && "opacity-70",
                )}
              >
                <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                  ₹{formatPaise(s.price_paise)}
                </td>
                <td className="px-4 py-3">
                  {mode === "active" ? (
                    <div className="flex items-center gap-2">
                      <BillableSwitch
                        active={s.active}
                        name={s.name}
                        disabled={pendingId === s.id}
                        onToggle={() => onToggleActive(s)}
                      />
                      <span
                        className={cn(
                          "w-14 text-xs font-semibold",
                          s.active ? "text-green-700" : "text-muted-foreground",
                        )}
                      >
                        {s.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        <Trash2 className="size-3" aria-hidden />
                        {purgeLabel(s.trashDaysLeft)}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Gone for good after that. Restore to keep it.
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {mode === "active" ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onEdit(s.id)}
                        >
                          <Pencil aria-hidden />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Move ${s.name} to Trash`}
                          title={`Move to Trash (auto-deletes in ${SERVICE_RETENTION_DAYS} days)`}
                          disabled={pendingId === s.id}
                          onClick={() => onToggleTrashed(s)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-green-700 hover:bg-green-100 hover:text-green-800"
                        disabled={pendingId === s.id}
                        onClick={() => onToggleTrashed(s)}
                      >
                        <RotateCcw aria-hidden />
                        {pendingId === s.id ? "Saving…" : "Restore"}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Client shell for the Services master list. The server page loads every service
// once; this partitions them into the live catalog (default view, both Active and
// Inactive) and the Trash (archived view, reachable by a link). Status has two
// independent axes: `active` (billable on/off, kept) and Trash (deletes in 7 days).
// Mutations run in the server actions, which revalidate so fresh props flow back.
export function ServicesManager({ services }: { services: ServiceItem[] }) {
  const [view, setView] = useState<View>("active");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  // Optimistic view of the catalog: flipping a service's billable switch updates
  // the screen INSTANTLY (before the server responds), so status feels immediate at
  // the counter (§1). React reconciles this back to the real props when the action's
  // revalidation lands - and auto-reverts to the true value if the action errors.
  const [optimisticServices, applyOptimisticActive] = useOptimistic(
    services,
    (state, update: { id: string; active: boolean }) =>
      state.map((s) => (s.id === update.id ? { ...s, active: update.active } : s)),
  );

  const catalog = optimisticServices.filter((s) => !s.trashed_at);
  const archived = optimisticServices.filter((s) => s.trashed_at);

  // Name search over the live catalog only (the catalog is small and fully
  // preloaded, so this filters in memory rather than round-tripping to the
  // server - unlike the paginated history lists). The Trash view is a
  // secondary drill-down and isn't searched.
  const q = search.trim().toLowerCase();
  const visibleCatalog = useMemo(
    () => (q === "" ? catalog : catalog.filter((s) => s.name.toLowerCase().includes(q))),
    [catalog, q],
  );

  const activeService =
    dialog?.serviceId ? services.find((s) => s.id === dialog.serviceId) ?? null : null;

  function toggleActive(service: ServiceItem) {
    const next = !service.active;
    // Flip the switch now; the server call runs inside the same transition so the
    // optimistic value holds until the real props (or an error revert) arrive.
    startTransition(async () => {
      applyOptimisticActive({ id: service.id, active: next });
      const res = await setServiceActiveAction({ id: service.id, active: next });
      if (res && !res.ok) {
        toast.error(res.formError ?? "Could not update the service.");
        return; // optimistic value reverts to the real (unchanged) prop
      }
      toast.success(next ? `${service.name} is now billable` : `${service.name} set inactive`);
    });
  }

  async function toggleTrashed(service: ServiceItem) {
    const next = !service.trashed_at; // trash if not trashed; restore if trashed
    setPendingId(service.id);
    const res = await setServiceTrashedAction({ id: service.id, trashed: next });
    setPendingId(null);
    if (res && !res.ok) {
      toast.error(res.formError ?? "Could not update the service.");
      return;
    }
    toast.success(
      next
        ? `${service.name} moved to Trash - deletes in ${SERVICE_RETENTION_DAYS} days`
        : `${service.name} restored`,
    );
  }

  // ── Archived (Trash) view ──────────────────────────────────────────────────
  if (view === "archived") {
    return (
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => setView("active")}
          className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to services
        </button>

        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Archived services
          </h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            These were trashed and will be{" "}
            <span className="font-semibold text-amber-700">permanently deleted</span> after{" "}
            {SERVICE_RETENTION_DAYS} days. Restore any one to keep it.
          </p>
        </div>

        {archived.length > 0 ? (
          <ServicesTable
            services={archived}
            mode="archived"
            pendingId={pendingId}
            onEdit={() => {}}
            onToggleActive={() => {}}
            onToggleTrashed={toggleTrashed}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Trash2 className="size-7" aria-hidden />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">Trash is empty</p>
              <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
                Nothing is scheduled for deletion.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setView("active")}>
              <ArrowLeft aria-hidden />
              Back to services
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Active (live catalog) view ─────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin"
        className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Admin
      </Link>

      {/* Sticky header block: title/add, Trash link, search and result count all
          stay in view while the table below scrolls - the counter reference point
          (how many services, what's filtered) shouldn't disappear off-screen.
          Offsets sit just under the sticky TopNav (56px / 62px) and sit one z-level
          under it (z-30 < nav's z-40) so the nav still layers on top while scrolling. */}
      <div className="sticky top-14 z-30 bg-background sm:top-[62px]">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Services</h1>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              Billable procedures and items - injections, IV, dressings and more.
            </p>
          </div>
          <Button type="button" onClick={() => setDialog({ type: "add", serviceId: null })}>
            <Plus aria-hidden />
            Add service
          </Button>
        </div>

        {/* Trash link - only when something is archived and counting down. */}
        {archived.length > 0 ? (
          <button
            type="button"
            onClick={() => setView("archived")}
            className="mb-3.5 inline-flex w-fit items-center gap-1.5 rounded text-xs font-semibold text-amber-700 transition-colors hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-3.5 shrink-0" aria-hidden />
            {archived.length} archived {archived.length === 1 ? "item" : "items"} - deleting soon
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          </button>
        ) : null}

        {catalog.length > 0 ? (
          <div className="relative mb-3.5">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              aria-label="Search services"
              className="pl-9 pr-8"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

        {catalog.length > 0 ? (
          <div className="flex items-center justify-between pb-3.5 text-xs font-medium text-muted-foreground">
            <span>
              Showing <b className="text-secondary-foreground">{visibleCatalog.length}</b> of {catalog.length} services
            </span>
            {q ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden />
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {visibleCatalog.length > 0 ? (
        <ServicesTable
          services={visibleCatalog}
          mode="active"
          pendingId={pendingId}
          onEdit={(id) => setDialog({ type: "edit", serviceId: id })}
          onToggleActive={toggleActive}
          onToggleTrashed={toggleTrashed}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Syringe className="size-7" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {q
                ? "No services found"
                : archived.length > 0
                  ? "No active services"
                  : "No services yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
              {q
                ? "No service matches that search."
                : archived.length > 0
                  ? "Every service is in Trash. Add a new one, or restore one from the archive."
                  : "Add your first service to start billing procedures."}
            </p>
          </div>
          {q ? (
            <Button type="button" variant="outline" onClick={() => setSearch("")}>
              Clear filters
            </Button>
          ) : (
            <Button type="button" onClick={() => setDialog({ type: "add", serviceId: null })}>
              <Plus aria-hidden />
              Add service
            </Button>
          )}
        </div>
      )}

      {dialog?.type === "add" ? (
        <ServiceFormDialog mode="add" service={null} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.type === "edit" && activeService ? (
        <ServiceFormDialog mode="edit" service={activeService} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
