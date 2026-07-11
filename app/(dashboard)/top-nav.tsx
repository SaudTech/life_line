"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LogOut, Mail, Phone } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  initials,
  isActive,
  navItemsForRole,
  roleKicker,
  roleTitle,
} from "@/lib/nav";
import { cn } from "@/lib/utils";

// The signed-in shell's one horizontal bar (single top bar, no sidebar,
// light-only). Brand + role-aware nav on the left, notifications + the signed-in
// user on the right. The brand and the account avatar stay put; on a narrow
// screen the nav wraps to its own line so nothing clips (no horizontal scroll).
// Display only - the server still gates every route (§8); the nav merely
// reflects it.
export function TopNav({
  role,
  name,
  phone,
  email,
}: {
  role: string;
  name: string;
  phone: string | null;
  email: string | null;
}) {
  const pathname = usePathname();
  const items = navItemsForRole(role);
  const firstReal = items.find((i) => !i.disabled)?.href ?? "/";

  return (
    <header className="sticky top-0 z-40 border-b bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="mx-auto flex min-h-[62px] w-[95%] flex-wrap items-center gap-x-4 gap-y-1.5 px-[22px] py-2.5 md:flex-nowrap md:gap-5 md:py-0">
        {/* Brand - always first, always in place */}
        <Link
          href={firstReal}
          className="order-1 flex flex-none items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-[34px] items-center justify-center rounded-[9px] bg-primary text-[15px] font-bold text-primary-foreground">
            LL
          </span>
          <span className="leading-tight">
            <span className="block text-[14.5px] font-bold text-foreground">Life Line</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[1px] text-muted-foreground">
              {roleKicker(role)}
            </span>
          </span>
        </Link>

        {/* Primary nav - wraps to its own full-width line below the brand on
            narrow screens; sits inline between brand and user on md+ */}
        <nav className="order-3 flex w-full flex-wrap items-center gap-0.5 md:order-2 md:w-auto">
          {items.map((item) => {
            if (item.disabled) {
              return (
                <span
                  key={item.label}
                  aria-disabled="true"
                  title="Coming soon"
                  className="cursor-default rounded-[9px] px-3 py-2 text-[13px] font-semibold text-muted-foreground/60 select-none"
                >
                  {item.label}
                </span>
              );
            }
            const active = isActive(pathname, item.href, items);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[9px] px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/70 hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster - stays on the top line beside the brand on every width */}
        <div className="order-2 ml-auto flex flex-none items-center gap-3 md:order-3">
          {/* Notifications */}
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            className="flex size-9 items-center justify-center rounded-[9px] border border-input bg-card text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="size-4" aria-hidden />
          </button>

          {/* Signed-in user - avatar opens a basic-info popover with sign out */}
          <div className="flex items-center border-l pl-3">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={`${name} · ${roleTitle(role)}`}
                  aria-label="Account"
                  className="flex size-[34px] flex-none items-center justify-center rounded-full bg-teal-100 text-[13px] font-bold text-accent-foreground transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {initials(name)}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 gap-0 p-0">
                {/* Identity */}
                <div className="flex items-center gap-3 p-3">
                  <span className="flex size-10 flex-none items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-accent-foreground">
                    {initials(name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-foreground">
                      {name}
                    </div>
                    <div className="truncate text-[11.5px] font-medium text-muted-foreground">
                      {roleTitle(role)}
                    </div>
                  </div>
                </div>

                {/* Contact - only when we have something to show */}
                {(phone || email) && (
                  <div className="flex flex-col gap-1.5 border-t px-3 py-2.5 text-[12.5px]">
                    {phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="size-3.5 flex-none" aria-hidden />
                        <span className="truncate text-foreground">{phone}</span>
                      </div>
                    )}
                    {email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="size-3.5 flex-none" aria-hidden />
                        <span className="truncate text-foreground">{email}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Sign out */}
                <div className="border-t p-1.5">
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <LogOut className="size-4" aria-hidden />
                      Sign out
                    </button>
                  </form>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </header>
  );
}
