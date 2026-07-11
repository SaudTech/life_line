import { pool } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

// Data-access layer for sign-in: look up a user by phone and decide whether they
// may sign in. Thin - one query plus the pure password/role checks. Never leaks
// which specific check failed to the caller as an error string; that mapping to
// user-facing copy happens in actions.ts.

export type AuthResult =
  // location_id (branch, bigint as string) is returned so the sign-in activity
  // event can be attributed to the user's branch without a second query.
  | { ok: true; user: { id: string; role: string; location_id: string } }
  // "invalid" covers no-such-user, wrong password, AND inactive user - the caller
  // must show one identical message for all three (never reveal the distinction).
  | { ok: false; reason: "invalid" };

interface UserRow {
  id: string;
  password_hash: string;
  role: string;
  active: boolean;
  location_id: string;
}

// Any active staff member may now sign in; the role decides which home they land
// on (see homePathForRole). Inactive ("trash") users are refused, indistinguishably
// from wrong credentials.
export async function authenticateUser(phone: string, password: string): Promise<AuthResult> {
  const { rows } = await pool.query<UserRow>(
    "SELECT id, password_hash, role, active, location_id FROM users WHERE phone = $1",
    [phone],
  );

  const user = rows[0];

  // Always run a password verification, even when the user is missing or
  // inactive, so response timing does not reveal whether the login exists.
  // Uses a syntactically valid dummy scrypt hash so verifyPassword does real work.
  const DUMMY_HASH =
    "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !user.active || !passwordOk) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    user: { id: user.id, role: user.role, location_id: user.location_id },
  };
}
