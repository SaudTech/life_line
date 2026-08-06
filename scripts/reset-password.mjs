// reset-password.mjs - set a user's password directly against the database.
//
// The break-glass recovery path for the one failure the UI cannot fix: nobody can
// sign in. Password resets normally go through the admin's Staff panel
// (resetPasswordAction) or self-service change, both of which need a working login.
// When the last admin forgets their password there is no such login, and the hash in
// `users.password_hash` is scrypt - it cannot be read back or hand-written in psql.
//
// This is intentionally a LOCAL, on-the-box tool: it needs DATABASE_URL, so it can
// only be run by someone who already has the database. It is not an escalation path
// - it is the same authority, exercised without the app running.
//
// Usage (from the project root):
//   node --env-file=.env scripts/reset-password.mjs --list
//   node --env-file=.env scripts/reset-password.mjs --phone 123456789 --password "new-secret"
//
// Flags:
//   --list                show every account (name, phone, role, active) - no changes
//   --phone <phone>       the login phone of the account to reset
//   --password <plain>    the new password (any length - see the note at the check)
//   --pin <plain>         ALSO reset this user's supervisor approval PIN
//
// The plaintext is hashed with the SAME scrypt scheme the app uses
// (lib/password.ts) - if that file's cost parameters ever change, change them here
// too, or a password set by this script will still verify but at the old cost.

import { randomBytes, scrypt } from "node:crypto";
import pg from "pg";

// Mirrors lib/password.ts exactly. Kept as a copy rather than an import because
// this script is plain ESM run by node, with no TypeScript or path-alias loader.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_BYTES);
    scrypt(plain, salt, KEYLEN, { N, r: R, p: P }, (err, derived) => {
      if (err) reject(err);
      else resolve(`scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`);
    });
  });
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail("DATABASE_URL is not set. Run with: node --env-file=.env scripts/reset-password.mjs …");
}

const listOnly = process.argv.includes("--list");
const phone = arg("phone");
const password = arg("password");
const pin = arg("pin");

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  if (listOnly) {
    const { rows } = await client.query(
      `SELECT name, phone, role, active FROM users ORDER BY role, name`,
    );
    // Hashes are never selected, let alone printed - this tool writes them, it does
    // not expose them.
    console.table(rows);
    process.exit(0);
  }

  if (!phone) fail("Missing --phone. Run with --list to see the accounts.");
  if (!password) fail("Missing --password.");
  // No length or complexity rule here, deliberately. The app's own 8-character
  // minimum (lib/users/schema.ts) still governs every reset made THROUGH the app;
  // this is the break-glass tool, run by whoever already holds the database, and its
  // job is to get someone back in - not to argue with them about the password while
  // nobody can sign in at all.

  const { rows } = await client.query(
    `SELECT id::text AS id, name, role, active FROM users WHERE phone = $1`,
    [phone],
  );
  if (rows.length === 0) fail(`No user with phone "${phone}". Run with --list to see the accounts.`);
  if (rows.length > 1) fail(`More than one user has phone "${phone}" - resolve that first.`);
  const user = rows[0];

  await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    await hashPassword(password),
    user.id,
  ]);
  console.log(`\n✓ Password reset for ${user.name} (${user.role}, phone ${phone}).`);

  if (pin) {
    // The approval PIN uses the same hash function (lib/users/actions.ts), so a
    // locked-out supervisor is the same problem with the same fix.
    await client.query(`UPDATE users SET pin_hash = $1 WHERE id = $2`, [
      await hashPassword(pin),
      user.id,
    ]);
    console.log(`✓ Approval PIN reset for ${user.name}.`);
  }

  if (!user.active) {
    // Resetting the password of a deactivated account would otherwise look like it
    // worked, then fail at the login screen for an unrelated reason.
    console.log(`\n! This account is DEACTIVATED - it still cannot sign in. Reactivate it first.`);
  }
  console.log("");
} catch (err) {
  fail(err.message);
} finally {
  await client.end();
}
