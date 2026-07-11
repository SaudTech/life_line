# Life Line Hospital - Development Rules

A working reference for how this system is built. The app is a **billing counter tool used ~144 times a day**, with **real money on every screen**. That shapes every rule below. When in doubt, favour **speed, certainty, and correctness** over cleverness or features.

---

## 1. First Principles (non-negotiable)

1. **The counter must feel instant.** A patient is standing there. Any wait, spinner, or hunt for a button is paid back 144 times a day.
2. **Money logic must be provably correct.** Every rule that touches money is a pure function with unit tests. If it isn't tested, it isn't done.
3. **Saving must never fail silently or ambiguously.** The staff must always *know* the bill saved. Uncertainty causes double-charging.
4. **Design for the expert, not the newcomer.** After week one, staff run on muscle memory. Optimise for the thousandth use, not the first.
5. **Keep it simple.** One small, understandable stack. Don't add features, layers, or tools nobody asked for. You are the person who has to fix this at 2pm.

---

## 2. Code Structure (so it can be tested)

- **Separate the three layers:** business logic (rules), data access (DB), and UI. Never mix them.
- **All billing rules live in plain, pure functions** - no database, no UI, no side effects. Same input always gives same output. These are the functions you test.
  - `calculateDischargeBalance(expenses, advance)`
  - `isConsultationValid(consultation, doctor, today)`
  - `canFinalizeBill(bill, approval)`
  - `isRevisitFree(patient, doctor, lastConsultation, today)`
- **API routes stay thin.** A route validates input, calls a rule function, reads/writes the DB, returns a result. No business logic buried inside routes.
- **No logic in the UI.** The screen displays and collects; it does not calculate balances or decide validity. Ask the server.
- **One source of truth per rule.** The discharge-balance formula exists in exactly one function. Never re-implement it in the UI "just to show a preview."

---

## 3. Testing Rules

- **Every money/rule function has unit tests** before it's considered finished. Use **Vitest**.
- **Cover the edge cases, not just the happy path:** advance bigger than the bill (refund), zero expenses, consultation on the exact expiry day, discount with no approval.
- **Integration tests** hit a **separate test Postgres database** - never the real one.
- **E2E tests (Playwright)** come later, only for the core counter flow, once the app is stable. Don't start here.
- A test must **fail loudly** when the rule breaks. A test that can't fail is worthless.
- Run tests before every deploy to the clinic. A green run is the gate.

---

## 4. Money & Data Correctness

- **Never store or calculate money as a floating-point number.** Use integer minor units (paise) or a decimal type. JS floats will silently corrupt totals.
- **Every bill gets its ID/number and is saved *before* anything is printed.** The number comes from the database, is unique, and never reused.
- **Saving and printing are separate steps.** Save always succeeds (local DB). Print is a second, retryable action from the saved record.
- **Nothing is silently deleted.** Corrections happen by void + re-issue, leaving a trace. Every bill is reprintable.
- **Keep an audit trail:** who created/voided/approved what, and when.
- **Wrap multi-step writes in a transaction** (e.g. admission + advance, or discharge + final bill) so they save fully or not at all.
- **`location_id` on every core table** from day one, even with one branch. Never build branch *features* yet - just the column.
- **Index the hot columns:** patient phone, billing date, `location_id`. The phone lookup runs constantly.
- **A patient is identified by a unique auto-generated Patient ID, never by phone.** Phone is a non-unique lookup field - several patients can share one (mother + child). Never merge or assume one-patient-per-phone.

---

## 5. Counter UX / Design Rules

