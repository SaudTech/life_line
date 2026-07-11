// Runs once when the Next.js server starts. We use it to run first-run setup -
// creating the first admin user so the app is never left with no one able to log in.
//
// Gated to the Node.js runtime - pg cannot run on the edge runtime. Imports are
// dynamic so the database code is never pulled into an edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { pool } = await import("@/lib/db");
  const { ensureFirstRun } = await import("@/first-run");
  await ensureFirstRun(pool);

  // Permanently purge services whose Trash retention window has passed. Runs once
  // at boot and then daily, so the deletion actually happens after 7 days even if
  // no admin ever opens the Services page (PM2 keeps this process alive - §7). The
  // page load also sweeps, for immediacy when someone is looking. Idempotent and
  // best-effort, so it never blocks startup.
  const { sweepExpiredServices } = await import("@/lib/services/sweep");
  await sweepExpiredServices();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const timer = setInterval(() => void sweepExpiredServices(), ONE_DAY_MS);
  // Don't keep the process alive just for this timer.
  timer.unref?.();
}
