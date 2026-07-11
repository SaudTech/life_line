# Implementation Plan - Activity Log (app-wide activity tracking)

> **For the implementing session.** Self-contained; you do **not** have the conversation
> that produced it. Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md` first. Verify
> ground truth (§2) before starting. No rush; no shortcuts.

---

## 1. Objective

One canonical, append-only **activity log** for the whole app: every meaningful action
(sign-in, patient created, staff created/updated, password reset, doctor added, bill
voided, discount approved, …) recorded as a row with a **defined tag** (`action`), the
**actor**, the **target**, the **branch**, a timestamp, and optional structured details.
It is the audit trail (`DEVELOPMENT_RULES.md` §4/§8) and it powers the admin "Recent
activity" feed.

**Key decision up front: do NOT create a new table.** The existing `audit_log` table *is*
the activity log - this plan **evolves and formalizes it** (canonical tags + a few schema
fixes + wiring the missing events). A second table would split the audit trail and
duplicate the helper/feed already built.

---

## 2. Ground truth (current state)

- **`audit_log` already exists** (migration 0001), currently:
  | column | type | null | notes |
  |---|---|---|---|
  | `id` | `bigint` | no | PK identity |
  | `user_id` | `uuid` | **yes** | the actor (already nullable - good for system/pre-auth) |
  | `action` | `text` | no | the tag - today ad-hoc strings |
  | `entity` | `text` | no | target type, e.g. `user` |
  | `entity_id` | `bigint` | yes | **problem: can't hold a user UUID** - see §4 |
  | `details` | `jsonb` | yes | extra context; today carries `{ user_id: <uuid> }` |
  | `at` | `timestamptz` | no | default now() |
  - Indexes: on `entity`, `user_id`, `at`. **No `location_id`** (violates the "location_id
    on every core table" rule). ~12 rows today.
- **`writeAudit(actorId, action, details)`** (`lib/audit.ts`) inserts rows but
  **hardcodes `entity = 'user'`**. (The Doctors plan generalizes it to take `entity`;
  this plan supersedes that with a fuller `logActivity` - reconcile if Doctors ships first.)
- **`formatActivity(action, targetName)`** (`lib/admin/activity.ts`, pure, tested) maps
  `user.*` actions → display text + `Tone` (`accent|success|warning|danger`), with a
  readable fallback for unknown tags. **Only `user.*` is covered.**
- **The dashboard feed** reads via `listRecentActivity` (`lib/users/repository.ts`),
  joining the target name on `(details->>'user_id')::uuid`, filtered to `entity='user'`.
- **Sign-in / sign-out are NOT logged** (`lib/auth/actions.ts` `loginAction`/`logoutAction`
  don't audit). The user specifically wants "user sign in" tracked.

---

## 3. What "done" looks like

1. A **typed, canonical tag registry** (single source of truth) - every action tag the app
   emits, grouped by domain, each with a display label + tone.
2. `audit_log` **evolved** (migration `0003`): `location_id`, a **type-agnostic
   `target_id text`** (holds UUID *or* bigint ids), plus an `action` index.
3. A single **`logActivity(...)`** helper replacing `writeAudit`, used by every mutating
   server action, emitting only canonical tags.
4. **Auth events wired** (`auth.sign_in`, `auth.sign_out`) and all existing user/doctor
   actions migrated to the registry tags.
5. The dashboard feed keeps working (reads `target_id`; `formatActivity` covers the
   registry).

---

## 4. Schema evolution - migration `0003_activity_log.sql`

Evolve `audit_log` (forward-only; ~12 dev rows - a small backfill is fine):

```sql
-- 0003_activity_log.sql - formalize audit_log as the app-wide activity log.
ALTER TABLE audit_log ADD COLUMN location_id BIGINT REFERENCES locations (id);
ALTER TABLE audit_log ADD COLUMN target_id   TEXT;  -- holds UUID or BIGINT id as text

-- Backfill target_id from the existing convention (user actions stored the UUID in details).
UPDATE audit_log SET target_id = details->>'user_id' WHERE target_id IS NULL;

-- entity_id (BIGINT) can't hold UUIDs and is superseded by target_id. Drop it.
ALTER TABLE audit_log DROP COLUMN entity_id;

CREATE INDEX audit_log_action_idx      ON audit_log (action);
CREATE INDEX audit_log_location_idx    ON audit_log (location_id);
-- (existing: audit_log_at_idx, audit_log_user_idx, audit_log_entity_idx)
```

Column meaning after this:
- `user_id` - **actor** (who did it); NULL for system / pre-auth (e.g. failed sign-in).
- `action` - **canonical tag** (§5).
- `entity` - **target type** (`user`, `patient`, `doctor`, `service`, `bill`, …).
- `target_id` - the target's id **as text** (UUID or bigint). NULL if not applicable.
- `location_id` - branch; NULL for system/pre-auth events.
- `details` - extra structured context (JSONB). **Never secrets** (no passwords/PINs/hashes).
- `at` - when.

---

## 5. The canonical tag registry (the heart of this task)

Naming convention: **`domain.verb`**, lower_snake. Create a **pure, client-safe** module
`lib/activity/actions.ts` as the single source of truth, and back `formatActivity` with it.

```ts
export type Tone = "accent" | "success" | "warning" | "danger";
export interface ActivityMeta { label: string; tone: Tone; }

