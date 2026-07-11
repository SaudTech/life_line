# Implementation Plan - User Management (Admin manages staff)

> **For the implementing session.** Self-contained; you do **not** have the
> conversation that produced it. Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, and
> `AGENTS.md` first.
>
> **PREREQUISITE:** `docs/plans/ui-foundation.md` must be done first - this plan assumes
> **shadcn/ui + react-hook-form + zod** are installed, the light theme is configured, and
> `lib/forms/action-result.ts` (the `ActionResult` type + `zodFieldErrors`) and the
> **RHF ⇄ Server Action** pattern exist (login is the reference). Build every form here
> the same way login was built.
>
> **Strong design bar.** Invoke the **`frontend-design`** skill before building UI, and
> run **`design-audit`** on the card + panel afterward and fix what it finds. We are not
> in a rush - no shortcuts.

---

## 1. Objective & scope

A polished **/admin/users** screen where an admin manages all staff accounts.

**In scope**
- **Card grid** of users; a small **Active ⇄ Trash** toggle to switch between active
  users and deactivated ("trash") users.
- Clicking a card opens a **right-side panel** (shadcn `Sheet`) with the user's full
  details + edit controls. A **"New user"** button opens the panel empty (create mode).
- Full management: **create, edit (name/phone/email/role), reset password, set/clear
  approval PIN, deactivate (→ trash) and reactivate (restore).**
- Server-enforced admin-only, hashed passwords/PINs, audit-logged, keyboard-accessible.

**Not in scope** - see §11.

---

## 2. Ground truth (current repo state)

- **Stack:** Next 16 (App Router), React 19, Tailwind v4 (light-only), `pg`. Path alias
  `@/* → ./*`. Node 22. Vitest (`npm test`).
- **UI foundation (from ui-foundation.md):** shadcn/ui (new-york, zinc, lucide, `cn` in
  `lib/utils.ts`), `react-hook-form`, `@hookform/resolvers`, `zod`. Shared bridge in
  `lib/forms/action-result.ts`:
  ```ts
  type ActionResult<T=void> = { ok:true; data?:T } | { ok:false; formError?:string; fieldErrors?:Record<string,string> };
  function zodFieldErrors(error: ZodError): Record<string,string>;
  ```
- **Form pattern to copy (from login):** one **zod schema** = source of truth; client
  `useForm({ resolver: zodResolver(schema) })`; server action takes a **typed values
  object**, re-validates with `schema.safeParse`, returns `ActionResult`; client maps
  `fieldErrors` via `form.setError(field,…)` and `formError` via `form.setError("root",…)`.
  Pending = `form.formState.isSubmitting`. **No `useActionState`, no raw `FormData`.**
- **Auth helpers:** `lib/auth/dal.ts` → `requireAdmin()` and `getSession()` → `{ sub,
  role, exp }` (**no location_id in the session**). `lib/password.ts` → `hashPassword`.
  `lib/db.ts` → `pool`.
- **`(dashboard)` layout already `requireAdmin()`s** the page; still call `requireAdmin()`
  **inside every action** (hiding UI ≠ security, §8).
- **Admin home** `app/(dashboard)/admin/page.tsx` - add a link/card to `/admin/users`.
- **`users` table** (migrations 0001 + 0002):
  | column | type | notes |
  |---|---|---|
  | `id` | `uuid` | PK |
  | `name` | `text` | NOT NULL |
  | `email` | `text` | nullable; **unique when present** |
  | `phone` | `text` | **NOT NULL, UNIQUE** - the sign-in identifier |
  | `password_hash` | `text` | scrypt; **never SELECT into UI or log** |
  | `pin_hash` | `text` | nullable; supervisor discount-approval PIN |
  | `role` | `text` | CHECK in (`op_desk`,`op_ip_desk`,`supervisor`,`admin`) |
  | `active` | `boolean` | NOT NULL default `true`; `false` == "trash" |
  | `location_id` | `bigint` | NOT NULL → `locations(id)` |
  | `created_at`,`updated_at` | `timestamptz` | `updated_at` auto-bumped by trigger |

  > **Phone is unique for STAFF only.** `patients.phone` stays non-unique by design.

- **`audit_log`:** `user_id uuid` (actor), `action text`, `entity text`, `entity_id
  bigint`, `details jsonb`, `at`. ⚠ **`entity_id` is BIGINT but user ids are UUID** - put
  the target UUID in **`details`** and leave `entity_id` NULL.
- **No schema migration needed.** "Delete" = `active=false`; **no hard delete** (§4).

---

## 3. Next.js 16 specifics - READ BEFORE CODING

Confirm against `node_modules/next/dist/docs/`:
1. Mutations are **Server Actions** (`"use server"`), invoked from the client via the
   RHF `handleSubmit` → typed action pattern (not `<form action>`/`useActionState`).
