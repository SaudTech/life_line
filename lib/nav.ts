import type { Role } from "@/lib/users/schema";

// PURE, client-safe nav config (plan §5). No "use server", no DB, no next/*
// imports - imported by the client <TopNav> and unit-tested directly. One source
// of truth for "which links does this role see" and "which one is active".

export interface NavItem {
  href: string;
  label: string;
  // Shown in the bar but not yet a real page. Rendered muted and non-clickable
  // so the nav matches the intended shape without ever linking to a 404 (§2).
  disabled?: boolean;
}

// Only /admin and /admin/users are real today; the rest are visible placeholders
// (disabled) so the bar reads as the finished product. Flip `disabled` and point
// `href` at the route as each page lands.
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/doctors", label: "Doctors" },
    { href: "/admin/services", label: "Services" },
    { href: "/patients", label: "Patients" },
    { href: "/consultations", label: "OPD" },
    { href: "/procedures", label: "Procedures" },
    { href: "/admissions", label: "IPD" },
    { href: "#", label: "Billing", disabled: true },
    { href: "/reports", label: "Reports" },
    { href: "/admin/receipts", label: "Receipts" },
  ],
  supervisor: [
    { href: "/supervisor", label: "Dashboard" },
    { href: "/reports", label: "My Day" },
  ],
  // OP-only desk does outpatient billing but not consultations intake here. The
  // Procedures link is always shown - service_lines.modify is a PER-USER grant
  // (plan §Part2), so a desk role may or may not actually be able to use it; the
  // page/action itself is what enforces the permission (dev-rules §8).
  op_desk: [
    { href: "/desk", label: "Counter" },
    { href: "/procedures", label: "Procedures" },
    { href: "/reports", label: "My Day" },
  ],
  // OP+IN desk also starts consultations (admin + this role only).
  op_ip_desk: [
    { href: "/desk", label: "Counter" },
    { href: "/consultations", label: "OPD" },
    { href: "/procedures", label: "Procedures" },
    { href: "/admissions", label: "IPD" },
    { href: "/reports", label: "My Day" },
  ],
};

// Unknown/absent role → no links (safe default; the bar still renders brand +
// user). Takes a plain string because the session role is untyped at the edge.
export function navItemsForRole(role: string): NavItem[] {
  return NAV_BY_ROLE[role as Role] ?? [];
}

// Full title shown under the user's name in the bar's right cluster.
export const ROLE_TITLE: Record<Role, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  op_desk: "OP Desk",
  op_ip_desk: "OP + IP Desk",
};

// Short brand-side label (the "ADMIN" kicker beside the logo).
export const ROLE_KICKER: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  op_desk: "Desk",
  op_ip_desk: "Desk",
};

export function roleTitle(role: string): string {
  return ROLE_TITLE[role as Role] ?? "Staff";
}

export function roleKicker(role: string): string {
  return ROLE_KICKER[role as Role] ?? "Staff";
}

// Up to two initials from a display name, for the avatar chip. Falls back to "?"
// for an empty name so the chip is never blank.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// True when `href` is the deepest nav item matching the current path. Exact match
// always counts; a section root (e.g. /admin) matches its descendants ONLY when no
// longer item href also matches - so on /admin/users the "Users" item wins and
// "Dashboard" (/admin) stays inactive (plan §4C). Disabled/placeholder items
// (href "#") never match a real path.
export function isActive(
  pathname: string,
  href: string,
  items: NavItem[],
): boolean {
  if (href === "#") return false;
  const matches = (h: string) => h !== "#" && (pathname === h || pathname.startsWith(h + "/"));
  if (!matches(href)) return false;
  const longest = items
    .map((i) => i.href)
    .filter(matches)
    .reduce((best, h) => (h.length > best.length ? h : best), "");
  return href === longest;
}