// ONE place that defines every tag the app may emit. Adding a feature = add its tags here.
export const ACTIVITY: Record<string, ActivityMeta> = {
  // ── Auth ───────────────────────────────────────────────────────────────
  "auth.sign_in":         { label: "Signed in",                 tone: "accent"  },
  "auth.sign_out":        { label: "Signed out",                tone: "accent"  },
  "auth.sign_in_failed":  { label: "Failed sign-in attempt",    tone: "warning" }, // optional (§9)

  // ── Staff / users ──────────────────────────────────────────────────────
  "user.create":          { label: "New staff created",         tone: "success" },
  "user.update":          { label: "Staff account updated",     tone: "accent"  },
  "user.password_reset":  { label: "Password reset",            tone: "warning" },
  "user.pin_set":         { label: "Discount PIN set",          tone: "accent"  },
  "user.pin_clear":       { label: "Discount PIN cleared",      tone: "accent"  },
  "user.deactivate":      { label: "Staff account archived",    tone: "danger"  },
  "user.activate":        { label: "Staff account reactivated", tone: "success" },

  // ── Patients ───────────────────────────────────────────────────────────
  "patient.create":       { label: "Patient registered",        tone: "success" },
  "patient.update":       { label: "Patient details updated",   tone: "accent"  },

  // ── Doctors ────────────────────────────────────────────────────────────
  "doctor.create":        { label: "Doctor added",              tone: "success" },
  "doctor.update":        { label: "Doctor updated",            tone: "accent"  },
  "doctor.activate":      { label: "Doctor reactivated",        tone: "success" },
  "doctor.deactivate":    { label: "Doctor deactivated",        tone: "danger"  },

  // ── Services / items ───────────────────────────────────────────────────
  "service.create":       { label: "Service added",             tone: "success" },
  "service.update":       { label: "Service updated",           tone: "accent"  },
  "service.activate":     { label: "Service reactivated",       tone: "success" },
  "service.deactivate":   { label: "Service deactivated",       tone: "danger"  },

  // ── Consultations / visits ─────────────────────────────────────────────
  "consultation.create":  { label: "Consultation started",      tone: "accent"  },
  "consultation.revisit": { label: "Free revisit recorded",     tone: "accent"  },

  // ── Bills ──────────────────────────────────────────────────────────────
  "bill.create":          { label: "Bill created",              tone: "accent"  },
  "bill.finalize":        { label: "Bill finalized",            tone: "success" },
  "bill.void":            { label: "Bill voided",               tone: "danger"  },
  "bill.reprint":         { label: "Bill reprinted",            tone: "accent"  },

  // ── Discounts ──────────────────────────────────────────────────────────
  "discount.request":     { label: "Discount pending approval", tone: "warning" },
  "discount.approve":     { label: "Discount approved",         tone: "success" },
  "discount.decline":     { label: "Discount declined",         tone: "danger"  },

  // ── In-patient (admit / discharge) ─────────────────────────────────────
  "admission.admit":      { label: "Patient admitted",          tone: "accent"  },
  "admission.discharge":  { label: "Patient discharged",        tone: "success" },

  // ── System ─────────────────────────────────────────────────────────────
  "system.first_run_admin": { label: "Initial admin created",   tone: "accent" },
} as const;