2. After every mutation, call **`revalidatePath("/admin/users")`** (`next/cache`) so the
   server page re-queries and the client manager receives fresh `users` props.
3. `redirect()` throws - you generally won't redirect here; stay on the page + revalidate.
4. `cookies()` is async - handled inside `requireAdmin()`.

---

## 4. Decisions (firm)

**A. Selection & panel = client state; mutations = server actions.** The page (server)
loads **all** users (active + inactive, no hashes) → passes to a client `UsersManager`
holding `selectedId`, `mode` (`view`/`create`), `showTrash`. Each mutation action ends
with `revalidatePath`; fresh props flow back and the open `Sheet` re-reads the selected
user by id. (URL deep-linking `?user=<id>` optional, not required.)

**B. New user's `location_id`** = the creating admin's, via `getUserLocationId(session.sub)`.

**C. Admin may create/edit any of the four roles.** One server-side lock-out rule:
**no action may leave zero active admins** - blocks deactivating/demoting the last active
admin, and deactivating your **own** account. Compute guards from **DB state**
(`activeAdminCount()`, `getUserRoleActive(id)`), never from client-passed values.

**D. Passwords/PINs:** create requires a password. Editing details does **not** touch the
password - reset is a separate explicit action. PIN is optional, only meaningful for
`supervisor`/`admin`; submitting an **empty** PIN **clears** it (`pin_hash=NULL`).

**E. Duplicate phone/email are DB-enforced.** Catch Postgres `err.code==="23505"`, read
`err.constraint` (`users_phone_unique`|`users_email_unique`) → per-field message. No racy
pre-SELECT.

**F. No hard delete, ever.** No "permanently delete" button. Trash is restore-only.

---

## 5. Files to create / change

```
lib/
  audit.ts                 ← writeAudit(actorId, action, details) helper (shared, server)
  users/
    schema.ts              ← zod schemas + ROLES/labels (CLIENT-SAFE: no "use server"/DB imports)
    schema.test.ts         ← Vitest for the schemas
    repository.ts          ← data access (pool) - signatures below
    actions.ts             ← "use server": create/update/resetPassword/setPin/setActive → ActionResult
app/(dashboard)/admin/
  page.tsx                 ← add a link/card to /admin/users
  users/
    page.tsx               ← server: requireAdmin(); listUsers(); <UsersManager users=… meId=session.sub/>
    users-manager.tsx      ← "use client": toolbar + Active/Trash toggle + card grid + Sheet orchestration
    user-card.tsx          ← one card (button) - status + role styling
    user-panel.tsx         ← Sheet content: details / password / pin / status forms (RHF each)
components/ui/*            ← add: sheet, card, badge  (button/input/label/select/form/sonner already added)
```

Add the extra shadcn primitives: `npx shadcn@latest add sheet card badge`.

### `lib/users/schema.ts` (client-safe; the tested core)

```ts
import { z } from "zod";

export const ROLES = ["op_desk", "op_ip_desk", "supervisor", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  op_desk: "OP Desk", op_ip_desk: "OP + IP Desk", supervisor: "Supervisor", admin: "Admin",
};

const phone = z.string().trim().regex(/^\d{7,15}$/, "Enter a valid phone number (7-15 digits).");
const email = z.string().trim().email("Enter a valid email.").optional().or(z.literal(""));
const password = z.string().min(8, "Password must be at least 8 characters.");
const pin = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits.");

export const newUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  phone,
  role: z.enum(ROLES),
  password,
  email,
  pin: z.union([pin, z.literal("")]).optional(),   // optional; "" = none
});
export type NewUserValues = z.infer<typeof newUserSchema>;

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(100),
  phone,
  role: z.enum(ROLES),
  email,
});
export const resetPasswordSchema = z.object({ id: z.string().uuid(), password });
export const setPinSchema = z.object({ id: z.string().uuid(), pin: z.union([pin, z.literal("")]) }); // "" clears
export const setActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });
```

### `lib/users/repository.ts` (thin data access - never select the hash columns)

```ts
export interface UserListRow { id; name; phone; email: string|null; role; active; created_at; }
// listUsers(): SELECT id,name,phone,email,role,active,created_at ORDER BY name ASC.  (ALL users)
// createUser({name,phone,email,role,password_hash,pin_hash,location_id}): INSERT ... RETURNING id. (caller catches 23505)
// updateUser({id,name,phone,email,role}): UPDATE ... (caller catches 23505)
// setUserPassword(id, password_hash): UPDATE.
// setUserPin(id, pin_hash|null): UPDATE.
// setUserActive(id, active): UPDATE.
// getUserLocationId(adminId): SELECT location_id.
// getUserRoleActive(id): SELECT role, active.   // for guards
// activeAdminCount(): SELECT count(*)::int FROM users WHERE role='admin' AND active.
```

