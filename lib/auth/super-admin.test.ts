import { describe, expect, it } from "vitest";
import {
  isSuperAdminPhone,
  superAdminConfig,
  superAdminHalfConfigured,
  SUPER_ADMIN_DEFAULT_NAME,
} from "./super-admin";

// The break-glass account's rules. Every case here is a way the counter could be
// locked out of its own billing system, so each one is pinned rather than trusted:
// a half-configured pair must not quietly produce a guessable account, and the
// "is this the protected user" question must fail CLOSED when nothing is configured -
// returning true there would freeze an ordinary staff member nobody could then edit.

const env = (over: Record<string, string | undefined>) => ({
  SUPER_ADMIN_PHONE: undefined,
  SUPER_ADMIN_PASSWORD: undefined,
  SUPER_ADMIN_NAME: undefined,
  ...over,
});

const CONFIGURED = env({ SUPER_ADMIN_PHONE: "9999999999", SUPER_ADMIN_PASSWORD: "s3cret" });

describe("superAdminConfig", () => {
  it("reads a fully configured super admin", () => {
    expect(superAdminConfig(CONFIGURED)).toEqual({
      phone: "9999999999",
      password: "s3cret",
      name: SUPER_ADMIN_DEFAULT_NAME,
    });
  });

  it("takes a custom display name when one is given", () => {
    expect(
      superAdminConfig(env({ ...CONFIGURED, SUPER_ADMIN_NAME: "Owner Access" }))?.name,
    ).toBe("Owner Access");
  });

  it("falls back to the default name for a blank or whitespace one", () => {
    expect(superAdminConfig(env({ ...CONFIGURED, SUPER_ADMIN_NAME: "   " }))?.name).toBe(
      SUPER_ADMIN_DEFAULT_NAME,
    );
  });

  it("is null when nothing is configured", () => {
    expect(superAdminConfig(env({}))).toBeNull();
  });

  it("HALF configured is NOT configured - never invent the missing half", () => {
    // A phone with no password would create an account nobody can sign in as; a
    // password with no phone has no login. Guessing either is how a break-glass
    // account becomes a back door.
    expect(superAdminConfig(env({ SUPER_ADMIN_PHONE: "9999999999" }))).toBeNull();
    expect(superAdminConfig(env({ SUPER_ADMIN_PASSWORD: "s3cret" }))).toBeNull();
  });

  it("treats a blank or whitespace phone as unset", () => {
    expect(superAdminConfig(env({ ...CONFIGURED, SUPER_ADMIN_PHONE: "" }))).toBeNull();
    expect(superAdminConfig(env({ ...CONFIGURED, SUPER_ADMIN_PHONE: "   " }))).toBeNull();
  });

  it("trims the phone but NEVER the password", () => {
    // The phone is an identifier that gets typed and compared, so stray whitespace in
    // .env must not break the match. A password is opaque: silently eating a trailing
    // space would make .env and the login screen disagree, permanently.
    const cfg = superAdminConfig(
      env({ SUPER_ADMIN_PHONE: "  9999999999  ", SUPER_ADMIN_PASSWORD: " pass " }),
    );
    expect(cfg?.phone).toBe("9999999999");
    expect(cfg?.password).toBe(" pass ");
  });
});

describe("superAdminHalfConfigured", () => {
  it("flags exactly one of the pair being set", () => {
    expect(superAdminHalfConfigured(env({ SUPER_ADMIN_PHONE: "9999999999" }))).toBe(true);
    expect(superAdminHalfConfigured(env({ SUPER_ADMIN_PASSWORD: "s3cret" }))).toBe(true);
  });

  it("is false when both are set, and when neither is", () => {
    expect(superAdminHalfConfigured(CONFIGURED)).toBe(false);
    expect(superAdminHalfConfigured(env({}))).toBe(false);
  });
});

describe("isSuperAdminPhone", () => {
  it("recognises the configured account", () => {
    expect(isSuperAdminPhone("9999999999", CONFIGURED)).toBe(true);
  });

  it("does not protect anybody else", () => {
    expect(isSuperAdminPhone("123456789", CONFIGURED)).toBe(false);
    expect(isSuperAdminPhone("99999999990", CONFIGURED)).toBe(false); // no prefix match
    expect(isSuperAdminPhone("999999999", CONFIGURED)).toBe(false);
  });

  it("matches through stray whitespace on the stored number", () => {
    expect(isSuperAdminPhone(" 9999999999 ", CONFIGURED)).toBe(true);
  });

  it("FAILS CLOSED when no super admin is configured", () => {
    // Nothing to protect means nobody is protected. Returning true here would lock an
    // ordinary staff member out of being edited, with no way to undo it from the UI.
    expect(isSuperAdminPhone("9999999999", env({}))).toBe(false);
    expect(isSuperAdminPhone("9999999999", env({ SUPER_ADMIN_PHONE: "9999999999" }))).toBe(
      false,
    );
  });

  it("is false for a missing phone rather than throwing", () => {
    expect(isSuperAdminPhone(null, CONFIGURED)).toBe(false);
    expect(isSuperAdminPhone(undefined, CONFIGURED)).toBe(false);
    expect(isSuperAdminPhone("", CONFIGURED)).toBe(false);
  });
});
