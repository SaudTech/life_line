import { describe, expect, it } from "vitest";
import {
  newDoctorSchema,
  updateDoctorSchema,
  setDoctorActiveSchema,
} from "./schema";

// Helper: the first issue path for a failed parse, so tests assert WHICH field
// was rejected rather than just that something was.
function firstErrorPath(input: unknown): string | null {
  const r = newDoctorSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].path.join(".");
}

describe("newDoctorSchema", () => {
  const valid = {
    name: "Dr. Anita Rao",
    department: "Cardiology",
    fee: "250.50",
    revisitValidityDays: 7,
  };

  it("accepts a well-formed doctor", () => {
    const r = newDoctorSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("accepts an empty department (stored as NULL later)", () => {
    const r = newDoctorSchema.safeParse({ ...valid, department: "" });
    expect(r.success).toBe(true);
  });

  it("coerces a numeric-string validity to a number", () => {
    const r = newDoctorSchema.safeParse({ ...valid, revisitValidityDays: "7" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.revisitValidityDays).toBe(7);
  });

  it("rejects a blank name", () => {
    expect(firstErrorPath({ ...valid, name: "   " })).toBe("name");
  });

  it("rejects a bad fee", () => {
    expect(firstErrorPath({ ...valid, fee: "abc" })).toBe("fee");
    expect(firstErrorPath({ ...valid, fee: "1.234" })).toBe("fee");
    expect(firstErrorPath({ ...valid, fee: "" })).toBe("fee");
  });

  it("rejects negative or non-integer validity", () => {
    expect(firstErrorPath({ ...valid, revisitValidityDays: -1 })).toBe(
      "revisitValidityDays",
    );
    expect(firstErrorPath({ ...valid, revisitValidityDays: 1.5 })).toBe(
      "revisitValidityDays",
    );
  });
});

describe("updateDoctorSchema", () => {
  it("requires a numeric-string id", () => {
    const base = {
      name: "Dr. X",
      department: "",
      fee: "300",
      revisitValidityDays: 0,
    };
    expect(updateDoctorSchema.safeParse({ ...base, id: "12" }).success).toBe(true);
    expect(updateDoctorSchema.safeParse({ ...base, id: "abc" }).success).toBe(false);
  });
});

describe("setDoctorActiveSchema", () => {
  it("takes an id and a boolean active flag", () => {
    expect(setDoctorActiveSchema.safeParse({ id: "5", active: false }).success).toBe(true);
    expect(setDoctorActiveSchema.safeParse({ id: "5", active: "no" }).success).toBe(false);
  });
});