### `lib/users/actions.ts` (`"use server"`) - typed values → `ActionResult`

Mirror login's `loginAction`. Each action:
1. `const s = await requireAdmin();`
2. `const parsed = SCHEMA.safeParse(input); if (!parsed.success) return { ok:false, fieldErrors: zodFieldErrors(parsed.error) };`
3. hash if needed; run repository call in `try/catch` (map `23505` → `fieldErrors.phone/email`);
4. `await writeAudit(s.sub, "<action>", { user_id, ... });`
5. `revalidatePath("/admin/users");` → `return { ok:true, data? };`

```ts
// createUserAction(input): newUserSchema; location = getUserLocationId(s.sub);
//   password_hash = hashPassword(v.password); pin_hash = v.pin ? hashPassword(v.pin) : null;
//   createUser(...); audit "user.create"; return { ok:true, data:{ id } }.
// updateUserAction(input): updateUserSchema; GUARD (decision C) using DB state before a role change; updateUser; audit "user.update".
// resetPasswordAction(input): resetPasswordSchema; setUserPassword(hash); audit "user.password_reset".
// setPinAction(input): setPinSchema; v.pin === "" ? setUserPin(null)+audit "user.pin_clear" : setUserPin(hash)+audit "user.pin_set".
// setActiveAction(input): setActiveSchema; on active===false apply lock-out + no-self guards (DB-derived); setUserActive; audit "user.deactivate"/"user.activate".
```
`lib/audit.ts`: `writeAudit(actorId, action, details)` →
`INSERT INTO audit_log (user_id, action, entity, details) VALUES ($1,$2,'user',$3)`.

---

## 6. UI & interaction design (the point of the task)

**Invoke `frontend-design` first.** Light theme only - **use shadcn semantic tokens**
(`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border`,
`ring`) not raw zinc; **no `dark:` utilities**. Colour only for status
(active = green, inactive = muted, destructive = red). Fixed, muscle-memory layout; full
keyboard support.

### Layout (`users-manager.tsx`)
- **Toolbar:** left - "Users" + count. Right - a compact segmented **`Active | Trash`**
  toggle (Trash shows a count, e.g. `Trash · 3`; this is the "tiny flag") and a primary
  **`New user`** `Button`.
- **Card grid:** `grid` `repeat(auto-fill, minmax(240px, 1fr))`, comfortable gap; filtered
  to active **or** trash per the toggle (client-side filter of the loaded list - instant).
- **Right panel:** shadcn **`Sheet`** (`SheetContent side="right"`), width ~380-420px. Its
  slide/overlay/`Esc`/focus-trap behavior is handled by the primitive - use it, don't
  hand-roll.

### Card (`user-card.tsx`) - a real `<button>` (Enter/Space opens)
- Initials avatar (neutral), **name** (`font-medium`), subtle **role `Badge`**
  (`ROLE_LABELS`), **phone** on its own line (tabular figures), **status dot** (green
  active / muted inactive). Inactive: reduced opacity + small "Inactive" tag. Hover:
  subtle elevation; **selected**: `ring`. Empty states: "No users yet." / "Trash is empty."

### Panel (`user-panel.tsx`) - inside `Sheet`, titled by the user (or "New user")
Each section is its **own RHF form** (its own schema + `useActionState`-free typed submit
+ inline success/error), following the login pattern:
1. **Create mode** (from `New user`): `newUserSchema` - name, phone, role (`Select`),
   password (required), email (optional), PIN (optional; render only when role is
   supervisor/admin). Submit = **Create**; on success (`data.id`) select the new card /
   toast.
2. **Details** (edit): `updateUserSchema` - name, phone, email, role. Save = `updateUserAction`.
3. **Password:** `resetPasswordSchema` - one "new password" field + **Reset password**.
   Never shows the current one.
4. **Approval PIN** (supervisor/admin only): `setPinSchema` - PIN field; **Set PIN** /
   **Clear PIN** (empty = clear). Note it's the discount-approval PIN.
5. **Status:** if active → **Deactivate** (destructive styling; moves to Trash); if
   inactive → **Reactivate**. Server guard refusals render inline as `root` errors
   ("You can't deactivate the last admin.").
- Footer meta: "Added <created_at>". Success feedback via **sonner** toast is encouraged.
- Field errors under each field (`FormMessage`); **secrets are write-only** (never
  prefilled/echoed).

### Keyboard & a11y
- Cards are buttons in DOM order; `Sheet` handles focus-in/`Esc`/return-focus.
- Every input via shadcn `FormField`/`FormLabel`/`FormControl` (labels wired). Submit
  disabled while `isSubmitting`, pending label ("Saving…").

