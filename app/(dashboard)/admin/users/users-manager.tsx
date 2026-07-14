"use client";

import { useMemo, useState } from "react";
import { usePersistentView } from "@/lib/hooks/use-persistent-view";
import Link from "next/link";
import { Plus, ArrowLeft, Search, X, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/users/schema";
import { setActiveAction } from "@/lib/users/actions";
import type { UserListRow } from "@/lib/users/repository";
import { UserCard } from "./user-card";
import { UserRow } from "./user-row";
import { EmptyTrashIllustration } from "./empty-trash-illustration";
import {
  UserFormDialog,
  ResetPasswordDialog,
  PinDialog,
  DeactivateDialog,
} from "./user-dialogs";

type DialogType = "add" | "edit" | "reset" | "pin" | "deactivate";
type DialogState = { type: DialogType; userId: string | null } | null;

// Filter options for the app-wide <Combobox> (searchable dropdown).
const ROLE_FILTER_OPTIONS: ComboboxOption[] = [
  { value: "all", label: "All roles" },
  ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
];
const STATUS_FILTER_OPTIONS: ComboboxOption[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// Client shell for the redesigned User Management screen (imported from the
// claude.ai/design system). The server page loads all users once; this holds the
// UI state - search, role/status filters, and which dialog is open - and filters
// the loaded list instantly. Mutations run in the dialogs' server actions, which
// revalidate the page so fresh `users` flow back as props.
export function UsersManager({ users }: { users: UserListRow[]; meId: string }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [layout, setLayout] = usePersistentView("view:users");

  const q = search.trim().toLowerCase();
  const filtersActive = q !== "" || roleFilter !== "all" || statusFilter !== "all";

  const visible = useMemo(
    () =>
      users.filter((u) => {
        if (roleFilter !== "all" && u.role !== roleFilter) return false;
        if (statusFilter === "active" && !u.active) return false;
        if (statusFilter === "inactive" && u.active) return false;
        if (
          q !== "" &&
          !u.name.toLowerCase().includes(q) &&
          !u.phone.includes(q) &&
          !(u.email?.toLowerCase().includes(q) ?? false)
        )
          return false;
        return true;
      }),
    [users, q, roleFilter, statusFilter],
  );

  const activeUser = dialog?.userId ? users.find((u) => u.id === dialog.userId) ?? null : null;

  // Eligible supervisors: active supervisors + admins, plus a "None" entry. Built
  // once from the loaded list (the server re-validates the choice on save).
  const supervisorOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: "No supervisor" },
      ...users
        .filter((u) => u.active && (u.role === "supervisor" || u.role === "admin"))
        .map((u) => ({ value: u.id, label: `${u.name} · ${ROLE_LABELS[u.role]}` })),
    ],
    [users],
  );

  function open(type: DialogType, userId: string | null) {
    setDialog({ type, userId });
  }
  function close() {
    setDialog(null);
  }
  function clearFilters() {
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
  }

  async function reactivate(user: UserListRow) {
    setPendingId(user.id);
    const res = await setActiveAction({ id: user.id, active: true });
    setPendingId(null);
    if (res && !res.ok) {
      toast.error(res.formError ?? "Could not reactivate the account.");
      return;
    }
    toast.success(`${user.name} reactivated`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin"
        className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">User Management</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Manage internal staff accounts, roles, and access.
          </p>
        </div>
        <Button type="button" onClick={() => open("add", null)}>
          <Plus aria-hidden />
          Add user
        </Button>
      </div>

      {/* Controls */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[210px] flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone or email"
            aria-label="Search users"
            className="w-full pl-8 pr-8"
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
        <Combobox
          options={ROLE_FILTER_OPTIONS}
          value={roleFilter}
          onChange={(v) => setRoleFilter(v as "all" | Role)}
          ariaLabel="Filter by role"
          searchPlaceholder="Search roles…"
          className="min-w-[140px] sm:w-auto"
        />
        <Combobox
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | "active" | "inactive")}
          ariaLabel="Filter by status"
          searchPlaceholder="Search status…"
          className="min-w-[140px] sm:w-auto"
        />

        {/* Card / list layout toggle. */}
        <div className="flex h-9 items-center gap-0.5 rounded-lg border bg-white p-1">
          <button
            type="button"
            aria-label="Card view"
            aria-pressed={layout === "card"}
            onClick={() => setLayout("card")}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              layout === "card" && "bg-accent text-accent-foreground",
            )}
          >
            <LayoutGrid className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              layout === "list" && "bg-accent text-accent-foreground",
            )}
          >
            <List className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-4 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Showing <b className="text-secondary-foreground">{visible.length}</b> of {users.length} accounts
        </span>
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
            Clear filters
          </button>
        ) : null}
      </div>

      {/* Grid, list, or empty state */}
      {visible.length > 0 ? (
        layout === "card" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(288px,1fr))] gap-3.5">
            {visible.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                statusPending={pendingId === u.id}
                onEdit={() => open("edit", u.id)}
                onReset={() => open("reset", u.id)}
                onPin={() => open("pin", u.id)}
                onStatus={() => (u.active ? open("deactivate", u.id) : reactivate(u))}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-md border">
            {visible.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                statusPending={pendingId === u.id}
                onEdit={() => open("edit", u.id)}
                onReset={() => open("reset", u.id)}
                onPin={() => open("pin", u.id)}
                onStatus={() => (u.active ? open("deactivate", u.id) : reactivate(u))}
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
          <EmptyTrashIllustration className="size-24" />
          <div>
            <p className="text-base font-semibold text-foreground">
              {filtersActive ? "No accounts match your filters" : "No users yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
              {filtersActive
                ? "Try adjusting your search or clearing filters to see more staff accounts."
                : "Add your first staff account to get started."}
            </p>
          </div>
          {filtersActive ? (
            <Button type="button" variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : (
            <Button type="button" onClick={() => open("add", null)}>
              <Plus aria-hidden />
              Add user
            </Button>
          )}
        </div>
      )}

      {/* Dialogs */}
      {dialog?.type === "add" ? (
        <UserFormDialog mode="add" user={null} supervisorOptions={supervisorOptions} onClose={close} onCreated={close} />
      ) : null}
      {dialog?.type === "edit" && activeUser ? (
        <UserFormDialog mode="edit" user={activeUser} supervisorOptions={supervisorOptions} onClose={close} onCreated={close} />
      ) : null}
      {dialog?.type === "reset" && activeUser ? (
        <ResetPasswordDialog user={activeUser} onClose={close} />
      ) : null}
      {dialog?.type === "pin" && activeUser ? (
        <PinDialog user={activeUser} onClose={close} />
      ) : null}
      {dialog?.type === "deactivate" && activeUser ? (
        <DeactivateDialog user={activeUser} onClose={close} />
      ) : null}
    </div>
  );
}
