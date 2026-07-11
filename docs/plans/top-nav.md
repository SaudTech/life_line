# Implementation Plan - Top Navigation Bar

> **For the implementing session.** Self-contained; you do **not** have the conversation
> that produced it. Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md` first.
> **Decision already made by the owner: a single horizontal TOP BAR for every area**
> (no sidebar). Light theme only. Keyboard-first. No rush - do it properly.
>
> Depends on the UI foundation (`docs/plans/ui-foundation.md`): shadcn/ui + light theme
> tokens are in place. Use semantic tokens, not raw zinc; no `dark:` utilities.

---

## 1. Objective

Add a consistent, role-aware **top navigation bar** to the signed-in shell: brand on the
left, primary nav links, and the user's sign-out on the right. Replaces the current
plain header in `app/(dashboard)/layout.tsx`. The active route is highlighted.

---

## 2. Ground truth (current state)

- **Shell:** `app/(dashboard)/layout.tsx` is a server component that already:
  - `await requireAdmin()` (redirects non-admins to `/login`) - returns the session
    `{ sub, role, exp }`.
  - renders a header (`h-14`, border-b) with the brand + a `<form action={logoutAction}>`
    Sign-out button.
  - So **today only `admin` reaches any dashboard route** (login admits admins only).
    Build the bar role-aware anyway (future roles), but expect to see the admin set now.
- **Routes that exist:** `/admin` (home), `/admin/users` (being built), `/supervisor`,
  `/desk`. Others (doctors, services, reports) don't exist yet - **don't link to routes
  that 404**; add them as the pages land.
- **Auth:** `requireAdmin()` / `getSession()` in `lib/auth/dal.ts`; `logoutAction` in
  `lib/auth/actions.ts`. Role strings: `admin`, `supervisor`, `op_desk`, `op_ip_desk`.
- **Fonts/theme:** Hanken Grotesk (`--font-hanken`) + semantic shadcn tokens are set up.
- Path alias `@/* → ./*`. Vitest installed.

---

## 3. Next.js 16 notes

- The layout is a **server** component; the active-link highlight needs the current path,
  which is cleanest via **`usePathname()`** in a small **client** component. So: server
  layout resolves the role and renders a client `<TopNav role={…} />`.
- `Link` from `next/link` for nav; `logoutAction` stays a `<form action=…>` (server
  action). `redirect()` in the action is unchanged.

---

## 4. Decisions (firm)

**A. One top bar for all roles** (owner's choice). Keep the counter/desk item list short
so the billing screen stays focused.

**B. Role determines the items.** A pure `navItemsForRole(role)` returns the links for
that role. Only include routes that exist today; leave a clearly-marked TODO list for the
rest so they're one line to add later.

**C. Active state via `usePathname()`** in a client `TopNav`. A link is active when the
path equals its `href` or (for section roots) starts with `href + "/"` (so `/admin/users`
keeps "Users" active). `/admin` matches exactly (don't let it light up for every
`/admin/*`).

**D. Plain `Link`s styled with tokens** - no need for shadcn `navigation-menu` (overkill
for a flat bar). Sign-out reuses the existing `logoutAction` form + shadcn `Button`
(`variant="ghost"`/`"outline"`).

---

## 5. Files

```
lib/
  nav.ts            ← PURE, client-safe: NavItem type, NAV_BY_ROLE, navItemsForRole(role), isActive(path, href)
  nav.test.ts       ← Vitest for navItemsForRole + isActive
app/(dashboard)/
  layout.tsx        ← render <TopNav role={session.role}/> in place of the current header inner nav
  top-nav.tsx       ← "use client": brand + links (usePathname active state) + Sign out
```

### `lib/nav.ts` (pure, no `@/` server imports)

```ts
import type { Role } from "@/lib/users/schema"; // if schema.ts exists; else inline the union

export interface NavItem { href: string; label: string; }

// Only routes that exist today. TODO (add as pages land):
//   admin:      { href: "/admin/doctors", label: "Doctors" },
//               { href: "/admin/services", label: "Services" },
//               { href: "/admin/reports",  label: "Reports"  },
export const NAV_BY_ROLE: Record<string, NavItem[]> = {
  admin:      [{ href: "/admin", label: "Home" }, { href: "/admin/users", label: "Users" }],
  supervisor: [{ href: "/supervisor", label: "Home" }],
  op_desk:    [{ href: "/desk", label: "Counter" }],
  op_ip_desk: [{ href: "/desk", label: "Counter" }],
};

export function navItemsForRole(role: string): NavItem[] {
  return NAV_BY_ROLE[role] ?? [];
}

// Exact match for section roots; prefix match for deeper routes.
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
```
> Note the `/admin` vs `/admin/users` overlap: with the rule above, on `/admin/users`
> **both** "Home" and "Users" would be active. Fix: for an item whose `href` is a section
> root that is a prefix of another item's href (like `/admin`), match it **exactly**.
> Simplest correct rule: an item is active when `pathname === href`, OR
> (`pathname.startsWith(href + "/")` AND no other item's href is a longer prefix of
> pathname). Implement and **unit-test this** so Home doesn't light up on Users.

### `app/(dashboard)/top-nav.tsx` (`"use client"`)

- `const pathname = usePathname();`
- Left: brand ("Life Line Hospital") as a `Link` to the role's first item.
- Middle: `navItemsForRole(role).map(...)` → `Link`s; active gets a clear treatment
  (e.g. `text-foreground` + underline/accent) vs inactive `text-muted-foreground`;
  hover + visible focus ring; generous hit targets.
- Right: `<form action={logoutAction}><Button variant="ghost">Sign out</Button></form>`.
- Bar: `h-14`, `border-b`, `bg-background`, horizontal padding, items vertically centered.
- Keyboard: links are tabbable in order; the whole bar is keyboard-navigable; focus rings
  visible (tokens).

### `app/(dashboard)/layout.tsx`

Keep `await requireAdmin()`, pass `session.role` to `<TopNav role={session.role} />`,
render `{children}` in the existing `<main className="flex-1 p-6">`.

---

## 6. Design (light-only, calm - invoke `frontend-design` first)

- Tokens only: `bg-background`, `text-foreground`, `text-muted-foreground`, `border`,
  `ring`, `accent`/`accent-foreground` for the active/hover state. **No `dark:` classes,
  no raw zinc.**
- Active link is unmistakable but quiet (weight/underline/accent bar) - colour used for
  state, not decoration.
- Fixed height, fixed positions (muscle memory, `DEVELOPMENT_RULES.md` §5). Brand and
  Sign-out never move.
- Desktop-first (clinic PCs). If it must wrap on a narrow window, wrap gracefully; a
  mobile hamburger is out of scope (§8).
- Run **`design-audit`** on `top-nav.tsx` and address findings.

---

## 7. Testing & verification

- **Unit (`lib/nav.test.ts`):** `navItemsForRole` returns the right set per role and `[]`
  for unknown; `isActive`/active-resolution: `/admin` active on `/admin` but **not** on
  `/admin/users`; `/admin/users` active on `/admin/users` and `/admin/users/anything`.
  `npm test` green.
- **Manual:** sign in as admin → bar shows Home + Users; navigating highlights the right
  one (Home not lit on Users); Sign out works; keyboard tab/enter through the bar;
  light-only.
- `npx tsc --noEmit` + `npx next build` clean.

---

## 8. Out of scope

- Sidebar (explicitly rejected). Mobile hamburger / responsive drawer. Breadcrumbs.
- Command palette / keyboard-shortcut navigation (nice later for the counter; not now).
- A user/profile dropdown (just Sign out for now).
- Linking to not-yet-built pages (doctors/services/reports) - add when they exist.

---

## 9. Definition of done

- [ ] `lib/nav.ts` pure config + `navItemsForRole`/active-resolution, unit-tested
      (Home not active on Users).
- [ ] `TopNav` client component: brand, role-based links with active highlight, Sign out.
- [ ] `(dashboard)/layout.tsx` uses it; `requireAdmin()` unchanged.
- [ ] Light-only tokens; keyboard-accessible; `design-audit` addressed.
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` all clean.
```