---

## 7. Implementation order

1. `lib/users/schema.ts` + `schema.test.ts`; `npm test` green.
2. `lib/audit.ts`; `lib/users/repository.ts`.
3. `lib/users/actions.ts` - create → update → resetPassword → setPin → setActive (guards).
4. `npx shadcn@latest add sheet card badge`.
5. UI: `page.tsx` → `users-manager.tsx` → `user-card.tsx` → `user-panel.tsx`
   (`frontend-design` before, `design-audit` after).
6. Link `/admin/users` from the admin home.
7. Verify (§9); `npx tsc --noEmit` + `npx next build` clean.

---

## 8. Testing (unit - required, dev rules §3)

Cover `lib/users/schema.ts` with Vitest (client-safe, no `@/`, like `session.test.ts` /
`schema.test.ts` for login) - schemas are the validation source of truth:
- `newUserSchema`: valid input passes; each failure (blank name, non-digit/short/long
  phone, password < 8, role not in `ROLES`, bad email, bad PIN) → the matching field
  issue. Empty email/pin allowed.
- `updateUserSchema` has no `password`. `resetPasswordSchema`/`setPinSchema` boundaries
  (7 vs 8 char password; 3/4/6/7-digit PIN; `""` pin allowed by `setPinSchema`).
- (Repository/actions touch DB/framework → integration on a **separate test DB** later,
  not this task.)

---

## 9. Manual verification

Sign in as admin → `/admin/users`:
1. **Create** an `op_desk` user → new card; toast/success; sign in works (if role enabled)
   with phone + password.
2. **Duplicate phone/email** → per-field error, no dup, no crash.
3. **Bad inputs** (blank name, 3-char password, letters in phone) → per-field errors.
4. **Edit** name/role in the panel → persists after revalidate.
5. **Reset password** → new password works, old fails.
6. **PIN**: set for a supervisor, then clear - both audited; value never shown.
7. **Deactivate** → moves to **Trash** (toggle), sign-in refused. **Reactivate** → back
   to Active, sign-in works.
8. **Guards**: deactivating your own account → refused; last admin deactivate/demote →
   refused with message.
9. Keyboard-only: tab to card, Enter opens Sheet, Esc closes, focus returns; forms submit
   on Enter.
10. `design-audit` on card + panel addressed. `tsc` + `build` clean. **No password/PIN
    hashes in any query result, log, or payload.** Light theme only - no `dark:` classes.

---

## 10. UX & security (non-negotiable)

- `requireAdmin()` inside **every** action.
- Role whitelist via `z.enum(ROLES)` on **both** client and server - never trust the client `Select`.
- `password`/`pin` → `hashPassword`; never selected out, returned, or logged. `listUsers`
  excludes both hash columns.
- Lock-out + no-self-deactivate guards computed from **DB state** on the server (decision C).
- Every create/update/reset/pin/activate/deactivate writes an `audit_log` row (actor =
  `session.sub`, target UUID in `details`).
- Colour for status only; light-only shadcn tokens; full keyboard support.

---

## 11. Out of scope / future

- `must_change_password` on first login (admin-set/reset passwords). **Recommended next**:
  migration `0003_users_must_change_password.sql`
  (`must_change_password boolean NOT NULL DEFAULT true`), enforced at login. Not now.
- Enabling non-admin roles to sign in / reach their dashboards (login admits admins only).
- Search / pagination / sorting (small staff count - filtered grid is enough).
- `audit_log.entity_id` made UUID-capable (use `details` for now).
- Bulk actions, CSV import/export, avatars/photos, self-service profile.
- A shared `useServerForm` hook to DRY the RHF+action glue - extract only once several
  forms exist; don't pre-abstract.
- **Hard delete** - deliberately never built.

---

## 12. Definition of done

- [ ] `newUserSchema`/`updateUserSchema`/`resetPasswordSchema`/`setPinSchema` covered by
      passing Vitest tests.
- [ ] Card grid renders active users; **Active/Trash** toggle switches to deactivated
      users (with a count).
- [ ] Card click opens the right **Sheet**; **New user** opens it in create mode.
- [ ] Create, edit, reset-password, set/clear-PIN, deactivate, reactivate all work,
      each via the RHF+zod+`ActionResult` pattern, each audited.
- [ ] Duplicate phone/email + invalid inputs rejected with per-field messages.
- [ ] Lock-out/self guards refuse dangerous cases with a clear message.
- [ ] `design-audit` findings on card + panel addressed; keyboard flow works; light-only.
- [ ] Admin-only enforced in every action; no password/PIN hashes read out or logged.
- [ ] `npx tsc --noEmit` and `npx next build` clean.
```
