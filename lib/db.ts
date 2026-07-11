import { Pool } from "pg";

// One shared Postgres connection pool for the whole app, created once and
// reused across every request (DEVELOPMENT_RULES.md §6). Never open a new
// connection per request. Keepalive is on so idle counters stay connected.
//
// In dev, Next.js hot-reload re-evaluates modules, which would leak pools; we
// stash the pool on globalThis so only one ever exists per process.

declare global {
  // eslint-disable-next-line no-var
  var __llhPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set - cannot create the database pool.");
  }

  return new Pool({
    connectionString,
    keepAlive: true,
    // The counter runs on a LAN against a local Postgres; a small pool is
    // plenty. Tune only if a real bottleneck appears (rules §6).
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export const pool: Pool = globalThis.__llhPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.__llhPool = pool;
}
