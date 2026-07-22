import { describe, expect, it } from "vitest";
import { newDepartmentSchema, deleteDepartmentSchema } from "./schema";

describe("newDepartmentSchema", () => {
  it("accepts a well-formed department", () => {
    expect(newDepartmentSchema.safeParse({ name: "Cardiologist" }).success).toBe(true);
  });

  it("trims the name", () => {
    const r = newDepartmentSchema.safeParse({ name: "  Cardiologist  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Cardiologist");
  });

  it("rejects a blank name", () => {
    expect(newDepartmentSchema.safeParse({ name: "" }).success).toBe(false);
    expect(newDepartmentSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name over 100 characters", () => {
    expect(newDepartmentSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
  });
});

describe("deleteDepartmentSchema", () => {
  it("requires a numeric-string id", () => {
    expect(deleteDepartmentSchema.safeParse({ id: "12" }).success).toBe(true);
    expect(deleteDepartmentSchema.safeParse({ id: "abc" }).success).toBe(false);
  });
});
