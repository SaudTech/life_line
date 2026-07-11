# Plan — Void + re-issue (bill correction)

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> `PROJECT_OVERVIEW.md` first. This adds the **only missing safety net under money already
> flowing through the counter**: a way to cancel a wrong finalized bill and issue a corrected
> one, with a full audit trail. **No DB migration — every column already exists.**

---

## 1. Context — why now

Consultations and procedures finalize real bills today, but if the counter finalizes a **wrong**
bill (wrong amount, wrong patient, duplicate, wrong doctor/lines) there is **no correction path**.
`DEVELOPMENT_RULES` is explicit: *nothing is hard-deleted — corrections are **void + re-issue**
with an audit trail.* The plumbing is already in place and unused:

- `bills` columns (`migrations/0001_init.sql`): `status IN ('final','pending_approval','void')`,
  `voided_by`, `voided_at`, `void_reason`, `replaced_by_bill_id`, plus `bills_status_idx`.
- Supervisor approval: `findApproverByPin` (`lib/billing/discount.ts`) + `logFailedPinAttempt`.
- The receipt already renders a **VOID** watermark from `BillDocument.bill.statusLabel`
  (`lib/printing/bill-document.ts`) — reprinting a voided bill Just Works.
- Both history screens + reads exist: `listConsultations` (`lib/consultations/repository.ts`),
  `listProcedureBills` (`lib/procedures/repository.ts`), and their list components (the
  procedures list already has a Reprint/Printer action to mirror).

So this is mostly **wiring**, not new infrastructure. Ship it in **two increments**: Part A (void)
is independently valuable and complete on its own; Part B (re-issue link) builds on it.

---

## 2. Part A — Void a bill (core, ship first)

**A money-reversing action → gated by supervisor approval, fully audited, never destructive.**

### 2a. Server — `voidBillAction(input)` (new action; consultations or procedures `actions.ts`,
or a shared `lib/billing/void.ts` since it's type-agnostic — prefer the shared file)
- `requireSession`. Validate `{ billId, reason, pin }` with zod (`reason` required, trimmed,
  non-empty, sane max length).
- Verify supervisor: `const approver = await findApproverByPin(pin)`. On null →
  `await logFailedPinAttempt({ actorId: s.sub, locationId, context: "void" })` (add `"void"` to
  its context union) and return a field error. (Same pattern as discount approval.)
- **Transaction**, guarded so only a live bill can be voided:
  ```sql
  UPDATE bills
     SET status = 'void', voided_by = $approver, voided_at = now(), void_reason = $reason
   WHERE id = $billId AND status = 'final' AND location_id = $loc
  RETURNING bill_number, type
  ```
  If `rowCount === 0` → the bill was already void / not found / wrong location → return a clear
  error ("This bill can no longer be voided."). **Never** delete or overwrite money columns.
- **Activity log** — new tag `"bill.void"` (tone `danger`) in the registry the feed reads
  (`lib/activity/actions.ts`, mirror `bill.finalize`): `targetId: billId`, `details: { bill_number,
  reason, approved_by: approver.id }`. Log the **approver** as authority + the actor as `actorId`.
- `revalidatePath` both history paths.

### 2b. Consultation-bill side effect (CONFIRMED — required, not optional)
Void applies to **both** bill types. A `consultation` bill also created a `consultations` row that
grants **free-revisit validity**; a voided consultation must **not** keep handing out free
revisits. **DECIDED:** when the voided bill's `type = 'consultation'` and it has a
`consultation_id`, **in the same transaction, expire that consultation's validity** so no revisit
rides on a voided consultation:
```sql
UPDATE consultations
   SET valid_until = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1
 WHERE id = $consultationId
```
(Use the clinic-tz "today minus one day" so a same-day revisit is also blocked; mirror the
`clinicToday()` pattern in `lib/consultations/actions.ts`.) A **procedure** bill has **no** such
side effect — it just voids the bill. (IP later would get its own.) Add a Vitest case asserting a
voided consultation no longer passes the revisit-eligibility check.

### 2c. UI — Void action on both history screens
- `consultations/history/*` list and `procedures/history/procedures-list.tsx`: for a
  `status === 'final'` row, add a **"Void"** action (danger styling — colour for status only).
  Voided rows show a **VOID badge** and **no Void action** (but keep **Reprint** → prints the VOID
  copy).
- **Void dialog** (shadcn Dialog; footer **primary-left / Cancel-right** per the batch-polish
  rule): shows the bill summary (number, patient, total), a **required Reason** textarea, and a
  **Supervisor PIN** field. Submit → `voidBillAction`. Field errors surface inline (bad PIN, empty
  reason); success → toast + row updates to VOID. No silent failure.
- Extend the two history **reads** to also select `status`, `void_reason`, `voided_at`,
  `replaced_by_bill_id`, and the approver/voider name, so the list can render badges + links.
- Optional: a status filter (All / Final / Void) on the history toolbars, reusing the existing
  filter styling.

---

## 3. Part B — Re-issue a corrected bill (link, ship second)

