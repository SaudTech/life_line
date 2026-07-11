@AGENTS.md

# Life Line Hospital - Billing System

A local, multi-user hospital billing counter tool. Two source-of-truth docs, read them before any real work:

- **`PROJECT_OVERVIEW.md`** - what the system is, why it exists, features, roles, billing rules, data model, scope.
- **`DEVELOPMENT_RULES.md`** - engineering conventions and coding standards. Non-negotiable.

## The one thing to internalize

This is a **billing counter used ~144×/day with real money on every screen**. Every decision favours **speed, certainty, and correctness** over cleverness or features. When unsure, re-read `DEVELOPMENT_RULES.md` §1 (First Principles).

## Rules that most often get violated - do not

- **No money as floating point.** Use integer minor units (paise) or a decimal type. Never a JS `number` for currency.
- **No business logic in UI or API routes.** Billing rules are pure, tested functions (`calculateDischargeBalance`, `isConsultationValid`, `canFinalizeBill`, `isRevisitFree`). One source of truth per rule - never re-implement a formula in the UI for a "preview." Ask the server.
- **Three separated layers:** business logic (pure rules) / data access (DB) / UI. Never mix.
- **Every money/rule function has Vitest unit tests before it's done** - cover edge cases (advance > bill → refund, zero expenses, consultation on the exact expiry day, discount with no approval). Untested = not done.
- **Save before print, always.** The bill gets its DB-issued unique number and is saved before anything prints. Save and print are separate, retryable steps. Nothing is silently deleted - corrections are void + re-issue with an audit trail.
- **A patient is identified by a unique auto-generated Patient ID, never by phone.** Phone is a non-unique lookup - several patients can share one (mother + child).
- **`location_id` on every core table** from day one (multi-branch-ready), but build no branch *features* yet.
- **Enforce roles on the server**, not just by hiding UI. Discounts require Supervisor approval (PIN or queue) before a bill can finalise.
- **Keyboard-first counter UX.** Tab follows field order, Enter saves, fixed predictable layout, no confirmation popups on routine actions - make actions reversible instead. Colour is for status only (green/amber/red).

## Stack

Next.js 16 (App Router, `app/`) + React 19 · API routes as backend · PostgreSQL (local, single reused connection pool) · pdfme for A4 receipt layouts · PM2 keep-alive · Vitest (Playwright later) · scheduled backups. **No Docker.** Pinned versions + `npm ci` + setup script.

> ⚠️ Next.js 16 has breaking changes vs. training data - see `AGENTS.md`: read the guide in `node_modules/next/dist/docs/` before writing Next.js code.

## Current state

Fresh scaffold - only the default `app/` (layout, page, globals). No DB, rules, tests, or features built yet. Phase 1 scope is in `PROJECT_OVERVIEW.md` §11.
