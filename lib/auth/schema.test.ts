import { describe, expect, it } from "vitest";
import { loginSchema } from "./schema";

// The login schema is the client/server single source of truth (plan D4). These
// cover the presence-only rules and the exact user-facing messages - validation
// is intentionally light so it never leaks hints about valid credentials.
describe("loginSchema", () => {
  it("accepts a present phone and password", () => {
    const result = loginSchema.safeParse({ phone: "9876543210", password: "hunter2" });
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace on phone", () => {
    const result = loginSchema.safeParse({ phone: "  9876543210  ", password: "hunter2" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("9876543210");
    }
  });

  it("rejects an empty phone with the field message", () => {
    const result = loginSchema.safeParse({ phone: "", password: "hunter2" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const phoneIssue = result.error.issues.find((i) => i.path[0] === "phone");
      expect(phoneIssue?.message).toBe("Enter your phone number.");
    }
  });

  it("rejects a whitespace-only phone (trims to empty)", () => {
    const result = loginSchema.safeParse({ phone: "   ", password: "hunter2" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const phoneIssue = result.error.issues.find((i) => i.path[0] === "phone");
      expect(phoneIssue?.message).toBe("Enter your phone number.");
    }
  });

  it("rejects an empty password with the field message", () => {
    const result = loginSchema.safeParse({ phone: "9876543210", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const passwordIssue = result.error.issues.find((i) => i.path[0] === "password");
      expect(passwordIssue?.message).toBe("Enter your password.");
    }
  });

  it("reports both fields when both are empty", () => {
    const result = loginSchema.safeParse({ phone: "", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("phone");
      expect(paths).toContain("password");
    }
  });
});
