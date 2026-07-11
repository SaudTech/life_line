# Plan — OP Procedures, Part 1 (Admin): Services Catalog + User Permissions

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`
> first. This is **Part 1 of 2** for OP procedures. Part 1 is entirely **admin-side
> groundwork**; **Part 2** (separate plan) builds the OPD procedure/billing flow that
> consumes it. Mirror the existing **Doctors** and **Users** features closely. Verify
> ground truth (§2). No rush; no shortcuts.

**Part 1 = two independent pieces, both admin:**
- **1A — Services catalog:** the master list of billable items (Injection, IV, Dressing…)
  with prices, so items *exist* to sell. (A Doctors clone.)
- **1B — User permissions:** granular, per-user capabilities the admin grants (e.g.
  **"Can modify service lines"**), so a specific non-admin user can be trusted to do the
  procedure work in Part 2 instead of the admin.

**Part 2 (later, out of scope here):** the OPD procedure flow — find a patient **by phone
OR by consultation number**, confirm an active consultation, add/edit **service lines**
(gated by the new permission), total them, save a `type='procedure'` bill. See §9.

---

## 2. Ground truth (current repo state)

- **Patterns to mirror:** `lib/doctors/*` (schema → repository → actions, RHF+zod, clean
  table + Add/Edit dialog) and `lib/users/*`. Shared: `lib/forms/action-result.ts`
  (`ActionResult`, `zodFieldErrors`), `lib/money.ts` (`rupeesToPaise`, `formatPaise`,
  `isValidRupees`), `lib/audit`/`lib/activity` (log tags — `service.*` already registered).
- **Tables already exist** (no migration for services): `services (id, name, price_paise,
  active, location_id, created_at)` — like doctors but no `department`/`revisit`. Also
  `bills` and `bill_items` exist for Part 2.
- **`users`** columns: `id uuid, name, email, phone, password_hash, pin_hash, role, active,
  location_id, created_at, updated_at`. **No permissions column** — 1B adds one.
- **Roles:** `lib/users/schema.ts` → `ROLES = [op_desk, op_ip_desk, supervisor, admin]`,
  `z.enum(ROLES)`. Permissions are **additive to** roles, not a replacement.
- **DAL** (`lib/auth/dal.ts`): `getSession()` → `{ sub, role, exp }`, `requireSession()`,
  `requireRole(allowed)`, `requireAdmin()`. **No `requirePermission`** — 1B adds it. The
  **session carries only role**, so permission checks read fresh from the DB (§4B).
- **Activity tags:** `service.create/update/activate/deactivate` already in the registry.
  Add a permission-change tag in 1B (§ below).
- **Nav** (`lib/nav.ts`): admin has real items + `#` placeholders. Add a real **Services**
  item; update `lib/nav.test.ts`.

---

## 3. Next.js 16 notes
Same as Doctors/Users: `"use server"` actions from RHF `handleSubmit` (typed object) →
`safeParse` → `ActionResult`; `revalidatePath`; role/permission gate **inside every
action**. Light-only shadcn tokens; keyboard-first; no card-style switcher.

---

# PART 1A — Services catalog (admin CRUD)

A near-exact **Doctors clone** with fewer fields.

### Files
```
lib/services/
  schema.ts            ← zod: newServiceSchema / updateServiceSchema / setServiceActiveSchema (client-safe)
  schema.test.ts       ← Vitest
  repository.ts        ← listServices / listActiveServices / createService / updateService / setServiceActive
  actions.ts           ← "use server": create / update / setActive → ActionResult (requireAdmin, activity, revalidate)
app/(dashboard)/admin/services/
  page.tsx             ← server: requireAdmin(); listServices(); <ServicesManager/>
  services-manager.tsx ← "use client": clean table + Add/Edit dialog + activate/deactivate
  service-form-dialog.tsx ← "use client": RHF + zod
lib/nav.ts / lib/nav.test.ts  ← add { href:"/admin/services", label:"Services" }
```

### Schema (client-safe; reuse `isValidRupees`)
```ts
import { z } from "zod";
import { isValidRupees } from "@/lib/money";
const id = z.string().regex(/^\d+$/, "Invalid id.");
const name = z.string().trim().min(1, "Name is required.").max(100);
const price = z.string().trim().refine(isValidRupees, "Enter a valid amount (e.g. 50 or 50.00).");
export const newServiceSchema     = z.object({ name, price });
export const updateServiceSchema  = z.object({ id, name, price });
export const setServiceActiveSchema = z.object({ id, active: z.boolean() });
```

### Repository (thin) — `price_paise` is BIGINT (string from pg)
```ts
export interface ServiceRow { id: string; name: string; price_paise: string; active: boolean; created_at: Date; }
// listServices(): all (active + inactive), ORDER BY name.
// listActiveServices(): WHERE active — used by the Part 2 picker.
// createService({name, price_paise, location_id}) RETURNING id.  updateService({id,name,price_paise}).  setServiceActive(id,active).
```

### Actions — mirror `lib/doctors/actions.ts`
`create/update/setActive`: `requireAdmin()`; `safeParse`; `price_paise = rupeesToPaise(v.price)`;
location via `getUserLocationId(s.sub)`; repository call; log `service.create|update|activate|deactivate`;
`revalidatePath("/admin/services")`. No unique constraint → no 23505. No lock-out guards.

### UI
Clean **table** (Name · Price `₹{formatPaise}` · Status · Actions) + one Add/Edit **Dialog**
(Name autofocus → Price ₹ `inputMode="decimal"`). Inactive rows muted. Colour = status only.
Empty state. `frontend-design` before, `design-audit` after.

---

# PART 1B — User permissions (granular, admin-granted)

Add per-user capabilities on top of roles. Seed with **"Can modify service lines"** (the
capability Part 2's procedure flow requires). Built to grow (registry).

### D. Decisions (firm)
- **B-1. Storage: `permissions text[]` on `users`** (migration `0007`), default `'{}'`.
  Simple and adequate for a small staff. (A `user_permissions` join table is the
  normalized alternative — not needed at this scale.)
- **B-2. Checks read fresh from the DB, not the session.** The session only holds `role`;
  a grant change must take effect immediately (not after re-login). `requirePermission`
  loads the user's `role, active, permissions` by `session.sub` (cached per request).
- **B-3. `admin` implies every permission.** Non-admins get only what's explicitly granted.
  Inactive users pass no check.
- **B-4. Permissions validated against a typed registry** on the server — never trust the
  client checkbox list. Unknown keys rejected.
- **B-5. The Services *catalog* CRUD stays admin-only** (Part 1A). The first *grantable*
  permission is `service_lines.modify`, enforced in **Part 2** (procedure flow). The
  registry is designed to add more later.

### Migration `0007_user_permissions.sql`
```sql
ALTER TABLE users ADD COLUMN permissions TEXT[] NOT NULL DEFAULT '{}';
```

### Files
```
lib/permissions.ts        ← PURE, client-safe: PERMISSIONS registry, PERMISSION_KEYS, hasPermission(...)
lib/permissions.test.ts   ← Vitest
lib/auth/dal.ts           ← add requirePermission(perm)
lib/users/repository.ts   ← getUserAuthz(id); include permissions in create/update + listUsers
lib/users/schema.ts       ← add `permissions` to new/update schemas (validated vs registry)
lib/users/actions.ts      ← pass permissions through; log the change
app/(dashboard)/admin/users/user-dialogs.tsx  ← add a "Permissions" checkbox section to the user form
lib/activity/actions.ts   ← add "user.permissions_change" tag (label "Permissions updated", tone accent)
```

### `lib/permissions.ts` (pure, client-safe — the tested core)
```ts
export interface PermissionMeta { label: string; description: string; }

// ONE registry of grantable capabilities. `admin` implicitly has all of these.
export const PERMISSIONS = {
  "service_lines.modify": {
    label: "Can modify service lines",
    description: "Add, edit and remove billed service lines on a patient's procedure bill.",
  },
  // add more here as features need them
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

// The authority check. admin ⇒ everything; otherwise the key must be granted.
export function hasPermission(
  user: { role: string; permissions: readonly string[] },
  key: PermissionKey,
): boolean {
  return user.role === "admin" || user.permissions.includes(key);
}
```

### `lib/auth/dal.ts` — `requirePermission`
```ts
// Loads role+active+permissions from the DB (fresh, cached per request) and enforces.
// No session → /login; inactive or missing → /login; lacks permission → bounce to home.
export async function requirePermission(key: PermissionKey): Promise<SessionPayload> {
  const session = await requireSession();
  const authz = await getUserAuthz(session.sub);         // { role, active, permissions } | null
  if (!authz || !authz.active) redirect("/login");
  if (!hasPermission(authz, key)) redirect(homePathForRole(session.role));
  return session;
}
```
> Import note: `dal.ts` importing `getUserAuthz` from `lib/users/repository.ts` is fine
> (both server). Keep `lib/permissions.ts` free of server imports so the client form and
> tests use it too.

### `lib/users/repository.ts`
- `getUserAuthz(id)`: `SELECT role, active, permissions FROM users WHERE id=$1` →
  `{ role, active, permissions: string[] } | null`. (Cache with React `cache` like `getUserName`.)
- `createUser` / `updateUser`: add a `permissions text[]` param (default `{}`); include in
  INSERT/UPDATE. `listUsers`: add `permissions` to the SELECT (it's not a secret).
- `UserListRow` gains `permissions: string[]`.

### `lib/users/schema.ts`
Add to `newUserSchema` and `updateUserSchema`:
```ts
permissions: z.array(z.enum(PERMISSION_KEYS)).default([]),
```
(Server rejects any key not in the registry — B-4.)

### `lib/users/actions.ts`
- `createUserAction` / `updateUserAction`: pass `v.permissions` to the repository.
- On update, if the permission set changed, also log `user.permissions_change`
  (`details: { user_id, permissions }`) — or fold into the existing `user.update` audit
  with the permissions in `details`. (Never log secrets.)

### UI — user form (`user-dialogs.tsx`)
- Add a **"Permissions"** section: a checkbox per `PERMISSION_KEYS` (label + description
  from the registry), bound into the RHF form as `permissions: string[]`.
- When **role = admin**, show the permissions as **all-on and disabled** with a note
  ("Admins have every permission") — don't store redundant grants; the check already
  implies them.
- On the user **card/list**, optionally show a small badge when a user has any explicit
  permission (nice-to-have, keep calm).

---

## 5. Implementation order
1. **1A Services:** `schema(+test)` → `repository` → `actions` → UI → nav(+test). `npm test`.
2. **1B Permissions:** migration `0007` → `lib/permissions.ts(+test)` → `getUserAuthz` +
   `requirePermission` → users schema/repository/actions → user-form checkboxes →
   activity tag.
3. `npx tsc --noEmit` + `npx next build` clean; `design-audit` on the services table +
   the permissions section.

---

## 6. Testing (unit — required)
- **`lib/services/schema.test.ts`:** valid service passes; blank name / bad price → field errors.
- **`lib/permissions.test.ts`:** `hasPermission` — admin ⇒ true for every key regardless of
  grants; non-admin ⇒ true only when the key is in `permissions`; unknown behavior; empty grants.
- Keep the suite green (users/doctors/nav/etc.). Repository/actions/`requirePermission` (DB)
  → integration later.

---

## 7. Manual verification
1. `/admin/services`: add "Injection ₹50", "IV ₹200" → rows show `₹50.00` / `₹200.00`; edit
   price persists as paise (`SELECT price_paise` → `5000`); deactivate/reactivate works & audits.
2. Create a **non-admin** user (e.g. op_ip_desk) and tick **"Can modify service lines"** →
   `SELECT permissions FROM users` shows `{service_lines.modify}`. Untick → empty.
3. Admin user: permissions section shows all-on/disabled; nothing redundant stored.
4. (Enforcement is exercised in Part 2, but you can unit-verify `hasPermission` now.)
5. `npm test`, `npx tsc --noEmit`, `npx next build` clean. Light-only; no style switcher.

---

## 8. UX & security (non-negotiable)
- `requireAdmin()` in every Services action; permissions validated against the registry on
  the server (never trust the client checkboxes).
- Money via `rupeesToPaise` (integer paise). Never hard-delete (deactivate services).
- Activity-log every service change and permission change. Colour = status only; keyboard-first.

---

## 9. Part 2 preview (NOT built here — so you can shape Part 1 for it)
The OPD procedure flow will:
- **Find the patient by phone OR by consultation number.** ⚠ **Decision needed in Part 2:**
  consultations today have only a bigint `id` (no friendly code). Either (a) use that `id`
  as the "consultation number" shown to staff, or (b) add a `consultation_code` (sequence +
  default, like `patient_code`) via a Part 2 migration. Nothing to build in Part 1 — just be
  aware the lookup key exists.
- Confirm the patient has an **active consultation** (validity window — rules already exist:
  `isConsultationValid`).
- **Add/edit/remove service lines** (from `listActiveServices`) with quantities — gated by
  **`requirePermission("service_lines.modify")`** (so an admin *or* a granted user can do it).
- Total via existing billing rules; save a `type='procedure'` bill linked to `consultation_id`
  with `bill_items`. No new consultation fee. Optional supervisor discount (already built).

---

## 10. Definition of done (Part 1)
- [ ] **1A:** `/admin/services` CRUD (table + dialog, clean/light), prices as integer paise,
      activate/deactivate, audited; Services nav item added; `services/schema.test.ts` passes.
- [ ] **1B:** migration `0007` adds `users.permissions text[]`; `lib/permissions.ts` registry
      + `hasPermission` (tested); `requirePermission` + `getUserAuthz` added; user create/edit
      grants permissions (validated vs registry; admin ⇒ all, disabled); permission changes audited.
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` all clean; `design-audit` addressed.
```
