# Plan - Dynamic counter home (`/desk`) + correct the procedures gate

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> `PROJECT_OVERVIEW.md` first. Two linked pieces:
> **(A)** fix a mis-scoped permission so `op_desk` can actually do its job (bill procedures from the
> catalogue), and **(B)** reshape the counter landing page `/desk` to adapt to *who is standing at
> it* (role + permission). **No nav change, no change to where any role lands after login.**

---

## 1. The problem

`/desk` is the home for `op_desk` and `op_ip_desk` (`homePathForRole`). Today it renders **one card**
("My day"). Everything a counter operator does is reachable only through the top bar, and each
destination enforces a **different gate** - so the same link is a working page for one user and a
bounce for another, and the landing page explains none of it.

While mapping those gates a **real bug** surfaced (owner-confirmed): **`op_desk` cannot bill
procedures at all.**

### 1a. The mis-scoped permission (fix this first - Part A)

The **service catalogue** (the master list of services + prices - "the service lines which are
created") is owned by **admin only**: `/admin/services` and every action in `lib/services/actions.ts`
run `requireAdmin()`. That is the *write* side, and `op_desk` is correctly locked out of it.

But the **procedure billing flow** (`/procedures` + `lib/procedures/actions.ts`) - look up a patient,
pick services **from that catalogue**, set quantities, take payment, create the bill - is **also**
gated behind the `service_lines.modify` permission. That flow never edits the catalogue: it
**re-prices every line from the catalogue server-side** and never trusts a client price
(`repriceLines`, plan §4E). It is a pure **read/use** of the catalogue - precisely `op_desk`'s job -
yet the gate blocks them.

**Owner decision (confirmed):** *"op_desk are the people who just use the service lines which are
created - they can read, not write."* So:

- **Billing a procedure = read/use of the catalogue** -> available to the **counter roles by role**
  (`op_desk`, `op_ip_desk`, `admin`). Not a permission.
- **Editing the catalogue = write** -> stays **admin-only** at `/admin/services` (already true, untouched).
- **`service_lines.modify` is retired.** It currently guards nothing that isn't better expressed as
  "counter role," and there is no genuine "modify a service line beyond the catalogue" action in the
  flow. *(If a real override capability is ever built - custom price, ad-hoc line not in the
  catalogue, editing a finalized bill's lines - reintroduce a narrow permission for exactly that.)*

### 1b. Corrected gate table (the target Part B mirrors)

| Capability            | Route                       | Gate AFTER Part A                               | Reachable by                          |
| --------------------- | --------------------------- | ----------------------------------------------- | ------------------------------------- |
| Start OPD consult     | `/consultations`            | `requireRole(["admin","op_ip_desk"])`           | admin, op_ip_desk                     |
| OPD history / correct | `/consultations/history`    | `requireRole(["admin","op_ip_desk"])`           | admin, op_ip_desk                     |
| **New procedure bill**| `/procedures`               | **`requireRole(["op_desk","op_ip_desk","admin"])`** | **op_desk, op_ip_desk, admin**    |
| **Procedure history** | `/procedures/history`       | **`requireRole(["op_desk","op_ip_desk","admin"])`** | **op_desk, op_ip_desk, admin**    |
| Admit patient (IPD)   | `/admissions/new`           | `requireRole(["admin","op_ip_desk"])`           | admin, op_ip_desk                     |
| Inpatients / discharge| `/admissions`               | `requireRole(["admin","op_ip_desk"])`           | admin, op_ip_desk                     |
| Patient master list   | `/patients`                 | `requireAdmin()`                                | admin only                            |
| My day (close out)    | `/reports`                  | any signed-in (self-scoped)                     | everyone                              |
| Service **catalogue** | `/admin/services`           | `requireAdmin()` (unchanged)                    | admin only                            |

> **Supervisor & procedures:** the top bar gives Procedures to `op_desk`/`op_ip_desk` (and admin),
> **not** supervisor - a supervisor's counter role is inline PIN approval, not ringing up bills. So
> supervisor is intentionally **out** of the procedure role set. Easy to add later if the owner wants
> supervisors to bill; not now.

---

## Part A - Correct the procedures gate (prerequisite)

Small, self-contained, and must land **with** Part B (the desk catalogue mirrors these gates, so a
mismatch would send `op_desk` to a page that bounces them). All money stays server-authoritative -
`repriceLines` and the discount/PIN flow are **unchanged**; only the authorization check changes.

1. **`lib/procedures/actions.ts`** - replace the `const PERMISSION = "service_lines.modify"` +
   `requirePermission(PERMISSION)` in **every** action with a role gate:
   ```ts
   const PROCEDURE_ROLES = ["op_desk", "op_ip_desk", "admin"] as const;
   // ...in each action:
   const s = await requireRole(PROCEDURE_ROLES);   // was requirePermission(PERMISSION)
   ```
   (Actions that only used the returned session for `s.sub` keep working; the ones that didn't bind
   `s` can keep `await requireRole(PROCEDURE_ROLES)`.)
2. **`app/(dashboard)/procedures/page.tsx`** and **`app/(dashboard)/procedures/history/page.tsx`** -
   swap `requirePermission("service_lines.modify")` for `requireRole([...PROCEDURE_ROLES])`.
   - `history/page.tsx` also calls `listUsersWithPermission("service_lines.modify")` to populate the
     "Created by" filter. Replace with the counter operators who can create bills - e.g. a
     `listUsersByRole(PROCEDURE_ROLES)` helper (or the existing user-listing filtered to those roles).
     Keep the filter meaningful: only people who can create procedure bills.
3. **Retire the permission:** remove the `"service_lines.modify"` entry from `PERMISSIONS`
   (`lib/permissions.ts`). `PERMISSION_KEYS` then becomes empty `[]` - keep the registry shape valid:
   - `hasPermission` stays as-is (admin still ⇒ all; empty registry just means no grantable extras yet).
   - `lib/users/schema.ts` `permissions` uses `z.enum(PERMISSION_KEYS as [...])` - an **empty** enum
     tuple breaks `z.enum`. Guard it: when there are no keys, use `z.array(z.never()).default([])`
     (or `z.array(z.string()).length(0)`), so an empty grant list validates and any stray key is
     rejected. Add a short comment that the registry is intentionally empty until a real grant exists.
   - Update `lib/permissions.test.ts`: drop the `service_lines.modify`-specific assertions; keep/adjust
     the `admin ⇒ everything` and "unknown key rejected" tests to the empty-registry reality.
   - The **user add/edit form** permission checkbox list now renders empty - fine (nothing to grant
     yet). Make sure it degrades cleanly (no empty-section header, or a muted "No optional
     permissions" note), not a broken control.
4. **`lib/nav.ts`** - update the stale comment on `op_desk`'s Procedures link (it currently explains
   the per-user `service_lines.modify` grant). Procedures is now a plain counter-role capability; the
   link is correct for `op_desk`/`op_ip_desk` and no longer conditional.
5. **Grep for stragglers:** `service_lines.modify` must have **zero** references after this
   (`grep -rn "service_lines.modify" lib app` returns nothing).

**Part A tests / checks:** `op_desk` can create a procedure bill and open procedure history;
`supervisor` (no longer any grant path) cannot reach `/procedures` and is bounced to their home;
catalogue editing is still admin-only; `npm test` + `tsc` + `build` clean.

---

## Part B - The dynamic desk home

### 2. Capability model (one pure, tested source of truth)

"Who can do what" is scattered across `nav.ts` (`NAV_BY_ROLE`), `CONSULT_ROLES`
(`lib/consultations/actions.ts`), `IP_ROLES` (`lib/admissions/actions.ts`), and now `PROCEDURE_ROLES`
(Part A). The desk must not invent a drifting copy. Add one pure module that declares the counter
actions and their gates, mirroring §1b, and unit-test that mirror.

**`lib/desk/actions.ts`** - PURE, client-safe (no `"use server"`, no DB, no `next/*`, like `nav.ts`):

```ts
import type { Role } from "@/lib/users/schema";

// A counter action launchable from /desk. `icon` is a string key (mapped to a
// Lucide component in the client component) so THIS module stays pure and
// unit-testable. `roles` mirrors the target route's real server gate (§1b) -
// keep them in lock-step with the routes (mirror test, §2b). No `permission`
// field today: the registry is empty after Part A. Re-add one here the day a
// real grant returns.
export type DeskGroup = "bill" | "manage" | "closeout";

export interface DeskAction {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: string;
  group: DeskGroup;
  roles?: readonly Role[];   // if set: user.role must be in it (admin always passes)
}

export const DESK_ACTIONS: readonly DeskAction[] = [
  { key: "opd_new",   href: "/consultations",         label: "Start OPD consultation", description: "New or revisit visit, doctor consultation bill", icon: "stethoscope",   group: "bill",     roles: ["admin", "op_ip_desk"] },
  { key: "proc_new",  href: "/procedures",            label: "New procedure bill",     description: "Bill services from the catalogue",              icon: "receipt",       group: "bill",     roles: ["op_desk", "op_ip_desk", "admin"] },
  { key: "ipd_admit", href: "/admissions/new",        label: "Admit patient",          description: "Open an inpatient stay with advance deposit",   icon: "bedDouble",     group: "bill",     roles: ["admin", "op_ip_desk"] },
  { key: "ipd_ward",  href: "/admissions",            label: "Inpatients & discharge", description: "Running expenses, discharge & final bill",      icon: "clipboardList", group: "manage",   roles: ["admin", "op_ip_desk"] },
  { key: "opd_hist",  href: "/consultations/history", label: "OPD history",            description: "Reprint, void or re-issue OPD bills",           icon: "history",       group: "manage",   roles: ["admin", "op_ip_desk"] },
  { key: "proc_hist", href: "/procedures/history",    label: "Procedure history",      description: "Reprint, void or re-issue procedure bills",     icon: "history",       group: "manage",   roles: ["op_desk", "op_ip_desk", "admin"] },
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
```

### 2b. Tests (`lib/desk/actions.test.ts`) - untested = not done

- **`op_desk`** -> `proc_new`, `proc_hist`, `my_day`. (No OPD/IPD; **can** bill procedures now.)
- **`op_ip_desk`** -> `opd_new`, `proc_new`, `ipd_admit`, `ipd_ward`, `opd_hist`, `proc_hist`,
  `my_day` (everything except `patients`).
- **`supervisor`** -> **only** `my_day` (counter power is inline PIN, not a page).
- **`admin`** -> every action in the catalogue.
- **unknown role** -> only ungated actions (`my_day`).
- **Mirror guard:** assert each action's declared `roles` equals a hard-coded expectation map keyed to
  §1b, so changing a route's gate forces updating the catalogue (and vice-versa).

### 3. Data the page reads

`/desk` becomes a **server component** (like `admin/page.tsx`):

- `const s = await requireRole(["op_desk","op_ip_desk","supervisor","admin"]);` (own check in addition
  to the layout - hiding UI is not security, §8). Role alone drives the catalogue now, so no DB
  permission read is needed for tile visibility (Part A removed the only grant). Still fine to
  `getUserName(s.sub)` for the greeting.
- **Optional "your day so far" strip (recommended, small):** reuse the **existing** reports layer -
  `getMyMoneySummary(s.sub, from, to)` for the clinic day (`presetRange("today", clinicToday())`) +
  the shaped total from `lib/reports/summary.ts`. Show two honest numbers: **bills billed today** and
  **collected today**. **No new money math.** If it's more than a couple of lines, ship the launcher
  first and add this in a follow-up. Integer paise, formatted only for display.

### 4. UI (role-adaptive, keyboard-first, matches the admin home)

Design system = `admin/page.tsx` / `admin/users/users-manager.tsx` (rounded-xl `border bg-card`
tiles, accent icon chip `bg-accent text-accent-foreground`, muted sub-labels). Light theme, colour
for status only.

1. **Header:** greeting with name + role title (`roleTitle(role)` from `nav.ts`) + the date; one line
   "Bill a patient, then close out your day." Optional §3 day strip on the right (mirrors the admin
   header's right cluster).
2. **Action groups**, each rendered **only if it has visible actions** for this user (no empty
   headings):
   - **"Bill a patient"** (`bill`): OPD consult, Procedure, Admit.
   - **"Manage & correct"** (`manage`): Inpatients/discharge, OPD history, Procedure history, Patient
     records.
   - **"Close out"** (`closeout`): My day.
   Tiles reuse the admin quick-action markup (icon chip + label + sub + `ChevronRight`,
   `hover:border-accent`). Map `action.icon` -> Lucide in the tile component (keep the catalogue
   pure). Grid `grid-cols-[repeat(auto-fit,minmax(240px,1fr))]`.
3. **Thin / limited state (honest):** if the only visible action is `my_day` (a `supervisor` at the
   desk), render a short explainer instead of a lonely card - e.g. *"You can close out your day here.
   Discount and void approvals happen at the counter with your PIN."* Never a blank screen, never a
   dead link.
4. **Keyboard-first (dev-rules §UX):** tiles are `Link`s in tab order (Bill -> Manage -> Close out);
   `Enter` activates (native). Optional: `accessKey` digits `1..9` on the first tiles. No popups;
   every tile just navigates (reversible).

Can stay a **server component** (all data resolved server-side); the icon map renders fine server-side.

### 5. Per-role result (acceptance target)

- **`op_desk`:** Bill -> Procedure. Manage -> Procedure history. Close out -> My day. *(This is the
  headline fix - `op_desk` now has a real, usable counter home.)*
- **`op_ip_desk`:** Bill -> OPD consult, Procedure, Admit. Manage -> Inpatients & discharge, OPD
  history, Procedure history. Close out -> My day.
- **`supervisor`:** thin-state note about inline PIN approval + My day.
- **`admin`:** every tile (admin lands on `/admin`, but `/desk` is fully usable if opened).

Nothing here changes `homePathForRole` or the nav - only the **content** of `/desk`.

### 6. Roles / security

- Tiles are **hints, not gates.** Every destination keeps its own server gate (`requireRole`) - even a
  wrongly-shown tile still bounces an unauthorized user (§8). The catalogue just makes the hint match
  the gate so users don't hit avoidable bounces.
- No role or userId ever comes from the client; the page reads `session.sub` / `session.role` only.

### 7. Edge cases

- **Inactive/missing user** mid-session -> `requireRole` already redirects; no tiles for a dead account.
- **Empty day** in the optional strip -> "0 bills, Rs 0 collected" (honest zeros; covered by
  `summary.ts` tests).
- **Unknown/edge role** reaching `/desk` (layout gates it) -> only `my_day`, no crash.
- **Clinic-tz boundary** for the strip -> `clinicToday()` + `presetRange`, never server-local date.

## 8. Out of scope

Changing the nav or any landing route; live queues/patient search on the desk; supervisor approval
**pages**; touching `/supervisor` or `/admin` content (the same `deskActionsFor` could DRY those
later); adding supervisors to the procedure role set; reintroducing a granular permission (only when a
real override capability exists). No migration.

## 9. Definition of done

**Part A**
- [ ] Procedure billing + history are **role-gated** (`op_desk`, `op_ip_desk`, `admin`); `op_desk` can
      create a procedure bill and open procedure history.
- [ ] `service_lines.modify` fully retired: removed from `PERMISSIONS`; `permissions` schema handles the
      empty registry; `permissions.test.ts` updated; user form degrades cleanly; **zero** grep hits.
- [ ] Procedure history "Created by" filter lists procedure-creating roles, not permission-holders.
- [ ] Catalogue editing still admin-only (`/admin/services` untouched).

**Part B**
- [ ] `lib/desk/actions.ts` (pure) + `lib/desk/actions.test.ts` green, incl. mirror guard + every
      per-role case in §2b.
- [ ] `/desk` is a role-adaptive launcher: grouped tiles the user can actually use, thin-state
      explainer for supervisors, greeting + role, sane tab order.
- [ ] Page does its own `requireRole` (plus the layout); no client-supplied role.
- [ ] (Optional) "your day so far" strip via the existing reports layer - no new math.

**Both**
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` clean. Light theme, mobile-clean, colour for
      status only.

## 10. Verify (end-to-end)

1. **The bug:** sign in as `op_desk` -> `/desk` shows Procedure + Procedure history + My day; create a
   procedure bill from the catalogue and take payment -> works (previously bounced).
2. Sign in as `op_ip_desk` -> OPD consult, Procedure, Admit, Inpatients & discharge, OPD history,
   Procedure history, My day; each tile lands on the real page (no bounce).
3. Sign in as `supervisor` at `/desk` -> approval-note + My day only; no dead links; `/procedures`
   directly is bounced to their home.
4. Open `/desk` as `admin` -> every tile present and working; `/admin/services` still admin-only.
5. Confirm `op_desk` **cannot** edit the service catalogue (no `/admin/services`, no service actions).
6. Optional strip: bill a couple of items -> "collected today" matches My day.
7. `npm test` (procedures re-gate + desk mirror + per-role cases green), `npx next build` clean.

## 11. After this

The counter home is real and `op_desk` can do its job. Follow-ups (separate): reuse `deskActionsFor`
to give `/supervisor` (and the admin counter section) the same adaptive launcher; add live queues
(waiting consults, current inpatients); reintroduce a narrow service-line-override permission only if
that capability is actually built.
