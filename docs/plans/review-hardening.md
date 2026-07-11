# Plan — Review & Harden Completed Functionality

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`
> first. This is a **review + fix** pass over what's already built — **not** a rewrite and
> **not** new features. Be surgical: preserve working behavior, change the least needed to
> fix a real problem, keep the whole test suite green after every change.
>
> **The lens that outranks everything:** this is a billing counter with **real money** and a
> **patient standing at the desk**. Two failure modes matter most:
> 1. **Silent failure / uncertainty** — staff can't tell if something saved → double-charge
>    or lost money. (P0)
> 2. **Latency on the hot path** — a spinner or slow query while a patient waits, paid 144×/day.
>    (P1)
> Everything else (code quality, tidy-ups) is P2.

---

## 1. First: establish what's actually built

Plans exist for features **not yet implemented** — do **not** review vapor. Confirm the
real state before starting:

```
git log --oneline -20
git status
```
Then list what exists: `lib/**`, `app/**`, `migrations/**`, `components/ui/**`, and note
which `docs/plans/*` have actually shipped vs. are still just plans. Review **only shipped
code**. As of writing, shipped is roughly: **auth/login + first-run bootstrap, session/DAL,
user management (CRUD + screen), top nav, admin dashboard (activity feed/stats), the shared
form/audit/nav utils, DB pool, migrations 0001–0002, shadcn setup.** Doctors / patients /
activity-log / services / consultations are **plans only** — skip them. Re-scope to reality.

---

## 2. How to work (method)

Go **feature by feature** (auth → first-run → users → nav → dashboard → db/migrations →
shared utils). For each, read every file and pass it through the **dimensions in §3**.
Record findings in `docs/reviews/hardening-findings.md` with:

- **Severity:** `P0` (silent failure / money-correctness / data loss), `P1` (counter
  latency), `P2` (code quality / consistency).
- **File:line**, one-sentence problem, concrete failure scenario, proposed fix.

Then: **fix all P0 and P1 now** (each with a test or a clear manual verification). **Batch
P2** into small, behavior-preserving cleanups. Re-run `npm test`, `npx tsc --noEmit`,
`npx next build` after each fix. Use the built-in **`/code-review`**, **`/security-review`**,
and **`design-audit`** skills per area to augment the manual pass — but you own the final
judgment and the fixes.

---

## 3. Review dimensions (the checklist)

### A. Silent failure & certainty  — P0
- Every `catch` that **swallows** an error (empty catch, `catch {}`, `.catch(() => {})`) —
  is a real failure being hidden? Logging failures may be swallowed **on purpose** (must not
  crash the action) but must still `console.error`. A *mutation* failing silently is a defect.
- Every **server action** path: can it fail and leave the user thinking it succeeded? Does an
  unexpected `throw` (e.g. a DB error in `createUserAction`) reach a user-visible error, or
  vanish? **Check for `error.tsx` boundaries** under `app/(dashboard)/**` and `app/**` — if a
  `throw` in an action has no boundary + no returned `ActionResult` error, the user sees
  nothing or a blank. Ensure every action either returns a typed error or is caught.
- Client forms: is `res.formError` / `fieldErrors` from `ActionResult` **always rendered**?
  Any action call whose result is ignored (`await action(...)` with no error handling)?
- `revalidatePath`/redirect ordering — does a mutation confirm success **before** the UI
  moves on? Any optimistic UI that never verifies the write landed?
- Unhandled promise rejections (missing `await`), fire-and-forget writes.

### B. Counter hot-path latency  — P1
- **DB queries:** any **N+1** (a query inside a `.map`)? Any lookup on an **unindexed**
  column? (Confirm hot lookups hit an index: `patients.phone`, `bills.created_at`,
  `location_id`, `users.phone` for login.) Any `SELECT *` pulling unused/large columns?
- **Work on render:** heavy computation or extra round-trips in a server component that runs
  on every page load. Duplicate queries in a layout + page not shared via `cache()`
  (the codebase uses React `cache` for `getUserName` — verify others that should).
- **Over-broad `revalidatePath`** causing more re-query/re-render than needed.
- **Client re-render storms:** unmemoized derived lists, filtering large arrays on every
  keystroke without `useMemo`, effects that refetch on every render.
- **Preload static data:** doctors/services/etc. (once they exist) should load with the
  screen, not per-keystroke. Establish this as the rule (see §5).
- **Connection pool:** one shared pool, reused, `keepAlive` on, sane `max`; **no reconnect
  per request** (verify `lib/db.ts` — it was recently edited).
- **Startup cost:** `instrumentation.ts` first-run must not block or slow normal boot; it
  runs once and must be resilient (already designed to be — verify it still is).
- **No internet round-trips** on any request path (LAN-local only).

### C. Correctness & rules  — P0
- **Money as float?** Grep for any `parseFloat`/`Number(...)` on an amount, any non-integer
  money math. (Money code is mostly upcoming, but flag anything present.)
- **Role enforcement:** `requireAdmin()` (or equivalent) inside **every** mutating action,
  not just the page. Any action reachable without a server-side role check?
- **Guards from DB state, not client input** (e.g. the last-admin lock-out in
  `lib/users/actions.ts`) — verify they read current DB state.
- **Multi-step writes in a transaction** (none may exist yet; flag any that appear).
- **Server-side re-validation** with the same zod schema the client uses.

### D. Security  — P0/P1
- **Parameterized SQL everywhere** — grep for any string-interpolated SQL (`${` inside a
  query). There must be none.
- **Secrets never selected out or logged:** `password_hash` / `pin_hash` must not appear in
  any `SELECT` used by the app or in any log/`console`/returned payload.
- Cookie flags (`httpOnly`, `sameSite`, `secure` logic), session HMAC verify (constant-time),
  `SESSION_SECRET` required. (Auth was reviewed before — re-confirm nothing regressed.)
- Generic auth errors (no wrong-phone vs wrong-password leak).

### E. Code quality & consistency  — P2
- **Known debt to remove:** the users screen shipped a **"card style" A/B/C switcher** —
  delete it; pick one card. (Design indecision shouldn't ship.)
- Dead/duplicated code; copy-pasted className blocks that should be shared; components doing
  too much; `any` types; inconsistent patterns between features (users vs the shared utils).
- `writeAudit` hardcodes `entity='user'` — if the activity-log/doctors work hasn't
  generalized it yet, note it (don't pre-build unshipped features).
- `dark:` utilities or raw `zinc-*` left over (light-only, semantic tokens — §D1 of ui-foundation).

### F. Tests  — P0 for money/rules, else P2
- Every **pure** function (session, password, nav, activity formatting, user schema, and any
  present rule/money function) has Vitest coverage of edge cases. List any untested pure
  logic and add tests.
- Run the full suite; fix anything red; ensure tests **can actually fail** (no assertion-free
  tests).

### G. Keyboard & certainty UX  — P1 (counter)
- Spot-check the shipped forms/screens: Tab follows field order, **Enter submits/saves**,
  autofocus on the first field, visible focus, submit disabled while pending, and a clear
  **saved/failed** signal. The counter must be completable without the mouse.

---

## 4. Deliverables

- `docs/reviews/hardening-findings.md` — the triaged findings (severity, file:line, fix).
- **Fixes applied** for all P0 + P1, each behavior-preserving and tested; P2 batched.
- Full suite green; `npx tsc --noEmit` + `npx next build` clean.
- A short **summary** at the top of the findings doc: what was wrong, what changed, what was
  intentionally left (with reason).

---

## 5. Output a standing "hot-path rules" note (prevention)

The real counter (consultation/billing) is **next**, so beyond fixing current issues, write a
short `docs/hot-path-rules.md` the upcoming screens must follow — so latency/silent-failure
are prevented by construction, not audited later:
- Preload static lists (doctors/services) with the screen; never per-keystroke.
- Every counter query hits an index; no N+1; select only needed columns.
- Every save returns a definite success/failure the UI shows (`Saved ✓ #id` / clear error).
- Save is its own step; nothing depends on print/network to confirm the money is recorded.
- No blocking spinner on the hot path > ~100ms without a reason.

---

## 6. Guardrails (do NOT)

- Do **not** rewrite working features or "modernize" for its own sake.
- Do **not** change public behavior of a shipped screen without calling it out.
- Do **not** add dependencies or new abstractions to fix a one-off.
- Do **not** review or "fix" features that are only plans (doctors/patients/etc.).
- Keep each fix small and independently verifiable; prefer many tiny correct changes over one
  large risky one.

---

## 7. Definition of done
- [ ] Current built state confirmed; findings triaged in `docs/reviews/hardening-findings.md`.
- [ ] All **P0 (silent-failure / money / security)** findings fixed + verified.
- [ ] All **P1 (counter latency / keyboard certainty)** findings fixed + verified.
- [ ] P2 cleanups applied (incl. removing the card-style switcher) or explicitly deferred with reason.
- [ ] `docs/hot-path-rules.md` written for the upcoming counter screens.
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` all clean; no secrets logged/selected.
```
