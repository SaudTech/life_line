"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, Mail, Menu, Phone, UserRound } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";
import { ChangePasswordDialog } from "./change-password-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  initials,
  isActive,
  navItemsForRole,
  roleKicker,
  roleTitle,
  type NavItem,
} from "@/lib/nav";
import { cn } from "@/lib/utils";

const NAV_GAP_PX = 2; // matches the nav row's gap-0.5

// Figures out, given the pixel widths of each nav link (in order) and the
// "More links" trigger, how many links fit in `available` px before the rest
// need to move into the overflow menu. Pure so it's easy to reason about/test
// independent of ResizeObserver plumbing.
function countVisibleNavItems(
  available: number,
  itemWidths: number[],
  moreWidth: number,
): number {
  const totalWidth =
    itemWidths.reduce((sum, w) => sum + w, 0) +
    NAV_GAP_PX * Math.max(0, itemWidths.length - 1);
  if (totalWidth <= available) return itemWidths.length;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < itemWidths.length; i++) {
    const next = sum + itemWidths[i] + (i > 0 ? NAV_GAP_PX : 0);
    if (next + NAV_GAP_PX + moreWidth > available) break;
    sum = next;
    count = i + 1;
  }
  return count;
}

// The signed-in shell's one horizontal bar (single top bar, no sidebar,
// light-only). Brand + role-aware nav on the left, the signed-in user on the
// right. The bar stays a single line at every width - below md the
// primary nav collapses behind a hamburger button that opens the same links in
// a slide-out sheet, so nothing wraps or clips on a phone.
// Display only - the server still gates every route (§8); the nav merely
// reflects it.
export function TopNav({
  role,
  name,
  phone,
  email,
  supervisorName,
}: {
  role: string;
  name: string;
  phone: string | null;
  email: string | null;
  supervisorName: string | null;
}) {
  const pathname = usePathname();
  const items = navItemsForRole(role);
  // The brand links to this role's first nav item - its landing page. "/" only
  // when the role has no links at all (unknown role).
  const firstReal = items[0]?.href ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);

  // Account popover + the self-service "Change password" dialog it opens. The
  // popover is controlled so choosing the action closes it cleanly before the
  // dialog takes focus (otherwise both stay open, stacked).
  const [accountOpen, setAccountOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  // Overflow ("More links") for md+ widths where the hamburger is hidden but
  // the bar is still too narrow to lay out every item on one line. A hidden
  // measuring row (same classes, off-screen) gives real pixel widths; a
  // ResizeObserver on the visible nav re-measures whenever the bar's
  // available width changes (window resize, right-cluster growth, etc).
  const navContainerRef = useRef<HTMLDivElement>(null);
  const measureRowRef = useRef<HTMLDivElement>(null);
  const moreButtonMeasureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recomputeOverflow = () => {
    const container = navContainerRef.current;
    const measureRow = measureRowRef.current;
    const moreButton = moreButtonMeasureRef.current;
    if (!container || !measureRow || !moreButton) return;
    const itemWidths = Array.from(measureRow.children).map(
      (el) => el.getBoundingClientRect().width,
    );
    const moreWidth = moreButton.getBoundingClientRect().width;
    setVisibleCount(
      countVisibleNavItems(container.clientWidth, itemWidths, moreWidth),
    );
  };

  useLayoutEffect(() => {
    recomputeOverflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    const container = navContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => recomputeOverflow());
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const openMoreNow = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setMoreOpen(true);
  };
  const scheduleMoreClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setMoreOpen(false), 150);
  };

  const visibleItems = items.slice(0, visibleCount);
  const overflowItems = items.slice(visibleCount);
  const overflowHasActive = overflowItems.some((item) =>
    isActive(pathname, item.href, items),
  );

  const navLink = (item: NavItem, onNavigate?: () => void) => {
    const active = isActive(pathname, item.href, items);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
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
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="mx-auto flex min-h-[56px] w-[95%] items-center gap-3 px-4 py-2 sm:min-h-[62px] sm:px-[22px] sm:py-2.5 md:gap-5 md:py-0">
        {/* Hamburger - phone/tablet only, opens the nav sheet */}
        <button
          type="button"
          title="Menu"
          aria-label="Open navigation menu"
          onClick={() => setMenuOpen(true)}
          className="flex size-9 flex-none items-center justify-center rounded-[9px] border border-input bg-card text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Menu className="size-4.5" aria-hidden />
        </button>

        {/* Brand - always first, always in place */}
        <Link
          href={firstReal}
          className="flex min-w-0 flex-none items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Image
            src="/logo.png"
            alt="Life Line"
            width={34}
            height={34}
            priority
            className="size-[34px] flex-none object-contain"
          />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[14.5px] font-bold text-foreground">Life Line</span>
            <span className="block truncate text-[10px] font-semibold uppercase tracking-[1px] text-muted-foreground">
              {roleKicker(role)}
            </span>
          </span>
        </Link>

        {/* Primary nav - inline between brand and user from md up; hidden on
            phone/tablet in favour of the hamburger sheet. Shrinks to fit the
            space left by the brand and right cluster; items that don't fit
            move into the "More links" dropdown below. */}
        <nav
          ref={navContainerRef}
          className="relative hidden min-w-0 flex-1 items-center gap-0.5 overflow-hidden md:flex"
        >
          {visibleItems.map((item) => navLink(item))}

          {overflowItems.length > 0 && (
            <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen} modal={false}>
              <div
                onMouseEnter={openMoreNow}
                onMouseLeave={scheduleMoreClose}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1 rounded-[9px] px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      overflowHasActive
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    More links
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        moreOpen && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  onMouseEnter={openMoreNow}
                  onMouseLeave={scheduleMoreClose}
                >
                  {overflowItems.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        aria-current={
                          isActive(pathname, item.href, items)
                            ? "page"
                            : undefined
                        }
                        className={cn(
                          "font-medium",
                          isActive(pathname, item.href, items) &&
                            "bg-accent text-accent-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </div>
            </DropdownMenu>
          )}

          {/* Hidden measuring row - same items, same classes, off-screen.
              Its children's rendered widths drive countVisibleNavItems(). */}
          <div
            ref={measureRowRef}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 -z-10 flex -translate-y-full items-center gap-0.5 opacity-0"
          >
            {items.map((item) => navLink(item))}
          </div>
          <div
            ref={moreButtonMeasureRef}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 -z-10 -translate-y-full opacity-0"
          >
            <button
              type="button"
              className="flex items-center gap-1 rounded-[9px] px-3 py-2 text-[13px] font-semibold"
            >
              More links
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </div>
        </nav>

        {/* Mobile nav sheet - same links, same active state */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-[78%] max-w-[300px] p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Life Line - {roleKicker(role)}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-0.5 p-2">
              {items.map((item) => navLink(item, () => setMenuOpen(false)))}
            </nav>
          </SheetContent>
        </Sheet>

        {/* Right cluster - stays on the top line beside the brand on every width */}
        <div className="ml-auto flex flex-none items-center gap-3">
          {/* Signed-in user - avatar opens a basic-info popover with sign out */}
          <div className="flex items-center border-l pl-3">
            <Popover open={accountOpen} onOpenChange={setAccountOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={`${name} · ${roleTitle(role)}`}
                  aria-label="Account"
                  className="flex size-[34px] flex-none items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {initials(name)}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 gap-0 p-0">
                {/* Identity */}
                <div className="flex items-center gap-3 p-3">
                  <span className="flex size-10 flex-none items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
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

                {/* Supervisor - who this user reports to (staff↔supervisor link) */}
                {supervisorName ? (
                  <div className="flex items-center gap-2 border-t px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    <UserRound className="size-3.5 flex-none" aria-hidden />
                    <span className="min-w-0 truncate">
                      Supervisor: <span className="font-medium text-foreground">{supervisorName}</span>
                    </span>
                  </div>
                ) : null}

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

                {/* Account actions - change own password, sign out */}
                <div className="border-t p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      setPwOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <KeyRound className="size-4" aria-hidden />
                    Change password
                  </button>
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

      {/* Self-service password change - any signed-in staff member, own account only */}
      {pwOpen ? <ChangePasswordDialog onClose={() => setPwOpen(false)} /> : null}
    </header>
  );
}
