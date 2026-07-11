# Plan — Batch Polish & Hardening (multi-agent)

> **For the orchestrating session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`
> first. This is a batch of mostly-independent improvements. **Run them as separate agents
> in parallel where marked**, then a final QA agent. Each workstream brief below is
> **self-contained** — an agent can execute it alone. **Ownership is partitioned by FILES/
> ROUTES so parallel agents don't collide.**

---

## 0. Orchestration

| Agent | Workstream | Items | Owns (files/routes) | Parallel group |
|---|---|---|---|---|
| **A** | Admin master-data screens | 1,3,4 | `app/(dashboard)/admin/{users,doctors,services}/**` | ① parallel |
| **B** | Operational screens | 1,2,3,4 | `app/(dashboard)/{patients,consultations,procedures}/**` | ① parallel |
| **C** | Top bar | 1,6,7 | `app/(dashboard)/top-nav.tsx`, `app/(dashboard)/layout.tsx` | ① parallel |
| **D** | PIN-failure logging | 5 | `lib/billing/discount.ts`, `lib/consultations/actions.ts`, `lib/procedures/actions.ts`, `lib/activity/actions.ts` | ① parallel |
| **E** | Review / edge-cases / mobile QA | 1,8 | read-all; fixes across the app | ② **after A–D** |

- **A, B, C, D run concurrently** (disjoint files). **E runs last** (it reviews + verifies
  the others and does the final mobile sweep).
- Every agent, before finishing: `npm test` green, `npx tsc --noEmit` clean, `npx next build`
  clean. **Light theme only** (semantic tokens, no `dark:`), **no card-style switcher**,
  keyboard-first. Change only your owned files; if you must touch a shared file, note it for E.

---

## 1. Shared conventions (ALL agents follow — kept as spec, not shared code, to avoid collisions)

**Design reference = the User Management screen.** `app/(dashboard)/admin/users/users-manager.tsx`
is the canonical look (toolbar, cards/table, spacing, empty states, semantic tokens). Every
list/manager screen must match its visual system. If any leftover "card style A/B/C switcher"
exists anywhere, **remove it** — it is not part of the design.

**Dialog footer button order (item 4) — the standard everywhere:**
the **primary/confirm action on the LEFT, Cancel on the RIGHT.** (Yes, left — the owner wants
this.) Apply to every popup form/dialog. Example:
```tsx
<DialogFooter className="flex-row justify-start gap-2">
  <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
  <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
</DialogFooter>
```
Keep it identical across all dialogs so muscle memory holds.

**Mobile (item 1) — every screen must be functional AND clean on a phone:**
- No horizontal page scroll. Wide tables either become **stacked cards** on small screens or
  live in an `overflow-x-auto` container — never overflow the body.
- Tap targets ≥ ~40px; toolbars/filters wrap, don't clip.
- Dialogs/sheets fit small viewports (scroll inside, not the page); inputs full-width.
- Use responsive utilities (`sm:`/`md:`), test at ~360px width.

---

## 2. Workstream briefs

### Agent A — Admin master-data screens (items 3, 4, 1)
Scope: `admin/users`, `admin/doctors`, `admin/services` (managers + their dialogs).
- **Item 3:** make **doctors** and **services** managers match the **users** screen's design
  system (they were built as clones but confirm they're visually consistent — toolbar, table/
  cards, spacing, empty states, tokens). Users is the reference; align the other two to it.
- **Item 4:** all dialogs in these routes → primary-left / Cancel-right (§1).
- **Item 1:** these three screens fully responsive (§1).
- Acceptance: the three admin lists look like one family; dialogs consistent; mobile clean.

### Agent B — Operational screens (items 2, 3, 4, 1)
Scope: `patients`, `consultations` (+`/history`), `procedures` (+`/history`).
- **Item 2 — Procedures date filter redesign** (`app/(dashboard)/procedures/history/procedures-list.tsx`):
  - Give the filter control a **solid white/`bg-popover` background** (currently no bg).
  - Replace the always-visible From/To date inputs with a **preset picker** showing
    **`Today` · `Yesterday` · `This Week` · `Range`** (a shadcn `Popover`/`Select`/segmented).
  - Only when **`Range`** is chosen do the **From/To date fields appear**; on choosing dates
    and clicking **OK**, the popover **closes** and the list re-filters to that range.
  - Presets compute their ranges in the **clinic timezone** (`Asia/Kolkata`, see
    `lib/consultations/actions.ts` `clinicToday()` for the pattern). Keep the pure date-range
    logic in a small tested helper (e.g. `lib/procedures/date-range.ts` + test).
  - Apply the **same filter pattern to the Consultations history** filter if it has one, for
    consistency (item 3 spirit).
- **Item 3:** patients / consultations-list / procedures-list match the users design system.
- **Item 4:** all dialogs in these routes → primary-left / Cancel-right.
- **Item 1:** all these screens responsive; the procedure **line editor** and running total
  must be usable on a phone (running total always visible, dev-rules §5).
- Acceptance: procedures filter behaves exactly as described (presets → Range → dates → OK →
  filtered, white bg); operational lists match the family; mobile clean.

### Agent C — Top bar (items 6, 7, 1)
Scope: `app/(dashboard)/top-nav.tsx` (and `layout.tsx` only if you must pass extra profile data).
- **Item 6:** **remove the search** — the `<Search>` input, its `useState("")`, and the import.
  (It's a visual placeholder today; delete cleanly.)
- **Item 7:** clicking the **profile avatar** opens a **`Popover`** (shadcn) showing **basic
  info** — name, role title, and phone/email if available — plus **Sign out**. **No separate
  profile page.** If the bar doesn't already have the needed fields, add a tiny server fetch
  (mirror `getUserName`) to pass name/role/phone to `<TopNav>`; keep the avatar initials.
- **Item 1:** the top bar is responsive — on small screens the nav collapses gracefully
  (wrap or a compact menu), brand + avatar stay put; nothing clips.
- Acceptance: no search; avatar → basic-info popover with sign-out; bar works at 360px.

### Agent D — Failed-PIN activity logging (item 5)
Scope: PIN verification is `findApproverByPin` (`lib/billing/discount.ts`), called from
`lib/consultations/actions.ts` (authorizeDiscount, startConsultation) and
`lib/procedures/actions.ts` (submit). It returns `null` on a wrong/unknown PIN — **today that
failure is silent in the log.**
- Add an activity tag to `lib/activity/actions.ts`, e.g.
  `"discount.pin_failed": { label: "Failed discount PIN attempt", tone: "danger" }`.
- **Every place a PIN check fails** (approver === null), call `logActivity({ actorId: s.sub,
  action: "discount.pin_failed", entity: "bill", locationId, details: { context: "consultation"|"procedure" } })`
  **before** returning the error. **NEVER log the PIN value or any hash.** Logging must not
  break the action (best-effort).
- Consider a tiny shared helper so all three call sites are identical.
- Acceptance: entering a wrong supervisor PIN anywhere writes one `discount.pin_failed`
  activity row (visible in the dashboard feed / `audit_log`), with no secret in `details`.

### Agent E — Review, edge cases, mobile QA (items 8, 1) — RUN LAST
After A–D land, do a hardening pass (like `docs/plans/review-hardening.md`, scoped to shipped
code) plus the final mobile sweep. Emphasis, given this is a money counter with a patient
waiting:
- **Silent failures (P0):** swallowed catches, actions that can fail without telling the user,
  ignored `ActionResult` errors, missing `error.tsx` boundaries.
- **Edge cases (P0):** empty/duplicate inputs; expired consultation on procedure; qty 0/huge;
  discount > subtotal; concurrent submits (double-click → double bill?); patient with no phone;
  revisit on the exact expiry day; PIN retry; deactivated doctor/service mid-flow.
- **Counter latency (P1):** N+1 / unindexed queries on hot paths (patient phone lookup,
  consultation-number lookup, service list), work-on-render, over-broad `revalidatePath`,
  client re-render storms; preload static lists (services/doctors) with the screen.
- **Money correctness (P0):** integer paise everywhere; server-authoritative prices; totals
  match rules; `canFinalizeBill` enforced.
- **Mobile (item 1):** walk every screen at ~360px — functional and clean; fix stragglers.
- Report findings in `docs/reviews/batch-findings.md` (severity + file:line + fix), fix P0/P1,
  batch P2. Keep behavior; small changes. Use `/code-review`, `/security-review`, `design-audit`
  per area to augment.
- Acceptance: findings doc written; P0/P1 fixed; suite + tsc + build clean; app usable on phone.

---

## 3. Item → agent map (nothing lost)
1. Mobile functional & nice → **A, B, C** (their screens) + **E** (final sweep).
2. Procedures filter (white bg; Today/Yesterday/This Week/Range → dates → OK → filtered) → **B**.
3. All lists follow user-management design → **A** (admin) + **B** (operational).
4. Popup action buttons LEFT, Cancel RIGHT → **A, B** (and **C** if any dialog).
5. Failed PIN → activity log → **D**.
6. Remove top-bar search → **C**.
7. Avatar click → basic-info popover (no page) → **C**.
8. Review / bugs / edge cases / optimize → **E**.

---

## 4. Definition of done (whole batch)
- [ ] Admin + operational list screens share the user-management design; no style switcher.
- [ ] All dialogs: primary action left, Cancel right.
- [ ] Procedures filter: white bg, presets (Today/Yesterday/This Week/Range), Range reveals
      dates → OK closes & filters. (Consultations history filter matched if present.)
- [ ] Top bar: search removed; avatar → basic-info + sign-out popover; responsive.
- [ ] Wrong supervisor PIN anywhere → one `discount.pin_failed` activity row (no secrets).
- [ ] Every screen functional + clean at ~360px.
- [ ] E's findings doc written; P0/P1 fixed; `npm test`, `npx tsc --noEmit`, `npx next build` clean.

---

## 5. FINAL — what's next, and morning testing (owner asked)

**What to start next, and why: A4 receipt printing (pdfme) with save-before-print.**
Consultations and procedures now **generate finalized bills with real bill numbers, but there
is no way to hand the patient a receipt.** For a billing counter that's the missing half of the
core loop — the bill is recorded but not printed. Printing is also called out in
`DEVELOPMENT_RULES.md` (save first, then print as a separate retryable step) and `PROJECT_OVERVIEW`
(A4, admin-editable layout via pdfme). So printing is the highest-value next feature — it turns
the app into something usable at the counter. (After printing: **IPD admit→discharge**, the other
untouched core flow, then daily reports.)

**What YOU should test in the morning (outputs of this batch):**
1. **On a phone (~360px):** open login, a couple admin lists, patients, the **consultation flow**,
   and the **procedure flow** — everything usable and clean, no sideways scroll.
2. **Procedures filter:** Today/Yesterday/This Week work; **Range** reveals dates, **OK** closes
   and filters; the control has a **white background**.
3. **Dialogs:** confirm every popup has **Save/primary on the left, Cancel on the right**.
4. **Top bar:** search is gone; **click the avatar** → basic info + sign out; looks right on mobile.
5. **Failed PIN:** enter a wrong supervisor PIN on a discount → check the **activity feed** shows
   a "Failed discount PIN attempt".
6. **Nothing regressed:** a full **consultation → procedure** run still saves correct totals; and
   `npm test` / `npx next build` are green.
7. Skim **`docs/reviews/batch-findings.md`** for anything Agent E flagged but deferred.

Then we can green-light **printing** as the next build.
```
