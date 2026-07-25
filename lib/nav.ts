import type { Role } from "@/lib/users/schema";

// PURE, client-safe nav config (plan §5). No "use server", no DB, no next/*
// imports - imported by the client <TopNav> and unit-tested directly. One source
// of truth for "which links does this role see" and "which one is active".

export interface NavItem {
  href: string;
  label: string;
}

// Every item points at a real, shipped route - the bar never renders a link to a
// page that doesn't exist. Add an item here only once its route lands.
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "Staff" },
    { href: "/admin/doctors", label: "Doctors" },
    { href: "/admin/services", label: "Services" },
    { href: "/patients", label: "Patients" },
    { href: "/consultations", label: "OPD" },
    { href: "/procedures", label: "Procedures" },
    { href: "/admissions", label: "IPD" },
    { href: "/reports", label: "Reports" },
    { href: "/admin/receipts", label: "Receipt Templates" },
    { href: "/admin/suggestions", label: "Suggestions" },
  ],
  // Supervisors approve discounts/voids inline (PIN) AND work the full counter -
  // OP consultations, procedures and IP admit/discharge, same as op_ip_desk. Each
  // page re-checks the role server-side (dev-rules §8).
  supervisor: [
    { href: "/supervisor", label: "Dashboard" },
    { href: "/consultations", label: "OPD" },
    { href: "/procedures", label: "Procedures" },
    { href: "/admissions", label: "IPD" },
    { href: "/reports", label: "My Day" },
  ],
  // OP-only desk does outpatient billing but not consultations intake here.
  // Procedures is a plain counter-ROLE capability (op_desk / op_ip_desk / admin):
  // billing from the catalogue is the desk's job, so the link always applies to
  // op_desk. The page/action re-checks the role server-side (dev-rules §8).
  //
  // OPD/IPD point at the read-only LISTS (documents plan: every staff role can
  // open them to attach/view scans) - OPD goes straight to the history list, not
  // the intake flow, and every IP/billing mutation stays server-gated.
  op_desk: [
    { href: "/desk", label: "Counter" },
    { href: "/procedures", label: "Procedures" },
    { href: "/consultations/history", label: "OPD" },
    { href: "/admissions", label: "IPD" },
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
// "Dashboard" (/admin) stays inactive (plan §4C). A non-route href ("#") never
// matches a real path.
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
