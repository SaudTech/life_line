# Implementation Plan - Admin Login (Phase 1)

> **For the implementing session.** This is a self-contained plan. You do **not**
> have the conversation that produced it. Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`,
> and `AGENTS.md` first. Everything below reflects the repo's current state as of
> writing; verify with a quick read before you start.

---

## 1. Objective & scope

Build a **working login for the `admin` role only**. On success the user gets a
session and lands on `/admin`; `/admin` is protected server-side. Include logout.

**In scope**
- Login form on `/login` (already a placeholder - replace it).
- Credential check against the `users` table.
- **Only `role = 'admin'` may sign in.** Valid non-admin credentials are rejected
  with a "not available yet" message (other roles come later).
- Session issued as a signed, httpOnly cookie.
- `/admin` (and the whole `(dashboard)` group) redirects to `/login` when there is
  no valid admin session.
- Logout that clears the session and returns to `/login`.

**Out of scope (do NOT build now)** - see §10.

---

## 2. Ground truth (current repo state)

- **Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4,
  PostgreSQL via `pg`. Node 22. Path alias `@/* → ./*`.
- **DB pool:** `lib/db.ts` exports a shared `pool` (`import { pool } from "@/lib/db"`).
  Reuse it. Never create a new pool.
- **Password hashing:** `lib/password.ts` exports
  `hashPassword(plain)` and `verifyPassword(plain, stored)` (Node scrypt, no deps).
  Import with `@/lib/password`.
- **First-run setup:** `first-run/` creates the initial admin + location on server
  startup (triggered from `instrumentation.ts`). You won't touch it, but that's where
  the test admin comes from.
- **Login page:** `app/login/page.tsx` - a static placeholder to be replaced.
- **Admin home:** `app/(dashboard)/admin/page.tsx`, inside route group
  `app/(dashboard)/` with a shared shell `app/(dashboard)/layout.tsx`.
- **Users schema** (from `migrations/0001_init.sql`), relevant columns:
  | column | type | notes |
  |---|---|---|
  | `id` | `uuid` | PK, `gen_random_uuid()` |
  | `login` | `text` | **unique**; username or phone used to sign in |
  | `password_hash` | `text` | scrypt hash |
  | `role` | `text` | one of `op_desk`, `op_ip_desk`, `supervisor`, `admin` |
  | `active` | `boolean` | inactive users must be refused |
  | `name`, `email`, `phone`, `location_id`, `created_at`, `updated_at` | | |
- **An admin already exists** in the dev DB (login `admin`; the password was
  printed once to the server console at first startup, or set via
  `FIRST_RUN_ADMIN_PASSWORD` in `.env`). Use it to test. If you don't know the
  password, set `FIRST_RUN_ADMIN_PASSWORD` in `.env`, then in psql
  `DELETE FROM users;` and restart the server to re-create it.
- **`.env`** already holds `DATABASE_URL`. Scripts run with `node --env-file=.env`.

---

## 3. Next.js 16 specifics - READ BEFORE CODING

Your training data is likely older than this Next.js. Confirm each against the
bundled docs under `node_modules/next/dist/docs/`:

1. **`cookies()` is async.** `const jar = await cookies()` - from `next/headers`.
   Doc: `01-app/03-api-reference/04-functions/cookies.md`.
2. **You can only *set*/*delete* cookies inside a Server Function (server action) or
   a Route Handler** - never during page/layout render. So login and logout must be
   server actions (or route handlers), not rendered logic.
3. **Middleware is renamed `proxy.ts`** (root-level). The docs state proxy is for
   *optimistic* checks only and **must not be your session/authorization solution.**
   Do real auth checks in the page/layout via a Data Access Layer helper (§6).
   **Do not add a `proxy.ts` for this task.** Doc: `01-app/01-getting-started/16-proxy.md`.
4. **Follow the official auth guide:** `01-app/02-guides/authentication.md` - align
   with its "Data Access Layer" and "sessions" sections.
5. Forms: use a Server Action + `useActionState` (React 19) for the client form.
   Doc: `01-app/01-getting-started/07-mutating-data.md`.

---

## 4. Decisions

**A. Password hashing is already shared (done).**
`hashPassword` / `verifyPassword` live at **`lib/password.ts`** (`@/lib/password`).
Nothing to move - just import from there.

