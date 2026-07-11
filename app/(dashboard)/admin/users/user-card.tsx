"use client";

import { cn } from "@/lib/utils";
import { ROLE_LABELS, ROLE_ACCESS, PIN_ROLES, type Role } from "@/lib/users/schema";
import type { UserListRow } from "@/lib/users/repository";

// Staff-account card. One card layout (label -> value rows), carrying the account's
// role/access, phone, added date, PIN state, and the inline actions.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

interface CardProps {
  user: UserListRow;
  statusPending: boolean;
  onEdit: () => void;
  onReset: () => void;
  onPin: () => void;
  onStatus: () => void;
}

function useDerived(user: UserListRow) {
  const role = user.role as Role;
  return {
    role,
    isPinRole: PIN_ROLES.includes(role),
    isTinted: role === "supervisor" || role === "admin",
    initials: initials(user.name),
    added: DATE_FMT.format(new Date(user.created_at)),
  };
}

const cardBtn =
  "rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const pinBtn =
  "rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Actions({
  user,
  isPinRole,
  statusPending,
  onEdit,
  onReset,
  onPin,
  onStatus,
}: CardProps & { isPinRole: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={onEdit} className={cardBtn}>
        Edit
      </button>
      <button type="button" onClick={onReset} className={cardBtn}>
        Reset password
      </button>
      {isPinRole ? (
        <button type="button" onClick={onPin} className={pinBtn}>
          {user.has_pin ? "Change PIN" : "Set PIN"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onStatus}
        disabled={statusPending}
        className={cn(cardBtn, "ml-auto", user.active && "text-destructive hover:bg-destructive/10")}
      >
        {statusPending ? "…" : user.active ? "Deactivate" : "Reactivate"}
      </button>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-secondary-foreground",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold",
        active ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-destructive")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function UserCard(props: CardProps) {
  const { user } = props;
  const d = useDerived(user);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-card p-4 transition-shadow hover:shadow-sm",
        !user.active && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            d.isTinted ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground",
          )}
        >
          {d.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">{user.name}</div>
          <div className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[d.role]}</div>
        </div>
        <StatusPill active={user.active} />
      </div>

      <div className="flex flex-col gap-1.5 text-xs font-medium">
        <Row label="Access" value={ROLE_ACCESS[d.role]} />
        <Row label="Phone" value={user.phone} mono />
        <Row label="Added" value={d.added} />
      </div>

      {user.has_pin ? (
        <div className="rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary">
          Discount PIN set
        </div>
      ) : null}

      <div className="border-t pt-3">
        <Actions {...props} isPinRole={d.isPinRole} />
      </div>
    </div>
  );
}
