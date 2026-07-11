import { createHmac, timingSafeEqual } from "node:crypto";

// Stateless signed-cookie session core. Pure module - no Next.js, no DB, no
// environment reads - so it can be unit-tested in isolation (see session.test.ts).
//
// A token is `<body>.<sig>` where body is base64url(JSON payload) and sig is an
// HMAC-SHA256 of the body keyed by SESSION_SECRET. Verification is constant-time
// and rejects tampering, wrong-secret re-signs, and expiry.

export interface SessionPayload {
  sub: string; // user uuid
  role: string; // e.g. "admin"
  exp: number; // expiry, unix seconds
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on unequal-length buffers.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null; // tampered / wrong secret

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.sub !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp * 1000 < Date.now()) return null; // expired

  return payload;
}
