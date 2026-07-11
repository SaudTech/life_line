import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionSecret } from "./config";
import { verifySession, type SessionPayload } from "./session";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { getUserAuthz } from "@/lib/users/repository";

// Data Access Layer for authorization. Per the Next.js auth guide, the real
// session check lives here (close to the data), NOT in proxy/middleware. Every
// protected page/layout/action resolves the session through these helpers.

// Memoized per request render so repeated calls in one pass do the HMAC verify
// once (React cache()).
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, getSessionSecret());
});

// Where each role lands after signing in - its own fixed home, so muscle memory
// holds (dev-rules §5). Unknown roles fall back to /login.
export function homePathForRole(role: string): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "supervisor":
      return "/supervisor";
    case "op_desk":
    case "op_ip_desk":
      return "/desk";
    default:
      return "/login";
  }
}

// Any signed-in staff member. Redirects to /login without a valid session.
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

// Server-enforced role gate. Hiding UI is not security (DEVELOPMENT_RULES §8):
// every protected section calls this. No session → /login. Wrong role → bounced
// to that user's own home (never a dead end, never a peek at another role's page).
export async function requireRole(allowed: readonly string[]): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!allowed.includes(session.role)) redirect(homePathForRole(session.role));
  return session;
}

// Admin-only shorthand - the common case.
export async function requireAdmin(): Promise<SessionPayload> {
  return requireRole(["admin"]);
}

// Server-enforced PERMISSION gate (plan 1B), layered on top of role. The session
// holds only `role`, so authorization is read FRESH from the DB (getUserAuthz,
// cached per request) - a grant change takes effect immediately, not after
// re-login (plan B-2). admin ⇒ every permission; a non-admin needs the explicit
// grant; an inactive or missing user passes nothing (plan B-3).
//
// No session → /login. Inactive/missing → /login (they can't be here at all).
// Signed in but lacking the permission → bounced to their own home (never a dead
// end, never a peek at a page they can't use).
export async function requirePermission(
  key: PermissionKey,
): Promise<SessionPayload> {
  const session = await requireSession();
  const authz = await getUserAuthz(session.sub);
  if (!authz || !authz.active) redirect("/login");
  if (!hasPermission(authz, key)) redirect(homePathForRole(session.role));
  return session;
}
