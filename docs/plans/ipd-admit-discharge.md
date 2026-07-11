# Plan — IPD: admit → discharge (in-patient billing)

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> `PROJECT_OVERVIEW.md` first. This adds the **last untouched core money flow**: in-patient
> admission, a running expense tally over the stay, and discharge with the advance/refund balance.
> Ship in **two increments**: **Part 1 (admit + running expenses)** and **Part 2 (discharge +
> itemised bill + A4 invoice)**. Part 1 is independently useful.

---

## 1. Context — what IPD is, and why now

OP is same-day (walk in, pay, leave). **IPD is a stay:** admit a patient to a bed, charges
accumulate over days, then settle at discharge. It's the one Phase-1 pillar with **zero code** —
the tables exist (`admissions`, `admission_expenses`) but no flow, route, rule, or UI. Everything
else (patients, paise money, discounts + supervisor approval, receipts, void/re-issue) is built and
**reused** here, so this is mostly assembling proven pieces around two genuinely new ideas:

1. **An open running bill across days** (expenses added over the stay, not one moment).
2. **The advance-vs-total balance** at discharge — a **payable balance OR a refund**
   (`PROJECT_OVERVIEW §In-Patient`): **`payable = (room + itemised expenses) − discount − advance`**;
   if advance exceeds the total it's a **refund that must be shown explicitly, never ignored**.

**Roles (`PROJECT_OVERVIEW §Roles`):** only **`op_ip_desk`** and **`admin`** may admit/discharge.
**`op_desk` cannot.** Enforce on the server (the `CONSULT_ROLES = ["admin","op_ip_desk"]` pattern in
`lib/consultations/actions.ts` is the model — make an `IP_ROLES` constant).

---

## 2. What exists / what's reused (don't rebuild)
- **Tables:** `admissions` (`patient_id, admitted_at, discharged_at, advance_paid_paise,
  room_charge_paise, status IN ('admitted','discharged'), location_id`) and `admission_expenses`
  (`admission_id, item TEXT, quantity, total_paise`) — `migrations/0001_init.sql`.
- **Money + rules:** `lib/money.ts` (paise), `lib/billing/rules.ts`
  (`computeTotalPaise`, `canFinalizeBill`), `lib/billing/discount.ts`
  (`resolveDiscountPaise`, `findApproverByPin`, `logFailedPinAttempt`).
- **Patient lookup:** the phone lookup used by consultation/procedure intake (reuse the
  component + `lib/patients` reads; register-if-new too).
- **Receipts:** `BillDocument` already has a typed **`ip` branch**
  (`lib/printing/bill-document.ts:49` — `admittedText, dischargedText, roomChargeText, advanceText,
  expenses[], balanceText`) and `lib/printing/fields.ts` already lists the IP fields. The `ip`
  bill-type is currently **disabled** in the receipts library and the resolver's `ip` branch is
  guarded — Part 2 turns both on.
- **Bill write pattern:** `createProcedureBill` (`lib/procedures/repository.ts`) is the exact
  `BEGIN/INSERT bill + bill_items/COMMIT` template for the discharge bill.

## 3. Schema gaps — one small migration (Part 2)
`migrations/0011_ip_admission_bill_link.sql` (forward-only):
- **`ALTER TABLE bills ADD COLUMN admission_id BIGINT REFERENCES admissions (id);`** + an index
  — the discharge bill (`type='ip'`) must point back to its admission, mirroring how
  `consultation_id` was added in `0006` for consultation bills. Nullable (OP bills have none).

Not needed now (note only): `admissions` has no `doctor_id` / room label, and `admission_expenses`
has no `location_id`/`created_at` — the documented data model omits them and the balance rule
doesn't need them. Leave them out to keep scope tight; add later if records demand it.

## 4. Navigation — one additive entry (heads-up, not a redesign)
IPD needs a reachable destination. Add **one** nav item (e.g. "Admissions") in
`lib/nav.ts` `navItemsForRole`, shown **only for `op_ip_desk` + `admin`**. This is an *additive*
destination for a new feature — **not** a restyle of the bar and **not** touching any other nav
item. (Flagging because the owner is protective of the nav; confirm the label.)

