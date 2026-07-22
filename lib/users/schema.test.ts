import { describe, expect, it } from "vitest";
import {
  newUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  resetPasswordFormSchema,
  changeOwnPasswordSchema,
  changeOwnPasswordFormSchema,
  setPinSchema,
  setPinFormSchema,
  ROLES,
} from "./schema";

// The user-management schemas are the client/server single source of truth for
// validation (plan §8). These cover the happy path plus every field failure and
// the boundary cases the plan calls out - the schemas gate real staff accounts,
// so a rule that silently loosens is a security hole.

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function issueFor(
  result: ReturnType<typeof newUserSchema.safeParse>,
  field: string,
): string | undefined {
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path[0] === field)?.message;
}

describe("newUserSchema", () => {
  const base = {
    name: "Asha Nair",
    phone: "9876543210",
    role: "op_desk" as const,
    password: "hunter2!!",
  };

  it("accepts a minimal valid new user (no email, no pin)", () => {
    expect(newUserSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a full valid new user (email + pin)", () => {
    const result = newUserSchema.safeParse({
      ...base,
      role: "supervisor",
      email: "asha@example.com",
      pin: "1234",
    });
    expect(result.success).toBe(true);
  });

  it("allows empty email and empty pin", () => {
    const result = newUserSchema.safeParse({ ...base, email: "", pin: "" });
    expect(result.success).toBe(true);
  });

  it("trims the name", () => {
    const result = newUserSchema.safeParse({ ...base, name: "  Asha Nair  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Asha Nair");
  });

  it("rejects a blank name", () => {
    const result = newUserSchema.safeParse({ ...base, name: "   " });
    expect(issueFor(result, "name")).toBe("Name is required.");
  });

  it("rejects a name over 100 characters", () => {
    const result = newUserSchema.safeParse({ ...base, name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects a non-digit phone", () => {
    const result = newUserSchema.safeParse({ ...base, phone: "98765abcde" });
    expect(issueFor(result, "phone")).toBe(
      "Enter a valid phone number (7-15 digits).",
    );
  });

  it("rejects a too-short phone (6 digits)", () => {
    const result = newUserSchema.safeParse({ ...base, phone: "123456" });
    expect(issueFor(result, "phone")).toBeDefined();
  });

  it("rejects a too-long phone (16 digits)", () => {
    const result = newUserSchema.safeParse({ ...base, phone: "1".repeat(16) });
    expect(issueFor(result, "phone")).toBeDefined();
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = newUserSchema.safeParse({ ...base, password: "short12" });
    expect(issueFor(result, "password")).toBe(
      "Password must be at least 8 characters.",
    );
  });

  it("rejects a role not in ROLES", () => {
    const result = newUserSchema.safeParse({ ...base, role: "root" });
    expect(issueFor(result, "role")).toBeDefined();
  });

  it("accepts every role in ROLES", () => {
    for (const role of ROLES) {
      expect(newUserSchema.safeParse({ ...base, role }).success).toBe(true);
    }
  });

  it("rejects a malformed email", () => {
    const result = newUserSchema.safeParse({ ...base, email: "not-an-email" });
    expect(issueFor(result, "email")).toBeDefined();
  });

  it("rejects a non-digit / wrong-length pin", () => {
    expect(newUserSchema.safeParse({ ...base, pin: "12" }).success).toBe(false);
    expect(newUserSchema.safeParse({ ...base, pin: "abcd" }).success).toBe(false);
    expect(newUserSchema.safeParse({ ...base, pin: "1234567" }).success).toBe(
      false,
    );
  });
});

describe("updateUserSchema", () => {
  const base = {
    id: VALID_ID,
    name: "Asha Nair",
    phone: "9876543210",
    role: "op_desk" as const,
  };

  it("accepts a valid update", () => {
    expect(updateUserSchema.safeParse(base).success).toBe(true);
  });

  it("has no password field (edit never touches the password)", () => {
    expect("password" in updateUserSchema.shape).toBe(false);
  });

  it("requires a uuid id", () => {
    const result = updateUserSchema.safeParse({ ...base, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts an 8-character password", () => {
    const result = resetPasswordSchema.safeParse({
      id: VALID_ID,
      password: "12345678",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a 7-character password (boundary)", () => {
    const result = resetPasswordSchema.safeParse({
      id: VALID_ID,
      password: "1234567",
    });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordFormSchema (confirm-twice)", () => {
  it("accepts two matching passwords", () => {
    const r = resetPasswordFormSchema.safeParse({
      password: "hunter22",
      confirmPassword: "hunter22",
    });
    expect(r.success).toBe(true);
  });

  it("rejects mismatched passwords on confirmPassword", () => {
    const r = resetPasswordFormSchema.safeParse({
      password: "hunter22",
      confirmPassword: "hunter23",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "confirmPassword");
      expect(issue?.message).toBe("Passwords do not match.");
    }
  });

  it("still enforces the 8-char minimum", () => {
    const r = resetPasswordFormSchema.safeParse({
      password: "short12",
      confirmPassword: "short12",
    });
    expect(r.success).toBe(false);
  });
});

describe("changeOwnPasswordSchema (self-service)", () => {
  it("accepts a current password plus a valid new one", () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: "oldpass99",
      password: "newpass99",
    });
    expect(r.success).toBe(true);
  });

  it("has no id field (the target is always the session user)", () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: "oldpass99",
      password: "newpass99",
    });
    expect(r.success).toBe(true);
    if (r.success) expect("id" in r.data).toBe(false);
  });

  it("rejects an empty current password", () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: "",
      password: "newpass99",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "currentPassword");
      expect(issue?.message).toBe("Enter your current password.");
    }
  });

  it("rejects a new password under 8 characters (boundary)", () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: "oldpass99",
      password: "short12",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a new password identical to the current one", () => {
    const r = changeOwnPasswordSchema.safeParse({
      currentPassword: "samepass9",
      password: "samepass9",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "password");
      expect(issue?.message).toBe(
        "New password must be different from the current one.",
      );
    }
  });
});

