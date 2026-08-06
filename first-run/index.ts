// First-run setup module: everything responsible for creating the base
// location and admin user when the app first starts. Entry point is
// `ensureFirstRun`, called once at server startup from instrumentation.ts.
export { ensureFirstRun } from "./ensure-first-run";
// The break-glass account, re-asserted from .env on every start so a restart is
// always a way back in (see lib/auth/super-admin.ts).
export { ensureSuperAdmin } from "./ensure-super-admin";
