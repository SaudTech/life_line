import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  hasPermission,
  type PermissionKey,
} from "./permissions";

// The permission registry is the client/server single source of truth for
// authorization grants (plan §6). hasPermission gates real procedure work, so a
// rule that silently loosens (a non-admin passing a check they weren't granted) is
// a security hole. Cover the admin short-circuit, explicit grants, and empty sets.

const KEY: PermissionKey = "service_lines.modify";

describe("PERMISSION_KEYS", () => {
  it("lists exactly the registry keys", () => {
    expect(PERMISSION_KEYS).toEqual(Object.keys(PERMISSIONS));
  });

  it("every key has a label and description", () => {
    for (const k of PERMISSION_KEYS) {
      expect(PERMISSIONS[k].label.length).toBeGreaterThan(0);
      expect(PERMISSIONS[k].description.length).toBeGreaterThan(0);
    }
  });
});

describe("hasPermission - admin implies everything", () => {
  it("admin passes every key regardless of grants", () => {
    for (const k of PERMISSION_KEYS) {
      expect(hasPermission({ role: "admin", permissions: [] }, k)).toBe(true);
      expect(hasPermission({ role: "admin", permissions: [k] }, k)).toBe(true);
    }
  });
});

describe("hasPermission - non-admin needs the explicit grant", () => {
  it("returns true only when the key is granted", () => {
    expect(hasPermission({ role: "op_ip_desk", permissions: [KEY] }, KEY)).toBe(true);
    expect(hasPermission({ role: "op_desk", permissions: [KEY] }, KEY)).toBe(true);
  });

  it("returns false with empty grants", () => {
    expect(hasPermission({ role: "op_desk", permissions: [] }, KEY)).toBe(false);
  });

  it("returns false when a different key is granted", () => {
    expect(
      hasPermission({ role: "supervisor", permissions: ["other.key"] }, KEY),
    ).toBe(false);
  });

  it("supervisor is not admin - still needs the grant", () => {
    expect(hasPermission({ role: "supervisor", permissions: [] }, KEY)).toBe(false);
  });
});