---

## 5. Part 1 — Admit (IN) + running expense tally

### 5a. Pure rule — `lib/billing/discharge.ts` (write now, used fully in Part 2)
The single source of truth the rules name (`DEVELOPMENT_RULES §1`:
`calculateDischargeBalance(expenses, advance)`). Signature:
```ts
calculateDischargeBalance(input: {
  roomChargePaise: number;
  expenses: { totalPaise: number }[];
  advancePaise: number;
  discountPaise: number;   // already resolved (pct/amount → paise) by resolveDiscountPaise
}): {
  subtotalPaise: number;      // room + Σ expenses
  discountPaise: number;      // clamped ≤ subtotal
  totalPaise: number;         // subtotal − discount
  advancePaise: number;
  balanceDuePaise: number;    // max(0, total − advance)
  refundPaise: number;        // max(0, advance − total)
}
```
**Vitest required**, covering the edge cases the rules call out: **advance > total → refund**
(balanceDue 0), **zero expenses**, discount clamped to subtotal, discount-with-no-approval rejected
upstream. Integer paise only — never a JS float in the money path.

### 5b. Admit flow — `app/(dashboard)/admissions/` (new route, `IP_ROLES`-gated)
- **Find or register the patient** (reuse the phone-lookup intake used by consultation/procedure;
  register-if-new is the same path).
- **Record the advance:** amount (rupees → paise via `lib/money`), payment mode
  (`cash|card|upi|other`), optional room charge (can be entered here or deferred to discharge).
- **Transaction (admission + advance):** insert one `admissions` row (`status='admitted'`,
  `advance_paid_paise`, `room_charge_paise`, `location_id`) — wrap per `DEVELOPMENT_RULES §transaction`.
- **Activity log:** new tag `"admission.admit"` (registry in `lib/activity/actions.ts`),
  `details: { patient, advance_paise }`.

