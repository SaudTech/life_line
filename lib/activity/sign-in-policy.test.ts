import { describe, expect, it } from "vitest";
import { shouldLogSignIn } from "./sign-in-policy";

describe("shouldLogSignIn", () => {
  it("does not log an admin sign-in", () => {
    expect(shouldLogSignIn("admin")).toBe(false);
  });

  it("logs every other role's sign-in exactly as before", () => {
    for (const role of ["supervisor", "op_desk", "op_ip_desk"]) {
      expect(shouldLogSignIn(role), role).toBe(true);
    }
  });

  it("logs an unknown/future role rather than silently dropping it", () => {
    // Fail OPEN: only the literal "admin" is exempt. A role added later must be
    // recorded until someone deliberately exempts it here.
    expect(shouldLogSignIn("pharmacy_desk")).toBe(true);
    expect(shouldLogSignIn("")).toBe(true);
  });

  it("is case- and whitespace-sensitive - only the canonical role is exempt", () => {
    // Roles come from the users table as exact lower_snake values; a near-miss
    // must not accidentally acquire the exemption.
    expect(shouldLogSignIn("Admin")).toBe(true);
    expect(shouldLogSignIn(" admin")).toBe(true);
  });
});