Turns a void into a *correction*: create a new correct bill and link the two.

- **Thread an optional `replacesBillId` through the existing submit actions** —
  `startConsultationAction` (`lib/consultations/actions.ts`) and `submitProcedureAction`
  (`lib/procedures/actions.ts`). When present, **inside the same create transaction** that issues
  the new bill, also `UPDATE bills SET replaced_by_bill_id = <newBillId> WHERE id =
  <replacesBillId> AND status = 'void' AND replaced_by_bill_id IS NULL` (guard: only a voided,
  not-yet-replaced bill can be pointed at a replacement). Log `"bill.reissue"` with both ids.
- **Entry point:** on a **voided** history row, a **"Re-issue corrected"** action that opens the
  matching create flow (consultation or procedure) **pre-filled from the voided bill** — same
  patient, and same doctor (consultation) or same service lines (procedure) — with the
  `replacesBillId` carried through (e.g. flow state or `?replaces=<id>`), so the counter fixes the
  wrong detail and finalizes normally. Reuse the flows as-is; only add prefill + the passthrough.
- **History shows the pair:** the voided row → "Replaced by #<new>"; the new row → "Re-issue of
  #<old>". Both are just the `replaced_by_bill_id` link rendered.
- If Part B prefill proves heavy, a thinner first cut is acceptable: the Re-issue action simply
  opens the flow with the patient preselected and passes `replacesBillId`; full line/doctor prefill
  can follow. The **link + audit** is the essential part, not the prefill.

---

## 4. Edge cases / integrity (money counter)
- **Only `final` bills are voidable**; the SQL guard makes double-void / stale-tab void a no-op
  with a clear message (never a second void).
- **Supervisor PIN required every time** (server-verified, not just UI) — voiding reverses money.
  Failed PINs are logged (`logFailedPinAttempt`, context `"void"`).
- **Nothing is deleted or mutated in money columns** — the bill stays, fully readable/reprintable
  with a VOID watermark; the number is never reused (already guaranteed by the sequence).
- **No cash ledger in Phase 1** — voiding records the reversal; the physical refund/cash handling
  is manual and out of scope (per §Scope). Say so in the reason if relevant.
- **Re-issue link is one-shot** — a voided bill can be replaced once (`replaced_by_bill_id IS
  NULL` guard).
- **Consultation validity** on void — see §2b (the one rule to confirm).
- **Who can initiate:** any counter user may open the Void dialog, but it only completes with a
  supervisor PIN (mirrors discount approval). Admins included.
- **No time limit** — a wrong bill can be corrected next day; everything is timestamped + audited.

## 5. Out of scope
- No cash-drawer / refund accounting. No partial voids (a bill is voided whole, then re-issued
  corrected). No IP (no IP bills exist yet). No changes to the top nav or unrelated screens.

## 6. Definition of done
- [ ] **Part A:** a `final` bill on either history screen can be **voided** with a required reason
      + supervisor PIN; it flips to **VOID** (badge in list, watermark on reprint), stays in the
      system, and writes a `bill.void` activity row (with reason + approver). Bad PIN / empty
      reason / already-void are handled with clear inline errors; failed PINs logged.
- [ ] **Void works for both consultation and procedure bills.** Voiding a **consultation** bill
      also expires its consultation validity in the same transaction (§2b); a **procedure** bill
      voids with no side effect.
- [ ] **Part B:** re-issuing from a voided bill creates a corrected bill and links the pair
      (`replaced_by_bill_id`); history shows "Replaced by / Re-issue of" both ways; `bill.reissue`
      logged.
- [ ] History reads expose `status` + void/replacement fields; dialogs are primary-left /
      Cancel-right; light theme only; **top nav untouched**.
- [ ] New/changed money paths have Vitest coverage (void guard: only-final, only-once; the reissue
      link update). `npm test`, `npx tsc --noEmit`, `npx next build` clean.

## 7. Verify (end-to-end)
1. Finalize a procedure bill → on **procedures history**, click **Void** → enter reason + a wrong
   PIN → rejected + a failed-PIN activity row. Enter a correct supervisor PIN → bill shows **VOID**.
2. **Reprint** the voided bill → PDF carries the **VOID** watermark. Activity feed shows
   `bill.void` with the reason and approver.
3. Try to **Void** it again → blocked ("can no longer be voided").
4. Finalize a **consultation** bill, void it → confirm the patient can **no longer get a free
   revisit** on that consultation (§2b).
5. **Part B:** from a voided bill, **Re-issue corrected** → the flow opens pre-filled → fix the
   amount → finalize → new bill gets its own number; the voided row shows **"Replaced by #N"** and
   the new row **"Re-issue of #M"**; `bill.reissue` logged.
6. `npm test` (void + reissue guards green), `npx next build` clean.

## 8. Next after this
The remaining Phase-1 pillars: **IPD admit → discharge** (the whole in-patient half; tables exist,
no flow yet), then **daily reports / day-close** (bills by type, totals, discounts, cash vs card/UPI,
per-cashier) — void counts will matter there, so reports come after this.
