# Implementation Plan - Doctors CRUD (admin master data)

> **For the implementing session.** Self-contained; you do **not** have the conversation
> that produced it. Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md` first. This
> mirrors the **existing Users feature** - copy its structure/patterns closely. Verify
> ground truth (§2) before starting. No rush; no shortcuts.

---

## 1. Objective & scope

Let an **admin** manage the **doctors** master list - the data every consultation depends
on (a doctor's fee + revisit-validity days). This is the prerequisite for patient
registration & consultations (the next plan).

**In scope**
- `/admin/doctors`: list all doctors + **create, edit, deactivate/reactivate**.
- Fields: **name**, **department** (optional), **consultation fee** (₹), **revisit
  validity (days)**, **active**.
- Money handled as **integer paise** end to end (this is the app's first money input - see
  §4A). Server-enforced admin-only, audit-logged, keyboard-accessible.

**Not in scope** - see §10 (services, patients/consultations are separate/next).

---

## 2. Ground truth (current repo state - mirror the Users feature)

- **Stack:** Next 16, React 19, Tailwind v4 (light-only), shadcn/ui, react-hook-form +
  zod, `pg`. Path alias `@/* → ./*`. Vitest (`npm test`).
- **The Users feature is your template. Read and copy its shape:**
  - `lib/users/schema.ts` (zod), `lib/users/repository.ts` (thin `pool` queries),
    `lib/users/actions.ts` (`"use server"`, typed input → `safeParse` →
    `ActionResult`, `requireAdmin` inside every action, `writeAudit`, `revalidatePath`).
  - `app/(dashboard)/admin/users/` (server `page.tsx` → client manager + dialogs).
- **Shared bridge:** `lib/forms/action-result.ts` → `ActionResult<T>` + `zodFieldErrors`.
- **Auth:** `lib/auth/dal.ts` → `requireAdmin()` returns `{ sub, role, exp }`.
- **Admin's location:** reuse `getUserLocationId(adminId)` from `lib/users/repository.ts`
  (returns the admin's `location_id` as a string) for a new doctor's `location_id`.
- **`doctors` table** (migration 0001 - unchanged):
  | column | type | notes |
  |---|---|---|
  | `id` | `bigint` | PK identity. **Not UUID** - pg returns it as a **string**. |
  | `name` | `text` | NOT NULL |
  | `department` | `text` | **nullable** |
  | `fee_paise` | `bigint` | NOT NULL, `>= 0` (CHECK). **Integer paise.** pg returns string. |
  | `revisit_validity_days` | `integer` | NOT NULL, `>= 0` (CHECK) |
  | `active` | `boolean` | NOT NULL default `true` |
  | `location_id` | `bigint` | NOT NULL → `locations(id)` |
  | `created_at` | `timestamptz` | default now(). **No `updated_at`/trigger** (unlike users). |
  - **No unique constraints** on doctors (two doctors may share a name) → **no 23505
    handling needed** (simpler than users).
- **Audit helper caveat (must fix - §4C):** `lib/audit.ts` `writeAudit` currently
  **hardcodes `entity = 'user'`**. Generalize it to accept an `entity` argument.
- **Nav:** `lib/nav.ts` lists admin items with some `disabled` placeholders (OPD/IPD/…),
  no Doctors item yet. Add a real `Doctors` link (§5). `lib/nav.test.ts` may assert the
  item list - update it.

---

## 3. Next.js 16 notes
Same as Users: mutations are `"use server"` actions invoked from RHF `handleSubmit` with a
**typed values object** (not `FormData`/`useActionState`); end each with
`revalidatePath("/admin/doctors")`; `requireAdmin()` inside every action.

---

## 4. Decisions (firm)

**A. Money = integer paise, with a new shared, tested `lib/money.ts`.** This is the first
money UI; get it right once and reuse everywhere (services, billing).
  - The **fee is entered in rupees** (string, e.g. `"250"` / `"250.50"`), **validated by
    zod**, and converted to **paise (integer)** in the action before storing. Never parse
    money with `parseFloat` into a calculation - use integer-safe parsing (§5 `lib/money.ts`).
  - Display uses `formatPaise` (formatting only; a display-time `Number(paise)/100` is
    acceptable - the "never float" rule is about storage/calculation, not rendering).

**B. Design - clean, decisive, calm. NO style switcher.** (The Users screen shipped a
3-way "card style" toggle - do **not** repeat that.) Doctor data is tabular
(name/dept/fee/validity/status), so render a **simple table/list**, not busy cards.
Add/Edit via a single shadcn **Dialog** form (consistent with the Users screen's dialog
pattern). Colour for **status only** (active/inactive). No search/filter clutter - the
list is short.

**C. Generalize `writeAudit`.** Change `lib/audit.ts` to
`writeAudit(actorId, action, entity, details)` and update the 5 existing calls in
`lib/users/actions.ts` to pass `"user"`. Doctors pass `"doctor"` with
`details = { doctor_id: id }`. (Doctor ids are BIGINT and *would* fit `entity_id`, but
keep the existing `details`-based convention for consistency; leave `entity_id` NULL.)

**D. No lock-out guards** (doctors aren't logins). Deactivate/reactivate is unguarded.
Never hard-delete - deactivate only (`active=false`), same as users.

---

## 5. Files to create / change

```
lib/
  money.ts               ← NEW, PURE, client-safe: rupeesToPaise / formatPaise / isValidRupees
  money.test.ts          ← Vitest
  audit.ts               ← MODIFY: writeAudit(actorId, action, entity, details)
  users/actions.ts       ← MODIFY: pass "user" to writeAudit (5 calls)
  nav.ts                 ← MODIFY: add real { href:"/admin/doctors", label:"Doctors" }
  nav.test.ts            ← MODIFY: expectations for the new item
  doctors/
    schema.ts            ← zod: newDoctorSchema / updateDoctorSchema / setDoctorActiveSchema (client-safe)
    schema.test.ts       ← Vitest
    repository.ts        ← listDoctors / createDoctor / updateDoctor / setDoctorActive
    actions.ts           ← "use server": create / update / setActive → ActionResult
app/(dashboard)/admin/
  page.tsx               ← add a link/card to /admin/doctors (if the admin home links sections)
  doctors/
    page.tsx             ← server: requireAdmin(); listDoctors(); <DoctorsManager doctors=…/>
    doctors-manager.tsx  ← "use client": table + Add button + edit/deactivate + <DoctorFormDialog/>
    doctor-form-dialog.tsx ← "use client": RHF + zod add/edit form (reuse Users' dialog shape)
```

### `lib/money.ts` (pure, client-safe - the tested core)

```ts
// Integer-safe money. Rupees in the UI, paise in the DB. No float in the parse path.
const RUPEES_RE = /^\d{1,7}(\.\d{1,2})?$/;   // up to ~99 lakh, max 2 decimals

export function isValidRupees(input: string): boolean {
  return RUPEES_RE.test(input.trim());
}

// "250" → 25000, "250.5" → 25050, "250.55" → 25055. Throws on bad input.
export function rupeesToPaise(input: string): number {
  const s = input.trim();
  if (!RUPEES_RE.test(s)) throw new Error(`Invalid rupee amount: ${input}`);
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return paise;
}

// 25000 → "250.00". Grouping is Indian (en-IN). Display only; Number() is fine here.
export function formatPaise(paise: number | string): string {
  const n = typeof paise === "string" ? Number(paise) : paise;
  return (n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

### `lib/doctors/schema.ts` (client-safe; imports the pure `isValidRupees`)

```ts
import { z } from "zod";
import { isValidRupees } from "@/lib/money";

const id = z.string().regex(/^\d+$/, "Invalid id.");          // doctors.id is BIGINT (string)
const name = z.string().trim().min(1, "Name is required.").max(100);
const department = z.string().trim().max(100).optional().or(z.literal(""));
const fee = z.string().trim().refine(isValidRupees, "Enter a valid amount (e.g. 250 or 250.50).");
const revisitValidityDays = z.coerce.number().int("Whole days only.").min(0, "Cannot be negative.").max(3650);

export const newDoctorSchema = z.object({ name, department, fee, revisitValidityDays });
export const updateDoctorSchema = z.object({ id, name, department, fee, revisitValidityDays });
export const setDoctorActiveSchema = z.object({ id, active: z.boolean() });
export type NewDoctorValues = z.infer<typeof newDoctorSchema>;
```

### `lib/doctors/repository.ts` (thin; mirror users/repository.ts)

```ts
export interface DoctorListRow {
  id: string; name: string; department: string | null;
  fee_paise: string;           // BIGINT as string - format with formatPaise
  revisit_validity_days: number; active: boolean; created_at: Date;
}
// listDoctors(): SELECT id, name, department, fee_paise, revisit_validity_days, active, created_at
//   FROM doctors ORDER BY name ASC.   (ALL - client shows active/inactive)
// createDoctor({name, department, fee_paise, revisit_validity_days, location_id}) RETURNING id.
// updateDoctor({id, name, department, fee_paise, revisit_validity_days}).
// setDoctorActive(id, active).
```

### `lib/doctors/actions.ts` (`"use server"`) - mirror users/actions.ts

```ts
// createDoctorAction(input): requireAdmin(); newDoctorSchema.safeParse; 
//   fee_paise = rupeesToPaise(v.fee); location = getUserLocationId(s.sub) (reuse from users repo);
//   createDoctor(...); writeAudit(s.sub,"doctor.create","doctor",{doctor_id:id});
//   revalidatePath("/admin/doctors"); return { ok:true, data:{ id } }.
// updateDoctorAction(input): updateDoctorSchema; fee_paise; updateDoctor(...);
//   writeAudit(...,"doctor.update","doctor",{doctor_id:v.id}); revalidate.
// setDoctorActiveAction(input): setDoctorActiveSchema; setDoctorActive(v.id, v.active);
//   writeAudit(...,v.active?"doctor.activate":"doctor.deactivate","doctor",{doctor_id:v.id}); revalidate.
// No 23505 handling (no unique constraints). No lock-out guards.
```

### UI

- `page.tsx` (server): `await requireAdmin()`, `const doctors = await listDoctors()`,
  render `<DoctorsManager doctors={doctors} />`.
- `doctors-manager.tsx` (client): heading + **Add doctor** button; a **table** with
  columns **Name · Department · Fee (`₹{formatPaise}`) · Revisit validity (`{n} days`) ·
  Status · Actions**. Inactive rows muted. Row actions: **Edit** (opens dialog) and
  **Deactivate/Reactivate** (calls `setDoctorActiveAction`, toast on result). Empty state
  when no doctors. Keep it calm - status is the only colour.
- `doctor-form-dialog.tsx` (client): shadcn `Dialog` + RHF (`zodResolver(newDoctorSchema
  | updateDoctorSchema)`); fields **Name (autofocus) → Department → Fee (₹, `inputMode=
  "decimal"`) → Revisit validity (days, `inputMode="numeric"`)**; submit calls the create
  or update action; map `fieldErrors`/`formError` via `form.setError`; success → close +
  sonner toast. Prefill from the row in edit mode (fee prefilled via `formatPaise`).

---

## 6. Implementation order
1. `lib/money.ts` + `money.test.ts`; `npm test` green.
2. `lib/audit.ts` generalization + fix the 5 `writeAudit` calls in `lib/users/actions.ts`;
   `tsc` clean, users tests still pass.
3. `lib/doctors/schema.ts` + `schema.test.ts`.
4. `lib/doctors/repository.ts`, then `actions.ts`.
5. UI: `page.tsx` → `doctors-manager.tsx` → `doctor-form-dialog.tsx`
   (run `frontend-design` first; `design-audit` after - no style switcher).
6. `lib/nav.ts`: add the Doctors item; update `lib/nav.test.ts`. Link from admin home.
7. Verify (§8); `npx tsc --noEmit` + `npx next build` clean.

---

## 7. Testing (unit - required, dev rules §3)
- **`lib/money.test.ts`:** `rupeesToPaise` - `"250"→25000`, `"250.5"→25050`,
  `"250.55"→25055`, `"0"→0`; throws on `"abc"`, `"1.234"`, `"-5"`, `""`. `formatPaise` -
  `25000→"250.00"`, `2550050→"25,500.50"`, accepts string input. `isValidRupees` boundaries.
- **`lib/doctors/schema.test.ts`:** valid doctor passes; blank name, bad fee (`"abc"`,
  `"1.234"`), negative/non-integer validity → the matching field issue; empty department ok.
- Keep all existing tests green (users, nav, auth). Repository/actions → integration later.

---

## 8. Manual verification
Sign in as admin → `/admin/doctors`:
1. **Add** a doctor (fee `250.50`, validity `7`) → row shows `₹250.50` and `7 days`.
2. Reopen **Edit** → fee prefilled as `250.50`; change to `300` → persists as `30000`
   paise (check DB: `SELECT fee_paise FROM doctors` → `30000`).
3. Bad fee (`abc`, `1.234`) / blank name / negative validity → per-field errors, no write.
4. **Deactivate** → row muted/inactive; **Reactivate** → back. Both audited
   (`SELECT action, details FROM audit_log WHERE entity='doctor'`).
5. Nav shows **Doctors**; active-highlight correct; keyboard: tab/enter through table +
   dialog, Esc closes, Enter submits.
6. `npm test`, `npx tsc --noEmit`, `npx next build` clean. `design-audit` on the table +
   dialog addressed. Light-only; colour = status only.

---

## 9. UX & security (non-negotiable)
- `requireAdmin()` inside every action. Fee/validity re-validated on the server with the
  same zod schema (never trust the client).
- Money stored as **integer paise**; conversion via `rupeesToPaise` (integer-safe).
- Every create/update/activate/deactivate writes an `audit_log` row (actor `s.sub`,
  `entity='doctor'`, `doctor_id` in `details`).
- Never hard-delete. Colour for status only; keyboard-first; light theme.

---

## 10. Out of scope / future
- **Services** master data (same pattern - likely the very next master list).
- **Patients & consultations** (the follow-up plan - will consume `doctors` for
  fee + `revisit_validity_days` via the pure billing rules `isConsultationValid` /
  `isRevisitFree`, which don't exist yet).
- Doctor activity in the admin dashboard feed (`listRecentActivity` filters
  `entity='user'` - extend later).
- `updated_at` on doctors (add a column + trigger later if edit-history matters).
- Search/filter/pagination - unnecessary for a short list.

---

## 11. Definition of done
- [ ] `lib/money.ts` created + unit-tested (integer-safe parse; en-IN formatting).
- [ ] `writeAudit` generalized to take `entity`; existing user actions updated; users
      tests still green.
- [ ] Doctor schema/repository/actions built on the Users patterns; admin-only enforced
      in every action; fee stored as integer paise.
- [ ] `/admin/doctors`: clean table (no style switcher), Add/Edit dialog, deactivate/
      reactivate; light-only, colour = status only.
- [ ] Doctors nav item added; `lib/nav.test.ts` updated.
- [ ] `money.test.ts` + `doctors/schema.test.ts` pass; whole suite green.
- [ ] `npx tsc --noEmit` + `npx next build` clean; `design-audit` addressed.
```
