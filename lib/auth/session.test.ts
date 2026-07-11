import { describe, expect, it } from "vitest";
import { signSession, verifySession, type SessionPayload } from "./session";

const SECRET = "test-secret-value-do-not-use-in-prod";
const OTHER_SECRET = "a-different-secret";

// A payload that expires well into the future for the happy-path cases.
function futurePayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: "11111111-2222-3333-4444-555555555555",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe("signSession / verifySession", () => {
  it("round-trips a valid payload", () => {
    const payload = futurePayload();
    const token = signSession(payload, SECRET);
    expect(verifySession(token, SECRET)).toEqual(payload);
  });

  it("rejects a token whose body was tampered with", () => {
    const token = signSession(futurePayload(), SECRET);
    const [body, sig] = token.split(".");
    // Flip the payload to a different user while keeping the original signature.
    const forgedBody = Buffer.from(
      JSON.stringify(futurePayload({ sub: "99999999-9999-9999-9999-999999999999" })),
    ).toString("base64url");
    expect(verifySession(`${forgedBody}.${sig}`, SECRET)).toBeNull();
    // Sanity: the untouched token still verifies.
    expect(verifySession(`${body}.${sig}`, SECRET)).not.toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession(futurePayload(), OTHER_SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = futurePayload({ exp: Math.floor(Date.now() / 1000) - 1 });
    const token = signSession(expired, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("rejects garbage / no-dot strings", () => {
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession("not-a-token", SECRET)).toBeNull();
    expect(verifySession("abc.def.ghi", SECRET)).toBeNull();
  });

  it("rejects a well-signed token whose payload is missing required fields", () => {
    // Sign an arbitrary object with the real secret - signature is valid but the
    // shape is not a SessionPayload, so verify must still reject it.
    const badBody = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64url");
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(badBody).digest("base64url");
    expect(verifySession(`${badBody}.${sig}`, SECRET)).toBeNull();
  });
});
