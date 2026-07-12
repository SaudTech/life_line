import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  hasPermission,
} from "./permissions";

// The permission registry is the client/server single source of truth for
// authorization grants. It is INTENTIONALLY EMPTY today: the only former grant was
// retired once procedure billing became a plain counter-ROLE capability. These
// tests pin the empty-registry reality - admin still implies everything (vacuously
// true here) and no unknown key ever passes - so a future grant is added
// deliberately, with its own tests.

describe("PERMISSION_KEYS", () => {
  it("lists exactly the registry keys", () => {
    expect(PERMISSION_KEYS).toEqual(Object.keys(PERMISSIONS));
  });

  it("is empty until a real grantable capability exists", () => {
    expect(PERMISSION_KEYS).toEqual([]);
  });
});

describe("hasPermission - admin implies everything", () => {
  it("admin passes every registered key (vacuously true while empty)", () => {
    for (const k of PERMISSION_KEYS) {
      expect(hasPermission({ role: "admin", permissions: [] }, k)).toBe(true);
    }
  });
});

describe("hasPermission - a non-admin with no grants never passes", () => {
  it("returns false for any key when the grant list is empty", () => {
    // With an empty registry every non-admin's grant list is empty, so no key
    // passes. (Storing an unknown key is prevented upstream by the schema, plan
    // B-4 - hasPermission itself only tests the granted list.)
    const key = "some.retired.grant" as never;
    expect(hasPermission({ role: "op_desk", permissions: [] }, key)).toBe(false);
    expect(hasPermission({ role: "op_ip_desk", permissions: [] }, key)).toBe(false);
    expect(hasPermission({ role: "supervisor", permissions: [] }, key)).toBe(false);
  });

  it("admin still short-circuits to true for any key", () => {
    const anyKey = "anything.at.all" as never;
    expect(hasPermission({ role: "admin", permissions: [] }, anyKey)).toBe(true);
  });
});