export type ActivityAction = keyof typeof ACTIVITY;
export function activityMeta(action: string): ActivityMeta {
  return ACTIVITY[action] ?? { label: action.replace(/[._]/g, " "), tone: "accent" };
}
```

> **Mapping the user's examples:** "user sign in" → `auth.sign_in`; "patient created" →
> `patient.create`; "new staff created" → `user.create`; "staff updated" → `user.update`;
> "password reset" → `user.password_reset`.
>
> **Status of each tag:** `auth.*`, `user.*` are emitted today (once wired). `doctor.*`,
> `patient.*`, `service.*`, `consultation.*`, `bill.*`, `discount.*`, `admission.*`
> correspond to features not built yet - they're defined **now** so every future feature
> uses a pre-agreed tag (no ad-hoc strings). `system.first_run_admin` comes from
> `first-run/`. Don't emit a tag until its feature exists; just keep the registry complete.

Refactor `lib/admin/activity.ts` `formatActivity` to delegate to `activityMeta(action)`
(keep appending the target name) so there is **one** label/tone source.

---

## 6. The logging helper - `lib/audit.ts` → `logActivity`

Replace `writeAudit` with a fuller, still-thin helper (server-only):

```ts
export async function logActivity(input: {
  actorId: string | null;          // user_id; null for system/pre-auth
  action: ActivityAction;          // canonical tag - typed, so typos fail to compile
  entity: string;                  // target type: "user" | "patient" | "doctor" | ...
  targetId?: string | null;        // UUID or bigint id, as text
  locationId?: string | null;      // branch (bigint as string)
  details?: Record<string, unknown>;  // extra context - NEVER secrets
}): Promise<void>;
// INSERT INTO audit_log (user_id, action, entity, target_id, location_id, details)
//   VALUES (...).  Append-only. Failure to log must not crash the mutation it records -
//   wrap in try/catch and console.error; the primary action already succeeded.
```

Migrate existing callers (5 in `lib/users/actions.ts`, plus Doctors if shipped) to
`logActivity` with the registry tags and `entity`/`targetId`. Update `listRecentActivity`
to join the target name on `target_id` instead of `details->>'user_id'`.

---

## 7. Wire the missing events

- **`auth.sign_in`** - in `loginAction`, on successful auth (after the cookie is set,
  before `redirect`), `logActivity({ actorId: user.id, action: "auth.sign_in",
  entity: "user", targetId: user.id, locationId: <user's location> })`. (Fetch the user's
  `location_id` in `authenticateAdmin` and return it so it's available here.)
- **`auth.sign_out`** - in `logoutAction`, read the session first (`getSession()`), log
  `auth.sign_out` with the actor, then delete the cookie + redirect.
- **`system.first_run_admin`** - optional: have `first-run/` log this with `actorId: null`.
- All future mutating actions (patients, services, bills, …) must call `logActivity` with
  a registry tag - make this a checklist item in their plans.

---

## 8. Rules / invariants (non-negotiable)

- **Append-only.** Never UPDATE or DELETE an activity row. Corrections are new rows.
- **Canonical tags only** - the typed `ActivityAction` union makes a typo a compile error.
- **No secrets in `details`** - never a password, PIN, or any hash.
- **One activity per action** - each mutating server action logs exactly once, after the
  mutation succeeds.
- **Actor + location captured** wherever known (null only for system/pre-auth).
- Logging is best-effort: a logging failure must not fail or roll back the real action.

---

## 9. Testing (unit - required, dev rules §3)

- **`lib/activity/actions.test.ts`:** `activityMeta` returns the registry entry for known
  tags and a readable fallback for unknown; every registry value has a non-empty `label`
  and a valid `Tone`; the user's five example phrases map to the expected tags.
- **`lib/admin/activity.test.ts`:** keep/extend - `formatActivity` now delegates to the
  registry; spot-check a few tags across domains + the fallback + target-name append.
- `logActivity` and `listRecentActivity` touch the DB → integration on a separate test DB
  later, not here.

---

## 10. Manual verification

1. Run `npm run migrate` → `0003` applies; `\d audit_log` shows `location_id`, `target_id`,
   no `entity_id`; existing 12 rows have `target_id` backfilled.
2. Sign in as admin → an `auth.sign_in` row appears (actor = you, location set). Sign out
   → `auth.sign_out`.
3. Create/update a staff account → rows use registry tags with `target_id` + `location_id`.
4. Admin dashboard "Recent activity" still renders (labels/tones via the registry, target
   names resolved via `target_id`).
5. `npm test`, `npx tsc --noEmit`, `npx next build` clean.

---

## 11. Out of scope / future
- A dedicated **activity/audit viewer** page with filters (by actor, tag, date, branch)
  and CSV export - the dashboard feed stays the only surface for now.
- **Failed sign-in / security events** at volume, IP / user-agent capture - `auth.sign_in_failed`
  is defined but wiring it (and rate-limit signals) is a later security pass.
- **Retention / archival** - at ~144 receipts/day the table grows steadily; fine for years
  with the `at` index. Revisit partitioning/archival only when it's actually large.
- Emitting tags for features not yet built (patients, bills, etc.) - they're pre-registered;
  each feature wires its own logging when built.

---

## 12. Definition of done
- [ ] Migration `0003` applied: `location_id` + `target_id` added, `entity_id` dropped,
      `target_id` backfilled, new indexes.
- [ ] `lib/activity/actions.ts` registry created; `formatActivity` delegates to it; typed
      `ActivityAction` union.
- [ ] `logActivity` replaces `writeAudit`; all existing callers migrated; `listRecentActivity`
      joins on `target_id`.
- [ ] `auth.sign_in` and `auth.sign_out` logged.
- [ ] Registry + activity formatting unit-tested; whole suite green.
- [ ] `npx tsc --noEmit` + `npx next build` clean; dashboard feed still works.
```
