// First-run setup module: everything responsible for creating the base
// location and admin user when the app first starts. Entry point is
// `ensureFirstRun`, called once at server startup from instrumentation.ts.
export { ensureFirstRun } from "./ensure-first-run";
