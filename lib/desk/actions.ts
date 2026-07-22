import type { Role } from "@/lib/users/schema";

// PURE, client-safe catalogue of the counter actions launchable from /desk (like
// nav.ts): no "use server", no DB, no next/* imports, so it is unit-testable and
// safe to import anywhere. It is the ONE source of truth for "which counter tiles
// does this user see", mirroring each target route's real server gate - the desk
// must not invent a drifting copy of the authorization that scatters across
// nav.ts, CONSULT_ROLES, IP_ROLES and PROCEDURE_ROLES. Tiles are HINTS, not gates:
// every destination re-checks its own role server-side (dev-rules §8); the
// catalogue just keeps the hint matching the gate so users don't hit avoidable
// bounces. `icon` is a string key (mapped to a Lucide component in the client
// tile) so THIS module stays pure. No `permission` field today: the registry is
// empty after the service-line grant was retired. Re-add one here the day a real
// grant returns.

export type DeskGroup = "bill" | "manage" | "closeout";

export interface DeskAction {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
  group: DeskGroup;
  roles?: readonly Role[]; // if set: user.role must be in it (admin always passes)
}

export const DESK_ACTIONS: readonly DeskAction[] = [
  { key: "opd_new",   href: "/consultations",         label: "Start OPD consultation", description: "New or revisit visit, doctor consultation bill", icon: "stethoscope",   group: "bill",     roles: ["admin", "op_ip_desk", "supervisor"] },
  { key: "proc_new",  href: "/procedures",            label: "New procedure bill",     description: "Bill services from the catalogue",              icon: "receipt",       group: "bill",     roles: ["op_desk", "op_ip_desk", "supervisor", "admin"] },
  { key: "ipd_admit", href: "/admissions/new",        label: "Admit patient",          description: "Open an inpatient stay with advance deposit",   icon: "bedDouble",     group: "bill",     roles: ["admin", "op_ip_desk", "supervisor"] },
  { key: "ipd_ward",  href: "/admissions",            label: "Inpatients & discharge", description: "Running expenses, discharge & final bill",      icon: "clipboardList", group: "manage",   roles: ["admin", "op_ip_desk", "supervisor"] },
  { key: "opd_hist",  href: "/consultations/history", label: "OPD history",            description: "View, void or re-issue OPD bills",              icon: "history",       group: "manage",   roles: ["admin", "op_ip_desk", "supervisor"] },
  { key: "proc_hist", href: "/procedures/history",    label: "Procedure history",      description: "View, void or re-issue procedure bills",         icon: "history",       group: "manage",   roles: ["op_desk", "op_ip_desk", "supervisor", "admin"] },
  { key: "patients",  href: "/patients",              label: "Patient records",        description: "Search the full patient master list",           icon: "users",         group: "manage",   roles: ["admin"] },
  { key: "my_day",    href: "/reports",               label: "My day",                 description: "Everything you did & collected today",          icon: "barChart",      group: "closeout" },
];

// Available = role check (admin always passes; ungated actions show for all).
export function deskActionsFor(user: { role: string }): DeskAction[] {
  const isAdmin = user.role === "admin";
  return DESK_ACTIONS.filter(
    (a) => !a.roles || isAdmin || a.roles.includes(user.role as Role),
  );
}
