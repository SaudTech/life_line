# Implementation Plan - UI Foundation (shadcn/ui + React Hook Form + Zod) & Login Migration

> **For the implementing session.** Self-contained; you do **not** have the
> conversation that produced it. Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, and
> `AGENTS.md` first. **We are not in a rush - do this precisely, no shortcuts.**
> Verify "ground truth" (§2) and every version/API against what actually installs,
> not memory. Two parts: **Part 1** installs and configures the design foundation;
> **Part 2** rebuilds the existing login on top of it as the reference implementation.

---

## 1. Objective

Establish one consistent, professional UI + form system so every screen (users,
doctors, services, billing) is built the same way:

- **shadcn/ui** components (Radix primitives + Tailwind, copied into the repo - we own
  them; no runtime lock-in) for consistent, accessible, keyboard-first UI.
- **react-hook-form + zod** as the form stack, with **one zod schema per form as the
  single source of truth**, validated on the client (UX) **and** re-validated on the
  server (authority, per `DEVELOPMENT_RULES.md` §8).
- A documented **RHF ⇄ Server Action** bridge, since shadcn does not ship one.

Then migrate `/login` to this stack so it becomes the copy-me example.

---

## 2. Ground truth (current repo state)

- **Next 16.2.10, React 19.2.4, Tailwind v4** (config-less: `app/globals.css` is just
  `@import "tailwindcss";` + `@theme inline`, **no `tailwind.config.*`**). PostCSS uses
  `@tailwindcss/postcss`. Path alias `@/* → ./*`. Node 22. Vitest installed.
- **`app/globals.css`** currently defines `--background`/`--foreground`, wires Geist via
  `--font-sans`/`--font-mono`, and does dark mode with
  `@media (prefers-color-scheme: dark)`. **shadcn uses a `.dark` class instead** - see
  Decision D1. `init` may overwrite this file; **preserve the Geist font vars** (they're
  set from `next/font` in `app/layout.tsx`).
- **No** `components.json`, **no** `lib/utils.ts`, **no** `tailwind.config.*` yet.
- **Login to migrate:**
  - `app/login/login-form.tsx` - `"use client"`, currently uses `useActionState` +
    native `<form action>` with hand-styled inputs.
  - `lib/auth/actions.ts` - `loginAction(prevState, FormData)`; on success sets the
    session cookie and `redirect("/admin")`; returns a generic error otherwise. **The
    generic-error behavior (never reveal wrong-phone vs wrong-password) MUST be kept.**
  - `lib/auth/authenticate.ts`, `dal.ts`, `config.ts`, `session.ts` - unchanged by this
    task (session core stays; `session.test.ts` must stay green).
- **`lib/password.ts`** hashing untouched.

---

## 3. Verified facts about the stack (July 2026)

- shadcn CLI supports Tailwind v4: `npx shadcn@latest init` sets up `components.json`,
  `lib/utils.ts` (`cn` = `clsx` + `tailwind-merge`), and CSS variables in `globals.css`
  using `@theme inline` with **oklch** colors. Style default is **new-york**; toasts via
  **sonner**; icons via **lucide-react**; animations via **tw-animate-css** (v4) - the
  CLI adds these deps itself.
- Colors are defined as CSS vars under `:root` and `.dark`, then mapped in
  `@theme inline` (e.g. `--color-background: var(--background)`).
- Components are added with `npx shadcn@latest add <name>` and land in
  `components/ui/*` as editable source (no `forwardRef`; `data-slot` attributes).
- Forms use `useForm({ resolver: zodResolver(schema) })` with the generated `form`
  components (`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`,
  `FormMessage`) or the newer `Field` set - **use whatever the installed CLI generates;
  do not hand-write these.** shadcn does **not** document a Server-Actions bridge - use
  §5.D.

> React 19 peer deps: run the shadcn CLI (it handles React 19). If a raw `npm install`
> of a Radix dep complains about peers, prefer the CLI; only fall back to
> `--legacy-peer-deps` if truly required, and note it. Pin what you install (§6).

---

## 4. Decisions (all firm)

**D1. LIGHT theme only - CONFIRMED by the owner. Dark mode is not needed.**
The current `prefers-color-scheme` approach conflicts with shadcn's `.dark` class and
produces inconsistent theming. This is an internal counter on a fixed clinic PC where
calm, predictable visuals matter. So:
  - Configure shadcn's **light** palette only.
  - **Remove** the `@media (prefers-color-scheme: dark)` block from `globals.css`, and
    strip ad-hoc `dark:` utilities from components as you migrate each one (login in
    Part 2, others later). No screen should render differently based on OS theme.
  - Do **not** add `next-themes` or a theme toggle. Colors remain CSS vars (that's just
    how shadcn works), so dark could be reintroduced later, but it is explicitly not a
    goal - do not build for it.

**D2. Style `new-york`, base color `zinc`** (the app already uses zinc), **icons
`lucide-react`**. cssVariables: true.