**B. Session mechanism - stateless signed cookie (recommended).**
Match the project's no-dependency ethos (it uses Node `scrypt`, not bcrypt). Sign a
compact session payload with an HMAC using Node `crypto` - no new dependency. See §5
for the exact reference implementation.
- Cookie name: `session`. Flags: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`,
  `maxAge` ≈ one shift (e.g. 12h). `secure`: `true` only when
  `process.env.NODE_ENV === "production"` **and** served over HTTPS - the clinic runs
  on a plain-HTTP LAN, so keep it non-secure there (make it env-driven, don't
  hard-code `true`).
- Payload: `{ sub: <user uuid>, role: <role>, exp: <unix seconds> }`.
- Requires a new secret `SESSION_SECRET` (see §7).
- **Alternative if the user prefers a vetted lib:** `jose` (JWT/JWE) or
  `iron-session`. Only take this route if asked - it adds a dependency.
- **Upgrade path (not now):** a DB-backed `sessions` table enables server-side
  revocation / logout-everywhere. Note it as future; stateless is fine for Phase 1.

**C. Keep authorization on the server.** Every protected route resolves the session
and checks `role === "admin"` server-side. Hiding UI is not security
(`DEVELOPMENT_RULES.md` §8).

---

## 5. Files to create / change

Create a small **auth module** so logic stays pure and testable
(`DEVELOPMENT_RULES.md` §2).

```
lib/
  password.ts            ← already here (hashPassword / verifyPassword)
  auth/
    session.ts           ← PURE: signSession(payload, secret) / verifySession(token, secret)
    session.test.ts       ← Vitest unit tests for the above (see §9)
    dal.ts               ← getSession() / requireAdmin(): read + verify the cookie
    actions.ts           ← "use server": loginAction(), logoutAction()
    authenticate.ts      ← authenticateAdmin(login, password): DB lookup + checks
app/
  login/
    page.tsx             ← REPLACE placeholder: render <LoginForm/>, redirect to /admin if already logged in
    login-form.tsx       ← "use client": form, useActionState, keyboard-first, error display
  (dashboard)/
    layout.tsx           ← ADD requireAdmin() guard at top (protects whole group), render a logout control
