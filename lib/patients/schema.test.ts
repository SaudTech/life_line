import { describe, expect, it } from "vitest";
import { newPatientSchema, updatePatientSchema } from "./schema";

// Helper: the first issue path for a failed parse, so tests assert WHICH field
// was rejected rather than just that something was.
function firstErrorPath(input: unknown): string | null {
  const r = newPatientSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].path.join(".");
}

describe("newPatientSchema", () => {
  const valid = {
    name: "Meera Ann",
    phone: "9876543210",
    age: 34,
    area: "Kadavanthra",
  };

  it("accepts a well-formed patient", () => {
    expect(newPatientSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts empty optional age and area", () => {
    expect(newPatientSchema.safeParse({ ...valid, age: "", area: "" }).success).toBe(true);
    // Both omitted entirely is also fine (they're optional).
    expect(newPatientSchema.safeParse({ name: "A", phone: "1234567" }).success).toBe(true);
  });

  it("accepts a valid gender and empty gender, rejects a bad one", () => {
    expect(newPatientSchema.safeParse({ ...valid, gender: "female" }).success).toBe(true);
    expect(newPatientSchema.safeParse({ ...valid, gender: "" }).success).toBe(true);
    expect(newPatientSchema.safeParse({ ...valid, gender: "unknown" }).success).toBe(false);
  });

  it("coerces a numeric-string age to a number", () => {
    const r = newPatientSchema.safeParse({ ...valid, age: "34" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.age).toBe(34);
  });

  it("rejects a blank name", () => {
    expect(firstErrorPath({ ...valid, name: "   " })).toBe("name");
  });

  it("rejects a bad phone (non-digit, too short, too long)", () => {
    expect(firstErrorPath({ ...valid, phone: "98a6543210" })).toBe("phone");
    expect(firstErrorPath({ ...valid, phone: "12345" })).toBe("phone");
    expect(firstErrorPath({ ...valid, phone: "1234567890123456" })).toBe("phone");
    expect(firstErrorPath({ ...valid, phone: "" })).toBe("phone");
  });

  it("rejects an out-of-range or non-integer age", () => {
    expect(firstErrorPath({ ...valid, age: -1 })).toBe("age");
    expect(firstErrorPath({ ...valid, age: 200 })).toBe("age");
    expect(firstErrorPath({ ...valid, age: 34.5 })).toBe("age");
  });

  it("accepts age exactly at the boundaries", () => {
    expect(newPatientSchema.safeParse({ ...valid, age: 0 }).success).toBe(true);
    expect(newPatientSchema.safeParse({ ...valid, age: 130 }).success).toBe(true);
  });
});

describe("updatePatientSchema", () => {
  const base = { name: "Meera Ann", phone: "9876543210", age: "", area: "" };

  it("requires a numeric-string id", () => {
    expect(updatePatientSchema.safeParse({ ...base, id: "12" }).success).toBe(true);
    expect(updatePatientSchema.safeParse({ ...base, id: "abc" }).success).toBe(false);
  });
});