describe("changeOwnPasswordFormSchema (confirm-twice)", () => {
  const base = {
    currentPassword: "oldpass99",
    password: "newpass99",
    confirmPassword: "newpass99",
  };

  it("accepts matching new passwords", () => {
    expect(changeOwnPasswordFormSchema.safeParse(base).success).toBe(true);
  });

  it("rejects mismatched passwords on confirmPassword", () => {
    const r = changeOwnPasswordFormSchema.safeParse({
      ...base,
      confirmPassword: "newpass98",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "confirmPassword");
      expect(issue?.message).toBe("Passwords do not match.");
    }
  });

  it("rejects reusing the current password even when both copies match", () => {
    const r = changeOwnPasswordFormSchema.safeParse({
      currentPassword: "samepass9",
      password: "samepass9",
      confirmPassword: "samepass9",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "password");
      expect(issue?.message).toBe(
        "New password must be different from the current one.",
      );
    }
  });

  it("still enforces the 8-char minimum", () => {
    const r = changeOwnPasswordFormSchema.safeParse({
      currentPassword: "oldpass99",
      password: "short12",
      confirmPassword: "short12",
    });
    expect(r.success).toBe(false);
  });
});

describe("setPinFormSchema (confirm-twice)", () => {
  it("accepts two matching pins", () => {
    expect(setPinFormSchema.safeParse({ pin: "1234", confirmPin: "1234" }).success).toBe(true);
  });

  it("rejects mismatched pins on confirmPin", () => {
    const r = setPinFormSchema.safeParse({ pin: "1234", confirmPin: "4321" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "confirmPin");
      expect(issue?.message).toBe("PINs do not match.");
    }
  });

  it("rejects a non-digit pin", () => {
    expect(setPinFormSchema.safeParse({ pin: "abcd", confirmPin: "abcd" }).success).toBe(false);
  });
});

describe("setPinSchema", () => {
  it("accepts a 4-digit pin", () => {
    expect(setPinSchema.safeParse({ id: VALID_ID, pin: "1234" }).success).toBe(
      true,
    );
  });

  it("accepts a 6-digit pin", () => {
    expect(setPinSchema.safeParse({ id: VALID_ID, pin: "123456" }).success).toBe(
      true,
    );
  });

  it("accepts an empty pin (clears it)", () => {
    expect(setPinSchema.safeParse({ id: VALID_ID, pin: "" }).success).toBe(true);
  });

  it("rejects a 3-digit pin (boundary)", () => {
    expect(setPinSchema.safeParse({ id: VALID_ID, pin: "123" }).success).toBe(
      false,
    );
  });

  it("rejects a 7-digit pin (boundary)", () => {
    expect(setPinSchema.safeParse({ id: VALID_ID, pin: "1234567" }).success).toBe(
      false,
    );
  });
});
