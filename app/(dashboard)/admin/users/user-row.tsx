"use client";

import { cn } from "@/lib/utils";
import { ROLE_LABELS, ROLE_ACCESS, PIN_ROLES, type Role } from "@/lib/users/schema";
import { Actions, StatusPill, useDerived, type CardProps } from "./user-card";

// Staff-account list row - the same data as <UserCard>, laid out as one dense line
// per account so an admin can scan many accounts at once. Shares its derived data
// and actions with the card view (./user-card) so switching layout never drifts
// the two views apart.
//
// Every field gets a FIXED width (not flex-basis/flex-wrap) and the PIN badge slot
// is always reserved (rendered invisible when absent, never unmounted) - otherwise
// rows whose content differs in length or presence (a long name, a missing PIN
// badge) push the trailing Status/Actions to a different x-position per row, which
// reads as "the buttons keep moving." Fixed widths + no wrap keep every column,
// including Actions, aligned down the whole list.

export function UserRow(props: CardProps) {
  const { user } = props;
  const d = useDerived(user);

  return (
    <div
      className={cn(
        "flex flex-nowrap items-center gap-4 overflow-x-auto bg-card px-4 py-3 transition-colors hover:bg-primary/5",
        !user.active && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          d.isTinted ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground",
        )}
      >
        {d.initials}
      </span>

      <div className="w-[200px] shrink-0">
        <div className="truncate font-semibold text-foreground">{user.name}</div>
        <div className="truncate text-xs font-medium text-muted-foreground">{ROLE_LABELS[d.role as Role]}</div>
      </div>

      <div className="hidden w-[170px] shrink-0 truncate text-xs font-medium text-muted-foreground sm:block">
        {ROLE_ACCESS[d.role as Role]}
      </div>

      <div className="hidden w-[110px] shrink-0 truncate font-mono text-xs tabular-nums text-secondary-foreground md:block">
        {user.phone}
      </div>

      <div className="hidden w-[90px] shrink-0 text-xs text-muted-foreground lg:block">{d.added}</div>

      {/* PIN slot is always reserved (fixed width, invisible when unset) so it
          never shifts the columns after it. */}
      <span
        aria-hidden={!user.has_pin}
        className={cn(
          "hidden w-[68px] shrink-0 rounded-md bg-primary/10 px-2 py-1 text-center text-[11px] font-semibold text-primary xl:block",
          !user.has_pin && "invisible",
        )}
      >
        PIN set
      </span>

      <div className="w-[84px] shrink-0">
        <StatusPill active={user.active} />
      </div>

      <div className="ml-auto shrink-0">
        <Actions {...props} isPinRole={PIN_ROLES.includes(d.role as Role)} />
      </div>
    </div>
  );
}
