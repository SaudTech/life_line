# Plan — OP Procedures, Part 2 (OPD): bill service lines against a consultation

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`
> first. **Part 1 is done** (`docs/plans/procedures-part1-admin.md`): the **services
> catalog** and the **`service_lines.modify` permission** exist. This Part 2 builds the OPD
> flow that sells those services against a patient's active consultation. **Mirror the
> existing consultation flow** (`lib/consultations/*`) — it already does 90% of this shape.
> Verify ground truth (§2). No rush; no shortcuts; money must be exact.

---

## 1. Objective & scope

Let an authorized operator **bill procedures/items** (Injection, IV, …) to a patient who
has an **active consultation** — reached **by phone OR by consultation number** — producing
a **`type='procedure'` bill** with service-line items. **No new consultation fee.**

**In scope**
- Find the target: **phone lookup** (reuse) **or consultation-number lookup** (§4C).
- Require an **active** consultation (still within its validity window).
- **Add / edit / remove service lines** (service + quantity) from the active catalog —
  **gated by `service_lines.modify`** so admin *or* a granted user can do it.
- Server-authoritative totals (line price from the DB, integer paise), optional
  supervisor-PIN discount (reuse), payment mode, **save** a finalized procedure bill.

**Out of scope** — see §10 (print, IP procedures, editing a finalized bill, etc.).

---

## 2. Ground truth (mirror the consultation flow)

- **`lib/consultations/actions.ts` + `repository.ts` are your template.** Read them.
  - `createConsultationWithBill` (repository) shows the exact **transaction** pattern: `BEGIN`
    → insert → insert bill (`bill_number` auto via DB default) → `COMMIT` / `ROLLBACK`. Your
    `createProcedureBill` mirrors it (bill + `bill_items`).
  - Bills insert with `status='final'`, `type` literal, `payment_mode`, `discount_approved_by`,
    `created_by`, `location_id`; **do not** set `bill_number` (DB default sequence).
  - **Discounts:** `findApproverByPin` + `resolveDiscountPaise` live (private) in
    `consultations/actions.ts` — **extract them to a shared server module** `lib/billing/discount.ts`
    and have both consultations and procedures import them (don't duplicate). Supervisor/admin
    PIN verified against each approver's scrypt hash.
  - Clinic day via `Asia/Kolkata` (`clinicToday()`), validity reckoned in clinic calendar day.
- **Part 1 gives you:** `listActiveServices()` (active + not trashed) for the picker;
  `hasPermission` / `requirePermission("service_lines.modify")` in `lib/auth/dal.ts`.
- **Billing rules (pure, tested):** `lib/billing/rules.ts` — `computeDiscountPaise`,
  `clampDiscountPaise`, `computeTotalPaise`, `canFinalizeBill`. Use them; **never** re-derive
  money in the UI.
- **Consultation validity rule:** `lib/consultations/rules.ts` — `isConsultationValid(validUntil, on)`.
- **Tables ready (no migration needed):** `bills (type in consultation|procedure|ip,
  consultation_id, subtotal_paise, discount_paise, total_paise, status, payment_mode,
  discount_approved_by, created_by, location_id, bill_number default)`, `bill_items (bill_id,
  service_id, description, quantity, unit_price_paise, line_total_paise)`.
- **Consultations have only a bigint `id`, no friendly code** → §4C decision.
- **Patient lookup:** `findPatientsByPhone` (exact, returns all) already used by the flow.

---

## 3. Next.js 16 notes
Same as the consultation flow: `"use server"` actions from RHF/typed client calls →
`safeParse` → `ActionResult`; transaction in the repository; `revalidatePath`; **permission
gate inside every action** (not just the page).

---

## 4. Decisions (firm)

**A. Gate on the PERMISSION, not the role.** This is the whole point of Part 1B. The page
and every action call **`requirePermission("service_lines.modify")`** (admin implies it;
a granted op-desk/supervisor user passes). Do **not** use `requireRole` here.

**B. A procedure bill = `type='procedure'`, linked to `consultation_id`, no doctor fee.**
`bill_items` are the service lines. **`subtotal_paise = Σ line_total_paise`** (integer sum).
`unit_price_paise` is **snapshotted from the service's current `price_paise`** at sale time
(so later price edits don't rewrite history); `line_total_paise = unit_price_paise × quantity`
(integer). Discount + total via the pure billing rules. `canFinalizeBill` before writing.

**C. Lookup by phone OR consultation number.** Recommended: the **"consultation number" =
the consultation's bigint `id`**, shown in the consultation outcome/history so staff can read
it back (and printed on the receipt once printing exists). Support both entry modes:
  - phone → `findPatientsByPhone` → pick patient → pick one of *their* active consultations;
  - number → `getConsultationByNumber(id)` → the specific consultation.
  *(If you'd rather key off the consultation's receipt `bill_number` instead of `id`, that's
  a fine alternative — pick one, be consistent, and display it wherever the number is shown.
  Don't add a new `consultation_code` migration unless the owner asks.)*

**D. The consultation must be ACTIVE.** Re-check `isConsultationValid(validUntil, clinicToday())`
on the server before allowing lines / saving. Expired → clear message ("This consultation has
expired — start a new consultation"), no write.

**E. Money is server-authoritative.** The client never sends prices — only `serviceId` +
`quantity`. The server looks up each service's price, computes line totals and subtotal, and
the client only ever *displays* server-computed money.

**F. Save-before-anything; no hard delete.** The bill is saved with its number and is
`final`. Correcting a finalized procedure bill = **void + re-issue** later (§10), never edit
in place.

---

## 5. Files to create / change

```
lib/billing/
  discount.ts          ← MOVE findApproverByPin + resolveDiscountPaise here (shared); update consultations to import
lib/procedures/
  schema.ts            ← zod: procedureLineSchema, submitProcedureSchema, lookupSchema (client-safe)
  schema.test.ts       ← Vitest
  repository.ts        ← getConsultationByNumber / getActiveConsultationsForPatient / createProcedureBill (txn)
  lines.ts             ← PURE: computeLineTotal / computeSubtotal (integer paise)  + lines.test.ts
  actions.ts           ← "use server": lookup + previewProcedure + submitProcedure → ActionResult (requirePermission)
app/(dashboard)/procedures/
  page.tsx             ← server: requirePermission("service_lines.modify"); listActiveServices(); <ProcedureFlow/>
  procedure-flow.tsx   ← "use client": lookup (phone/number) → active consultation → line editor → save
lib/nav.ts / nav.test.ts  ← add a "Procedures" item for roles that may have the permission (admin + op_ip_desk;
                            desk roles too since the permission is per-user) — or surface from the consultation outcome.
```

### Pure line math — `lib/procedures/lines.ts` (tested core)
```ts
// Integer paise only. unit price comes from the DB (server), qty from the operator.
export function computeLineTotal(unitPricePaise: number, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Quantity must be ≥ 1.");
  return unitPricePaise * quantity;
}
export function computeSubtotal(lines: { unitPricePaise: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + computeLineTotal(l.unitPricePaise, l.quantity), 0);
}
```

### Repository (mirror `createConsultationWithBill`)
```ts
// getConsultationByNumber(id): SELECT consultation + patient (code/name/phone) + valid_until, doctor name.
// getActiveConsultationsForPatient(patientId, today): consultations still valid, newest first.
// createProcedureBill({ consultationId, patientId, lines[], subtotalPaise, discountPaise, totalPaise,
//   paymentMode, discountApprovedBy, createdBy, locationId }):  BEGIN
//     INSERT bills (patient_id, type='procedure', consultation_id, subtotal_paise, discount_paise,
//       total_paise, status='final', payment_mode, discount_approved_by, created_by, location_id)
//       RETURNING id, bill_number;
//     for each line: INSERT bill_items (bill_id, service_id, description, quantity, unit_price_paise, line_total_paise);
//   COMMIT → { billId, billNumber }.  ROLLBACK on error.
```

### Actions (`"use server"`) — all `await requirePermission("service_lines.modify")`
```ts
// lookupForProcedureAction(input): by phone → patients + their active consultations;
//   by number → the one consultation. Returns enough to render the target + validity.
// previewProcedureAction({ consultationId, lines:[{serviceId, quantity}] }): re-price from DB,
//   compute line totals + subtotal (server), return the money for display. (No write.)
// submitProcedureAction(input): validate; re-check consultation ACTIVE; re-price EVERY line from
//   listActiveServices/service lookup (ignore any client price); compute subtotal;
//   resolve optional discount via shared findApproverByPin + billing rules; canFinalizeBill;
//   createProcedureBill(...); logActivity bill.create + bill.finalize (+ discount.approve);
//   revalidatePath; return { billNumber, totals, ... }.
```
> Snapshot rule: read each line's `unit_price_paise` from the **service row now**, store it on
> the `bill_items` row. Never trust a price sent from the client.

### UI (`procedure-flow.tsx`)
- **Step 1 — find:** one input that takes **phone or consultation number** (a small
  toggle/segmented control, or auto-detect: all-digits short = phone, prefixed/other = number).
  Phone → list patients (mother+child) → pick → list *their* active consultations → pick.
  Number → resolve directly. Show the chosen **patient + consultation** (code, doctor,
  valid-until) and block if expired.
- **Step 2 — lines:** add rows: **service `Select`** (from `listActiveServices`) + **quantity**.
  Each row shows the line total (server-priced on preview); a **running total is ALWAYS
  visible** (dev-rules §5). Add/remove rows. This whole step is what `service_lines.modify`
  authorizes.
- **Step 3 — settle:** payment mode; optional discount (supervisor **PIN**, reuse the
  consultation dialog pattern); **Save** → show `Saved ✓ #{billNumber}`. Keyboard-first:
  Tab order, Enter advances/saves, focus management; nothing moves.
- Light-only shadcn tokens, colour = status only, no card-style switcher. `frontend-design`
  before; `design-audit` after.

---

## 6. Implementation order
1. Extract `lib/billing/discount.ts` (move + rewire consultations to import it); tests green.
2. `lib/procedures/lines.ts` + `lines.test.ts`; `lib/procedures/schema.ts` + `schema.test.ts`.
3. `lib/procedures/repository.ts` (lookup + `createProcedureBill` transaction).
4. `lib/procedures/actions.ts` (lookup → preview → submit; all permission-gated).
5. UI: `page.tsx` → `procedure-flow.tsx`. Nav item.
6. Verify (§8); `npx tsc --noEmit` + `npx next build` clean.

---

## 7. Testing (unit — required, money is critical)
- **`lib/procedures/lines.test.ts`:** `computeLineTotal` (qty×price; rejects qty<1/non-int);
  `computeSubtotal` (sum of lines, empty = 0, large values stay exact integers).
- **`lib/procedures/schema.test.ts`:** valid submit passes; qty 0/negative/non-int, empty
  lines, bad serviceId → field errors; lookup input (phone vs number) validation.
- Keep the billing-rules tests green (discount/total). Repository/actions (DB) → integration later.

---

## 8. Manual verification
1. As **admin**: start a consultation for a patient (existing flow), note the **consultation
   number**. Go to `/procedures`, look up by that number → shows the patient + active consultation.
2. Add "Injection ×2" + "IV ×1" → running total = server-priced sum; **Save** → `Saved ✓ #N`.
   Check DB: a `type='procedure'` bill with `consultation_id` set, `subtotal = Σ line_total`,
   and matching `bill_items` (unit_price snapshotted).
3. Look up the **same patient by phone** → their active consultation(s) listed → add a line → save.
4. **Expired** consultation → blocked with a clear message, no bill written.
5. **Permission:** create a non-admin user **without** `service_lines.modify` → they can't reach
   `/procedures` (bounced) and the action refuses. Grant it → they can. Admin always can.
6. Discount path: apply a discount → supervisor PIN required + verified; total server-computed;
   `discount.approve` logged.
7. `npm test`, `npx tsc --noEmit`, `npx next build` clean; `design-audit` addressed; light-only.

---

## 9. Activity logging
`bill.create` + `bill.finalize` (entity `bill`, target `billId`, details incl. `bill_number`,
`total_paise`, `consultation_id`, `payment_mode`); `discount.approve` when discounted. (Tags
already in the registry.) Never log secrets.

---

## 10. Out of scope / future
- **A4 receipt printing** (save-before-print is respected: the bill is saved with its number
  now; printing is a separate step later).
- **Editing / voiding a finalized procedure bill** — corrections are **void + re-issue**
  (needs a small void flow later, per dev-rules §4).
- Surfacing "Add procedure" **inline right after a consultation** (same visit) — the shared
  core built here makes this a thin follow-up; do the standalone flow first.
- IP (in-patient) procedures / discharge itemisation — a separate IPD track.
- A dedicated `consultation_code` — using the bigint `id`/`bill_number` for now (§4C).

---

## 11. Definition of done
- [ ] Discount helpers shared in `lib/billing/discount.ts`; consultations still work.
- [ ] `/procedures` gated by `requirePermission("service_lines.modify")` (page + every action).
- [ ] Look up a patient's **active** consultation by **phone or consultation number**; expired
      consultations refused.
- [ ] Add/remove **service lines**; totals are **server-authoritative** integer paise; optional
      supervisor-PIN discount; a **`type='procedure'`** bill + `bill_items` saved in one transaction,
      linked to the consultation.
- [ ] `lines.ts`/`schema.ts` unit-tested; whole suite green.
- [ ] `bill.create`/`bill.finalize` (+ `discount.approve`) logged; nothing hard-deleted.
- [ ] Procedures nav item; `nav.test.ts` updated.
- [ ] `npx tsc --noEmit` + `npx next build` clean; `design-audit` addressed; light-only.
```