```

Also:
- `.env` and `.env.example` - add `SESSION_SECRET` (see §7).
- Optionally add `SESSION_MAX_AGE_HOURS` to env if you want it configurable.

### Reference implementation - `lib/auth/session.ts` (pure, no Next/DB imports)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  sub: string;   // user uuid
  role: string;  // e.g. "admin"
  exp: number;   // unix seconds
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null; // tampered
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < nowMs()) return null; // expired
  return payload;
}
```
> `nowMs()`: in a pure module you may use `Date.now()`. (Note: workflow *scripts*
> forbid `Date.now()`, but this is normal app code - it's fine here.)

### `lib/auth/authenticate.ts` (data access - thin)

```ts
// authenticateAdmin: returns the user row on success, or a typed failure reason.
// Steps: SELECT id, password_hash, role, active FROM users WHERE login = $1
//   - no row            → fail "invalid"
//   - !active           → fail "invalid"   (do NOT reveal the distinction)
//   - !verifyPassword   → fail "invalid"
//   - role !== "admin"  → fail "not_admin" (only admin login is enabled now)
//   - else              → ok { id, role }
// Always run verifyPassword even when the user is missing? Optional hardening;
// at minimum keep the error message identical for every "invalid" case.
```

### `lib/auth/actions.ts` (`"use server"`)

- `loginAction(prevState, formData)`:
  1. Read `login`, `password` from `formData`. Trim login.
  2. `authenticateAdmin(...)`.
  3. On `"invalid"` → return `{ error: "Incorrect login or password." }`.
     On `"not_admin"` → return `{ error: "Only administrator sign-in is available right now." }`.
  4. On success: build payload `{ sub, role, exp: now + maxAge }`, `signSession`,
     `(await cookies()).set("session", token, { httpOnly, sameSite:"lax", path:"/", maxAge, secure })`.
  5. `redirect("/admin")` (from `next/navigation`).
- `logoutAction()`: `(await cookies()).delete("session")` then `redirect("/login")`.

### `lib/auth/dal.ts`

- `getSession()`: `const c = await cookies(); const t = c.get("session")?.value;`
  return `t ? verifySession(t, process.env.SESSION_SECRET!) : null`.
- `requireAdmin()`: `const s = await getSession(); if (!s || s.role !== "admin") redirect("/login"); return s;`

### `app/(dashboard)/layout.tsx`

Call `await requireAdmin()` at the top of the layout so every page in the group is
protected in one place. Render a logout button that submits `logoutAction` via a
`<form action={logoutAction}>`.

### `app/login/page.tsx`

- If `await getSession()` is already a valid admin, `redirect("/admin")`.
- Otherwise render `<LoginForm />` (client component).

### `app/login/login-form.tsx` (`"use client"`)

- `const [state, action, pending] = useActionState(loginAction, { error: null })`.
- Fields: login (autoFocus), password. `Enter` submits (native form). Disable submit
  while `pending`. Show `state.error` in red (status colour only).

---

## 6. Implementation order

1. Add `SESSION_SECRET` to `.env` + `.env.example` (§7).
2. `lib/auth/session.ts` + `session.test.ts`; run Vitest (§9). Get this green first -
   it's the security core.
3. `lib/auth/authenticate.ts`, then `dal.ts`, then `actions.ts`.
4. Replace `app/login/page.tsx`; add `login-form.tsx`.
5. Add `requireAdmin()` + logout to `app/(dashboard)/layout.tsx`.
6. Manual end-to-end verification (§9).

---

## 7. `SESSION_SECRET`

Add to `.env` and document in `.env.example` (with a placeholder, never a real
value). Generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.env.example` entry:
```
# Secret used to sign session cookies. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SESSION_SECRET=
```
The auth code must throw a clear error if `SESSION_SECRET` is missing (like
`lib/db.ts` does for `DATABASE_URL`).

---

## 8. UX & security requirements (non-negotiable, from the rules)

**UX (`DEVELOPMENT_RULES.md` §5):** keyboard-first - login field `autoFocus`, `Tab`
order login→password→submit, `Enter` submits, submit disabled while pending. Calm
visuals, colour only for status (error = red). Fixed layout; button always in the
same place.

**Security (`DEVELOPMENT_RULES.md` §8):**
- Enforce role on the **server** (`requireAdmin`), not just by hiding UI.
- **Identical, generic error** for wrong login vs wrong password vs inactive user -
  never reveal which was wrong.
- Password compare uses the existing constant-time `verifyPassword`.
- Session HMAC verify uses `timingSafeEqual` (in the reference code).
- Cookie is `httpOnly` (JS can't read it) and `sameSite: "lax"`.
- Never log passwords, hashes, or the session token.

---

## 9. Testing & verification

**Unit (Vitest) - required before "done" (`DEVELOPMENT_RULES.md` §3).**
Vitest is not yet installed. Install pinned dev deps: `vitest` (and `@vitest/...`
only if needed). Add `"test": "vitest run"` to `package.json` scripts. Cover
`lib/auth/session.ts`:
- round-trip: `verifySession(signSession(p, s), s)` deep-equals `p`.
- tampered body → `null`.
- tampered/again-signed with a **different secret** → `null`.
- expired `exp` → `null`.
- garbage / no-dot string → `null`.
Keep `authenticate.ts` DB access out of unit tests (integration later, separate test
DB - never the real one).

**Manual E2E.**
1. Start the server on a spare port (there may already be a dev server on 3000):
   `node --env-file=.env node_modules/next/dist/bin/next start -p 3007` after
   `npx next build`, **or** `npm run dev` if 3000 is free.
2. Visit `/admin` while logged out → should redirect to `/login`.
3. Wrong password → generic error, no redirect.
4. Correct **admin** credentials → lands on `/admin`; `session` cookie is set
   (httpOnly).
5. If you have a non-admin user, its correct credentials → "only administrator
   sign-in is available" and no session.
6. Logout → cookie cleared, back at `/login`, and `/admin` redirects again.
7. `npx tsc --noEmit` and `npx next build` both clean.

---

## 10. Out of scope / future (leave hooks, build nothing)

- Other roles (supervisor, op_desk, op_ip_desk) and role-based landing routes.
- `must_change_password` flag / forced first-login password change (schema column
  doesn't exist yet - a later migration).
- Rate limiting / lockout / audit-logging of login attempts (local LAN; add later -
  an `audit_log` table already exists for when you do).
- DB-backed sessions / logout-everywhere / "remember me".
- Password reset, self-service profile.
- `proxy.ts` optimistic redirects (optional optimization only; real check stays in
  the DAL).

---

## 11. Definition of done

- [ ] First-run setup still works (creates the admin on a fresh DB).
- [ ] `SESSION_SECRET` wired; auth throws clearly if it's missing.
- [ ] `lib/auth/session.ts` covered by passing Vitest tests.
- [ ] Admin can log in; non-admin and bad credentials are refused with a generic
      message.
- [ ] `/admin` and the `(dashboard)` group are server-protected; logout works.
- [ ] `npx tsc --noEmit` and `npx next build` are clean.
- [ ] No secrets/passwords/tokens logged; error messages don't leak which field was
      wrong.
```