**D3. Fonts stay Geist** (already loaded via `next/font` in `app/layout.tsx`). After
`init`, re-point `--font-sans`/`--font-mono` (or shadcn's `--font-*`) at the existing
Geist CSS variables so nothing regresses.

**D4. Form architecture - one zod schema, validated twice.**
  - A schema per form in a **client-importable** module (e.g. `lib/auth/schema.ts`) -
    **no `"use server"`, no DB imports**, so both the client form and the server action
    can import it.
  - **Client:** `useForm({ resolver: zodResolver(schema), defaultValues })` → instant
    inline errors, focus-on-error.
  - **Server (authoritative):** the action calls `schema.safeParse(input)` again and
    returns typed errors. Never trust client validation alone.
  - **Business rules stay separate pure functions** (money/consultation/discharge per
    §2 of the dev rules). Zod validates *input shape/format only*, not business logic.

**D5. RHF ⇄ Server Action bridge - client submit calls a typed action.**
This app requires JS (server actions, interactive panels), so we use the clean typed
pattern over progressive-enhancement `<form action>`:
  - Server actions take a **typed values object** (not `FormData`) and return a shared
    `ActionResult` (below). On success they may `redirect()` (which throws - keep it out
    of try/catch) or return `{ ok: true }`.
  - Client: `form.handleSubmit(async (values) => { const res = await action(values); … })`;
    map `res.fieldErrors` via `form.setError(field, …)` and `res.formError` via
    `form.setError("root", …)`. Pending = `form.formState.isSubmitting`.
  - This **replaces `useActionState`** for forms.

**D6. Replace the hand-rolled `validate.ts` idea from the user-management plan with zod
schemas** going forward (that plan predates this decision). Not built here; just the
direction. (A maintainer can update `docs/plans/user-management.md` separately.)

---

## 5. Shared building blocks to create

```
lib/
  forms/
    action-result.ts   ← ActionResult type + zodFieldErrors() helper (pure, client-safe)
components/ui/*         ← generated by shadcn add (button, input, label, select, form, sonner, dialog…)
lib/utils.ts           ← generated by init (cn)
components.json        ← generated by init
```

### `lib/forms/action-result.ts` (pure, importable anywhere)

```ts
import type { ZodError } from "zod";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// First error message per field, from a failed safeParse.
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "root";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
```

---

## 6. PART 1 - Foundation setup (step by step)

1. **Install form deps, pinned exact:**
   `npm install --save-exact react-hook-form @hookform/resolvers zod`
   Verify `@hookform/resolvers` version supports the installed `zod` major
   (import path `@hookform/resolvers/zod`, `zodResolver`). If the resolver API changed,
   adapt and note it in a comment.
2. **Initialize shadcn:** `npx shadcn@latest init`
   Answers: style **new-york**, base color **zinc**, CSS variables **yes**. Let it write
   `components.json`, `lib/utils.ts`, and update `globals.css`/deps
   (clsx, tailwind-merge, tw-animate-css, lucide-react, class-variance-authority).
3. **Reconcile `app/globals.css`** (critical - do not skip):
   - Keep shadcn's `:root` light tokens and `@theme inline` mapping.
   - Re-add the Geist wiring so `--font-sans`/`--font-mono` (or shadcn's font tokens)
     resolve to the existing `--font-geist-sans`/`--font-geist-mono` from `layout.tsx`.
   - Per D1: light-only. Remove the old `@media (prefers-color-scheme: dark)` block, and
     delete any `.dark` block `init` adds - keep `globals.css` unambiguously single-theme.
   - Confirm `body` still gets the right background/foreground/font.
4. **Pin the deps `init` added** to exact versions in `package.json` (match the project's
   pinning discipline; `pg`, `next` are pinned exact). Run `npm install` to lock.
5. **Add the base components** we'll need now and imminently:
   `npx shadcn@latest add button input label select form sonner dialog`
   (Login needs button/input/label/form; users panel will need select/dialog/sonner.)
6. **Create `lib/forms/action-result.ts`** (§5).
7. **Sanity build:** `npx tsc --noEmit` and `npx next build` clean. Render a shadcn
   `<Button>` somewhere throwaway to confirm styling/tokens work, then remove it.

**Part 1 done when:** shadcn components render with correct zinc/light theme and Geist
font, `cn` works, form deps installed & pinned, build + typecheck clean.

---

## 7. PART 2 - Migrate login to shadcn + RHF + zod

Make `/login` the reference implementation. Preserve **every** existing behavior:
keyboard-first, autofocus phone, Enter submits, disabled-while-pending, cookie set on
success, `redirect("/admin")`, and the **generic** auth error.

1. **Schema - `lib/auth/schema.ts`** (client-safe; no server/DB imports):
   ```ts
   import { z } from "zod";
   export const loginSchema = z.object({
     phone: z.string().trim().min(1, "Enter your phone number."),
     password: z.string().min(1, "Enter your password."),
   });
   export type LoginValues = z.infer<typeof loginSchema>;
   ```
   (Login validation is intentionally light - presence only - because the real check is
   credentials on the server; do not add format rules that leak hints.)

2. **Refactor `lib/auth/actions.ts` `loginAction`** to the typed bridge (D5):
   ```ts
   "use server";
   import { loginSchema } from "./schema";
   import { zodFieldErrors } from "@/lib/forms/action-result";
   import type { ActionResult } from "@/lib/forms/action-result";
   // ...existing imports (authenticateAdmin, cookies, config, signSession, redirect)

   const INVALID = "Incorrect phone or password.";
   const NOT_ADMIN = "Only administrator sign-in is available right now.";

   export async function loginAction(input: unknown): Promise<ActionResult> {
     const parsed = loginSchema.safeParse(input);
     if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };

     const { phone, password } = parsed.data;
     const result = await authenticateAdmin(phone, password);
     if (!result.ok) {
       // Generic, form-level - NEVER a field error (no wrong-phone vs wrong-password leak).
       return { ok: false, formError: result.reason === "not_admin" ? NOT_ADMIN : INVALID };
     }

     const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
     const token = signSession({ sub: result.user.id, role: result.user.role, exp }, getSessionSecret());
     (await cookies()).set(SESSION_COOKIE, token, { ...sessionCookieOptions(), maxAge: SESSION_MAX_AGE_SECONDS });
     redirect("/admin"); // throws to unwind - keep outside try/catch
   }
   ```
   Keep `logoutAction` as-is. Remove the old `LoginState` export if nothing else uses it.

3. **Rebuild `app/login/login-form.tsx`** with RHF + shadcn `form` components:
   - `const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { phone: "", password: "" } })`.
   - `onSubmit`: `const res = await loginAction(values); if (res && !res.ok) { for (const [k,v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof LoginValues, { message: v }); if (res.formError) form.setError("root", { message: res.formError }); }` (on success the action redirects, so nothing returns).
   - Render with `<Form {...form}><form onSubmit={form.handleSubmit(onSubmit)}>` and
     `FormField`/`FormItem`/`FormLabel`/`FormControl`/`Input`/`FormMessage` for phone and
     password. **phone**: `type="tel"`, `autoFocus`, `autoComplete="username"`.
     **password**: `type="password"`, `autoComplete="current-password"`.
   - Show `form.formState.errors.root?.message` as the generic error (`role="alert"`,
     red - status colour only).
   - Submit `<Button type="submit" disabled={form.formState.isSubmitting}>` with pending
     label ("Signing in…").
   - Keep the outer card markup/spacing in `app/login/page.tsx` (that page stays a server
     component and still redirects if already an admin).

4. **Tests:** add `lib/auth/schema.test.ts` (Vitest, no `@/`): valid input passes; empty
   phone / empty password produce the field messages. Keep `session.test.ts` green. Run
   `npm test`.

---

## 8. Verification (both parts)

- `npm test` green (session + new schema tests).
- `npx tsc --noEmit` and `npx next build` clean.
- Manual, signed out, at `/login`:
  1. Submit empty → per-field "Enter your phone/password" (client zod).
  2. Wrong credentials → **one generic** "Incorrect phone or password." (form-level), no
     field-level leak, no redirect.
  3. Correct admin credentials → session cookie set, lands on `/admin`.
  4. Keyboard only: phone autofocused, Tab → password → Sign in, Enter submits, button
     disables while pending.
  5. Theme: components use the zinc/light palette and Geist font; nothing auto-switches
     to dark.
- Run **`design-audit`** on `login-form.tsx`; address findings.

---

## 9. Out of scope / future

- Dark mode toggle / `next-themes` (D1 leaves the door open; not built now).
- Migrating other forms/plans to zod (user-management, doctors, services) - follow-ups
  using this exact pattern.
- A generic `useServerForm` hook to DRY the submit/setError glue - fine to extract once a
  second form exists; don't pre-abstract from one.
- Toasts for success flows (sonner is installed; wire per-feature later).

---

## 10. Definition of done

- [ ] shadcn/ui initialized for Tailwind v4 + React 19; `components.json`, `lib/utils.ts`
      present; base components added; all new deps pinned exact.
- [ ] `globals.css` reconciled: light theme, Geist fonts intact, no `prefers-color-scheme`
      auto-dark; build clean.
- [ ] `lib/forms/action-result.ts` in place.
- [ ] `/login` rebuilt on shadcn + RHF + zod; `loginAction` re-validates with the shared
      `loginSchema`; generic auth error preserved (no field leak); cookie + redirect work.
- [ ] `schema.test.ts` added; `session.test.ts` still green; `npm test` passes.
- [ ] `tsc --noEmit` + `next build` clean; `design-audit` on the login addressed.
- [ ] Keyboard-first behavior verified end to end.
```
