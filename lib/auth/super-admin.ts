// The SUPER ADMIN - one account that is guaranteed to work, always.
//
// WHY IT EXISTS. This is a local, single-clinic install with no password-reset email,
// no support desk, and nobody on site who can read a scrypt hash. Every ordinary
// lock-out story ends the same way: the only admin forgets their password, or is
// deactivated by another admin, or is demoted by mistake, and the hospital cannot bill
// until a developer drives over. This account is the way back in.
//
// WHY THE CREDENTIALS LIVE IN .env AND NOT IN THIS FILE. A password written into
// source is committed to git and stays in the history forever - readable by anyone who
// ever clones the repo, and unchangeable without a code edit and a redeploy. `.env` is
// gitignored, is already where SESSION_SECRET and DATABASE_URL live, and can be edited
// at the counter PC with a restart. The guarantee the user actually wanted - "always
// works, no matter what" - comes from the SELF-HEALING behaviour in
// first-run/ensure-super-admin.ts, not from where the string is stored:
//
//   deleted?        recreated at boot
//   deactivated?    reactivated at boot
//   demoted?        forced back to admin at boot
//   password lost?  reset to the .env value at boot
//
// and the UI is blocked from doing any of those in the first place
// (lib/auth/super-admin-guard.ts). A restart is the reset button.
//
// THIS MODULE IS PURE. It reads configuration and compares strings - no database, no
// server-only imports - so the rule that decides "is this the super admin" is unit
// tested (lib/auth/super-admin.test.ts) rather than trusted.

export interface SuperAdminConfig {
  phone: string; // the login - staff sign in by phone (migration 0002)
  password: string;
  name: string; // display name on the staff list
}

// What the account is called when SUPER_ADMIN_NAME is not set. Deliberately obvious
// on the staff list: an account nobody can disable should not look like a colleague.
export const SUPER_ADMIN_DEFAULT_NAME = "Super Admin";

// Read the super admin out of the environment, or null when it is not configured.
//
// BOTH halves are required. A phone with no password would create an account nobody
// can sign in as; a password with no phone has no login to attach to. Half-configured
// is treated as not configured, and the boot logs say so - silently inventing the
// missing half is how you end up with an admin account whose password is a guess.
//
// The password is NOT trimmed: trailing spaces are legal in a password and silently
// eating them would make .env and the login screen disagree forever. The phone IS
// trimmed, because it is an identifier that gets typed and compared.
export function superAdminConfig(
  env: Record<string, string | undefined> = process.env,
): SuperAdminConfig | null {
  const phone = env.SUPER_ADMIN_PHONE?.trim();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!phone || !password) return null;
  return {
    phone,
    password,
    name: env.SUPER_ADMIN_NAME?.trim() || SUPER_ADMIN_DEFAULT_NAME,
  };
}

// True when SUPER_ADMIN_PHONE is set but SUPER_ADMIN_PASSWORD is not, or vice versa.
// Drives a loud boot warning: someone clearly INTENDED a super admin, and a silent
// no-op would only be discovered on the day they are locked out and reaching for it.
export function superAdminHalfConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const phone = env.SUPER_ADMIN_PHONE?.trim();
  const password = env.SUPER_ADMIN_PASSWORD;
  return Boolean(phone) !== Boolean(password);
}

// Is this the protected account? Compared on the LOGIN (phone), because that is the
// only field that is unique, required, and stable across a rename - and the same field
// the repair at boot matches on, so the guard and the repair can never disagree about
// which row they mean.
//
// Fails CLOSED: with no super admin configured nothing is protected, which is correct -
// there is no account to protect, and returning true would freeze an ordinary user.
export function isSuperAdminPhone(
  phone: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const cfg = superAdminConfig(env);
  if (!cfg || !phone) return false;
  return phone.trim() === cfg.phone;
}
