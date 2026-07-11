// Shared session configuration: the cookie name, its options, and the signing
// secret. Kept in one place so login (set), logout (delete), and the DAL (read)
// never disagree on cookie name/flags. No Next.js or DB imports here.

export const SESSION_COOKIE = "session";

// One shift. Configurable via env; falls back to 12 hours.
export const SESSION_MAX_AGE_SECONDS = (() => {
  const hours = Number(process.env.SESSION_MAX_AGE_HOURS);
  return Number.isFinite(hours) && hours > 0 ? Math.floor(hours * 3600) : 12 * 3600;
})();

// The HMAC secret. Missing config is a hard error (mirrors lib/db.ts refusing to
// run without DATABASE_URL) - a silent empty secret would forge trivially.
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set - cannot sign or verify sessions. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }
  return secret;
}

// Cookie options shared by set() and delete(). httpOnly keeps the token out of
// JS; sameSite "lax" blocks CSRF on cross-site POSTs while allowing normal
// navigation. `secure` only on HTTPS production - the clinic runs plain-HTTP LAN,
// so a hard-coded true would silently drop the cookie there.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE === "true",
  };
}