**Advance-deposit receipt (REQUIRED — the patient's proof of the advance).** After the admission
is saved, the desk can **print an A4 "Advance Deposit Receipt"** so the patient/family has proof of
the money handed over. This is **not** a `bills` row (no bill exists until discharge), so:
- Build a small `AdvanceReceiptDocument` (reuse `hospital_profile` header + `formatPaise` +
  amount-in-words + the clinic-tz date, exactly like `BillDocument`): hospital block, patient
  (code/name), **reference = admission id** (the "receipt number" for proof), admitted date,
  **advance amount + amount in words**, payment mode, a "Advance Deposit Receipt" title.
- Render it through the **same pdfme generator + font + print path** already built for bills
  (save-before-print: the admission is saved first, then print; reprintable). Use a **built-in
  fixed A4 layout** for now (`lib/printing/defaults/advance-receipt`), rendered by its own route
  `GET /api/receipts/advance/[admissionId]/pdf` (auth-gated). It is **not** admin-editable in the
  receipts designer yet — note it as a later graduation into the template library (that would mean
  a new template kind; out of scope here to keep Part 1 lean).
- Log `"admission.advance_printed"` (best-effort, like `receipt.printed`).

### 5c. Admitted list + running expenses
- **Admissions list** (design system = `admin/users/users-manager.tsx`): currently-**admitted**
  patients (`status='admitted'`), each → an admission detail screen. A tab/filter for
  **discharged** history too.
- **Expense tally** on the detail screen: add `admission_expenses` rows over the stay. **Expenses
  are STRICTLY from the services catalog** (no free-text) — pick a service via the existing
  `ServiceCombobox`; the `item` text is the service name and the price is the catalog
  `price_paise` × quantity, **re-priced server-side** from the live catalog on every add (never
  trust the client's amount — same `repriceLines` discipline as procedures). Store `item`
  (service name snapshot), `quantity`, `total_paise`. Show a **live running total** (room + Σ
  expenses) so the desk always sees the current bill. Each add/remove is its own small server
  action + activity row (`"admission.expense_added"` / removed).
- Because expenses are catalog-only, the **services catalog must be rich enough to cover ward
  charges** — see §5d (seed).
- **Mobile:** running total always visible (dev-rules §5), like the procedure flow's bottom bar.

### 5d. Seed a rich services catalog (for testing — required)
Because IP expenses are **catalog-only**, and to exercise a wide range while testing, add
`scripts/seed-services.mjs` + a `"seed:services"` npm script (mirror `scripts/seed-doctors.mjs`
exactly: reads `DATABASE_URL`, first location as `location_id`, idempotent-ish — skip if services
already exist, prices as integer paise). Seed **~25-35 services spanning the real ward/OPD range**
so both procedures and IP discharge have plenty to pick from, e.g.:
- **Injections/IV:** IV Fluids (DNS/NS), IM Injection, IV Antibiotic dose, Insulin dose.
- **Dressings/minor:** Small/Large Dressing, Suturing, Catheterisation, Nebulisation, Oxygen (per hr).
- **Room/bed (per day):** General Ward Bed, Semi-Private Room, Private Room, ICU Bed.
- **Nursing/care:** Nursing Charge (per day), Monitoring Charge, Physiotherapy session.
- **Diagnostics:** ECG, X-Ray, Blood Sugar, CBC, Urine Routine.
- **Procedures/sundries:** Dressing Tray, Consumables Kit, Ambulance, Medical Certificate.

Prices realistic and varied (₹50 - ₹5,000) so totals, discounts, and refund math get a real
workout. (Room/bed items live in the catalog too, but note the discharge screen also has the
dedicated `admissions.room_charge_paise` field per §3 — the desk can use either; keep them
distinct in testing.)

**Part 1 acceptance:** an `op_ip_desk`/admin can admit a patient with an advance **and print an
advance-deposit receipt**, see them in the admitted list, and add catalog-only itemised expenses
with a live running total. Nothing discharges yet.

---

## 6. Part 2 — Discharge (OUT) + itemised bill + A4 invoice

### 6a. Discharge action — `lib/admissions/actions.ts` (`IP_ROLES`-gated)
Open an admitted patient → confirm the **room charge** + all **expenses** → optional **discount**
(supervisor PIN, reusing `findApproverByPin` + `logFailedPinAttempt` context `"discharge"`; a
discount without approval is rejected by `canFinalizeBill`) → compute with
`calculateDischargeBalance` → collect the **balance** (payment mode) **or** record the **refund**.

**One transaction (discharge + final bill)** — mirror `createProcedureBill`:
1. Insert `bills` (`type='ip'`, `admission_id`, `subtotal/discount/total_paise`,
   `payment_mode`, `discount_approved_by`, `created_by`, `location_id`) → DB-issued `bill_number`.
2. Insert `bill_items`: **room charge as one line** (`description:"Room charge", quantity:1,
   unit_price=line_total=room_charge_paise`) + **each expense as a line**. Expense → bill_item
   mapping: to keep money exact (no division), store `quantity:1, unit_price=line_total=
   expense.total_paise, description:"<item> ×<qty>"` (the original qty lives in the text). Note this
   mapping choice in code.
3. `UPDATE admissions SET status='discharged', discharged_at=now(), room_charge_paise=$ WHERE id=$
   AND status='admitted'` — **guarded** so a double-discharge writes nothing (like the void guard).
4. Activity: `"admission.discharge"` with `bill_number`, `total_paise`, `balance_due`/`refund`.

Guard: refuse discharge if `status != 'admitted'` → clear error, never a second bill. **Refund
(advance > total) must be shown and recorded explicitly** — display it, put it on the invoice; cash
handout is manual (no cash ledger in Phase 1).

### 6b. Turn on IP receipts
- Implement the resolver's **`ip` branch** in `lib/printing/bill-document.ts` (fill
  `admittedText/dischargedText/roomChargeText/advanceText/expenses[]/balanceText` from the admission
  + its bill; reuse `formatPaise` + the clinic-tz date pattern; `balanceText` shows **Balance due**
  or **Refund**). The fields already exist in `fields.ts`.
- **Seed a default `ip` template** (`lib/printing/defaults/`) and **un-disable `ip`** in the
  receipts library + editor (`receipts-library-redesign.md` left it disabled). The A4 discharge
  invoice then prints through the same designer/print path as OP — **save-before-print**, reprint
  as DUPLICATE, VOID if voided (all already built).
- Void/re-issue already covers `type='ip'` generically; the discharge bill can be voided like any
  other (its admission-side effect, if any, is out of scope — note it).

**Part 2 acceptance:** discharging produces a correct itemised `type='ip'` bill (room + expenses −
discount − advance = balance/refund), flips the admission to discharged, and prints an A4 invoice.

---

## 7. Edge cases / integrity (money counter)
- **Balance vs refund** both handled; refund never silently dropped (rules).
- **Discount needs supervisor approval** (server-verified PIN, `canFinalizeBill` mirrors the DB
  `bills_discount_needs_approval` constraint). Failed PINs logged (context `"discharge"`).
- **Double-discharge / stale tab** → guarded UPDATE writes nothing, clear message, one bill only.
- **Zero expenses** (room-only, or even room 0) computes cleanly.
- **All money integer paise, server-authoritative** — expenses re-priced server-side; the UI shows
  only what the server returns (no client-side balance formula — `DEVELOPMENT_RULES §26/27`).
- **Role**: admit/discharge server-gated to `op_ip_desk`+admin; `op_desk` blocked even if UI leaks.
- **Transactions** wrap admission+advance and discharge+bill (all-or-nothing).

## 8. Out of scope
Room/bed availability tracking, per-day room auto-accrual (room charge is a single figure the desk
sets), cash-drawer/refund accounting, IP discount approval queue beyond PIN, doctor-on-admission,
thermal print. (All noted in `PROJECT_OVERVIEW §Out of scope`.) No nav *redesign* — only the one
additive Admissions entry (§4).

## 9. Definition of done
- [ ] `calculateDischargeBalance` is pure + Vitest-covered (refund, zero expenses, discount clamp).
- [ ] **Part 1:** admit with advance (transaction) → **print an A4 advance-deposit receipt** →
      admitted list → add/remove **catalog-only** itemised expenses (server-re-priced) with a live
      running total; all `op_ip_desk`/admin-gated; activity logged.
- [ ] `scripts/seed-services.mjs` + `npm run seed:services` seeds ~25-35 varied ward/OPD services.
- [ ] Migration `0011` adds `bills.admission_id`.
- [ ] **Part 2:** discharge computes room+expenses−discount−advance = balance/refund, writes a
      `type='ip'` bill + bill_items + flips admission (one guarded transaction), and prints an A4
      invoice via the receipt designer (IP template seeded + un-disabled; resolver `ip` branch live).
- [ ] Discount on discharge needs a supervisor PIN; refund shown explicitly; double-discharge
      blocked. `op_desk` cannot admit/discharge (server-enforced).
- [ ] One additive nav entry for op_ip_desk+admin; no other nav change. Dialogs primary-left /
      Cancel-right; light theme only.
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` clean.

## 10. Verify (end-to-end)
0. `npm run seed:services` → the catalog is populated with a wide range of ward/OPD items.
1. As `op_ip_desk`: **Admit** a patient with a Rs 5,000 advance → **print the advance-deposit
   receipt** (A4, shows amount + amount-in-words + patient + admission ref) → patient appears in
   the admitted list. As `op_desk`: the Admissions destination/action is **not available**
   (server-blocked).
2. Add a few **expenses** picked **from the catalog** (IV Fluids ×2, ECG, Nursing Charge) → the
   **running total** updates live and is server-priced from the catalog (client amount ignored).
3. **Discharge:** confirm charges, apply a discount with a **supervisor PIN** → the invoice shows
   **subtotal − discount − advance = balance due**; collect it → an A4 `ip` invoice prints.
4. **Refund path:** admit with a large advance, few expenses, discharge → invoice shows a **Refund**
   (balance due 0), recorded, not ignored.
5. Try to **discharge again** → blocked. **Void** the discharge bill → prints with VOID watermark.
6. `npm test` (discharge-balance edges green), `npx next build` clean.

## 11. After this
**Daily reports / day-close** — the final Phase-1 item. Now that OP *and* IP bills plus voids all
exist, a report can be complete: bills by type (consultation/procedure/ip), totals, discounts,
cash vs card/UPI, per-cashier, admissions/discharges, and void counts.