- **Keyboard-first.** The whole receipt is completable without the mouse. `Tab` follows the real-world field order; `Enter` saves. The mouse is optional, never required.
- **No confirmation popups on routine actions.** "Are you sure?" 144 times a day is noise staff learn to ignore. Make actions **reversible** (void/reprint) instead of guarded.
- **Dialog action order = tab order = primary first.** In any add/create/edit dialog, the **primary action** (the one `Enter` submits, e.g. "Save & add another") is the **first focusable control after the last field** and sits on the **left**, so a single `Tab` from the last input reaches it - never three. Secondary saves (e.g. "Save & close") follow it. `Close`/`Cancel` sits at the **right end** and is reached last. Never make the user tab past Cancel or secondary buttons to get to the main action. This ordering is a project-wide rule - apply it to every dialog, not just this one.
- **Fixed, predictable layout.** The doctor field, the total, and the Save button are *always in the same place*. Muscle memory depends on nothing moving.
- **The happy path is one screen, top to bottom.** New patient → doctor → save → print, in a straight line. No wizards, no tabs for the 90% case.
- **Always visible, never scrolled to:** patient name, running total, and save status.
- **Honest system state.** Show a clear `Saved ✓ #1042` the instant it saves. Show `Pending Approval` in amber. Never leave the user guessing.
- **Right input type per field.** A field that holds a *quantity* (age, count, days, a rupee amount) uses `type="number"` with `inputMode="numeric"` (or `"decimal"` for money) and a sensible `min`, so the number keypad shows on mobile and the value reads/validates as a number. A field that holds a *digit string that is not arithmetic* (phone, PIN, patient/bill codes - leading zeros matter, you never add them) stays `type="tel"`/`type="text"` with `inputMode="numeric"`. Never leave a numeric quantity as a plain text field.
- **Calm visuals.** No decoration, no animation, no competing colours. Reserve colour for status only (saved = green, pending = amber, error = red).
- **Preload static data** (doctors, services, items) when the app opens. Picking a doctor is instant, not a fresh query.
- **The judgement test for any screen:** *Can a trained user do this without thinking, without the mouse, without waiting, and know for certain it worked?* If any answer is "no," fix that first.

---

## 6. Speed Rules

- **No internet round-trip on the counter hot path.** The DB is local and on the same LAN - keep it that way.
- **One shared database connection pool**, created once and reused. Never reconnect per request. Turn on keepalive.
- **Optimistic UI where safe:** confirm the action immediately, persist in the background - but still confirm the *actual* save landed.
- **Don't over-engineer for scale you don't have.** 144 receipts/day is tiny. No caching layers, queues, or replicas until a real bottleneck appears.
- **Measure before optimising.** If something feels slow, find the actual query or render causing it; don't guess.

---

## 7. Reliability & Failure Handling

- **Assume the printer will fail** (out of paper, offline). The bill is already saved with its number; printing is retryable and never creates a duplicate.
- **The app auto-restarts on crash or reboot** (PM2) and auto-starts on machine boot.
- **The DB pool recovers automatically** after a Postgres restart; wrap queries so a transient error retries instead of crashing the route.
- **Daily automated backups**, plus a periodic *manual* verification that a backup can actually be restored. A backup you've never restored is a guess.
- **Recommend a UPS** (battery backup) on the server PC to the client - a power blip shouldn't stop every counter.

---

## 8. Access & Security

- **Enforce roles on the server, not just in the UI.** Hiding a button is not security; the API must reject actions the role can't perform.
- **Discounts require approval** - Supervisor PIN (instant) or on-screen approve/decline. A bill with an unapproved discount cannot finalise.
- **Passwords are hashed**, never stored in plain text. Same for PINs.
- **Each user has their own login** so the dashboard and audit trail are per-person.

---

## 9. General Development Discipline

- **Pin versions** (Node, Postgres, key packages). Install the same versions on the clinic PC via `npm ci` + a setup script. This is your "works on every machine" guarantee - not Docker (not needed yet).
- **A setup script** installs and starts everything reproducibly, so deployment isn't a manual ritual.
- **Small, boring, debuggable choices** win over impressive ones. You maintain this alone.
- **Write down decisions** (like this file). Update it when a rule changes.
- **Don't build for a future that isn't confirmed.** Multi-branch, pharmacy, lab, insurance - leave the door open (data model), build nothing until asked.

---

*The one-line summary: build the money logic as tested pure functions, keep the counter screen instant and keyboard-driven, always save before you print, and never make the staff wonder whether it worked.*
