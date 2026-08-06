"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateUser } from "./authenticate";
import { getSession, homePathForRole } from "./dal";
import { logActivity } from "@/lib/audit";
import { shouldLogSignIn } from "@/lib/activity/sign-in-policy";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  getSessionSecret,
  sessionCookieOptions,
} from "./config";
import { loginSchema } from "./schema";
import { signSession } from "./session";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";

// Server Actions for sign-in / sign-out. Cookies can only be mutated inside a
// Server Function or Route Handler (Next 16), so these live here, not in render.
//
// loginAction is the RHF ⇄ Server Action bridge (plan D5): it takes a typed
// values object (not FormData) and returns a shared ActionResult. It is also the
// authoritative validation layer - it re-parses with the same loginSchema the
// client uses, never trusting client validation alone (plan D4, dev-rules §8).

// Identical, generic message for every "invalid" case - wrong phone, wrong
// password, and inactive user are indistinguishable to the user (security §8).
// This MUST stay a form-level error, never a field error, so it cannot leak
// which specific check failed.
const INVALID_MESSAGE = "Incorrect phone or password.";

export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }

  const { phone, password } = parsed.data;
  const result = await authenticateUser(phone, password);

  if (!result.ok) {
    return { ok: false, formError: INVALID_MESSAGE };
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const token = signSession({ sub: result.user.id, role: result.user.role, exp }, getSessionSecret());

  (await cookies()).set(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  // Record the successful sign-in in the activity log. Best-effort (logActivity
  // swallows its own errors) and, crucially, BEFORE redirect() - which throws to
  // unwind, so nothing after it runs. The actor is also the target of the event.
  //
  // Admins are exempt (shouldLogSignIn): they are the only readers of the feed and
  // sign in constantly to check it, so logging that would bury the counter events
  // the feed exists to surface. Suppressed HERE, at the write, because audit_log is
  // append-only (§4/§8) - filtering on read would leave the rows in the table.
  if (shouldLogSignIn(result.user.role)) {
    await logActivity({
      actorId: result.user.id,
      action: "auth.sign_in",
      entity: "user",
      targetId: result.user.id,
      locationId: result.user.location_id,
    });
  }

  // redirect() throws to unwind - must be outside any try/catch above. Each role
  // lands on its own home.
  redirect(homePathForRole(result.user.role));
}

export async function logoutAction(): Promise<void> {
  // Read the session BEFORE clearing the cookie so the sign-out is attributed to
  // the actor. If there's no valid session there's nothing to log.
  const session = await getSession();
  if (session) {
    await logActivity({
      actorId: session.sub,
      action: "auth.sign_out",
      entity: "user",
      targetId: session.sub,
    });
  }

  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
