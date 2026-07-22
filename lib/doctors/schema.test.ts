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
    department: "Cardiologist",
    phone: "9876543210",
    status: "available",
    fee: "250.50",
    revisitValidityDays: 7,
    doctorShareType: "percentage",
    doctorShareValue: "40",
  };

  it("accepts a well-formed doctor", () => {
    const r = newDoctorSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects an empty department (required, though the list itself now lives in the DB)", () => {
    expect(firstErrorPath({ ...valid, department: "" })).toBe("department");
  });

  it("rejects a whitespace-only department", () => {
    expect(firstErrorPath({ ...valid, department: "   " })).toBe("department");
  });

  it("rejects an empty phone (now required)", () => {
    expect(firstErrorPath({ ...valid, phone: "" })).toBe("phone");
  });

  it("rejects a malformed phone", () => {
    expect(firstErrorPath({ ...valid, phone: "123" })).toBe("phone");
  });

  it("rejects an unknown status", () => {
    expect(firstErrorPath({ ...valid, status: "napping" })).toBe("status");
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

  it("gives a 'too large' message (not a format error) for a fee over the cap", () => {
    const r = newDoctorSchema.safeParse({ ...valid, fee: "99999999" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/too large/i);
  });

  it("rejects negative or non-integer validity", () => {
    expect(firstErrorPath({ ...valid, revisitValidityDays: -1 })).toBe(
      "revisitValidityDays",
    );
    expect(firstErrorPath({ ...valid, revisitValidityDays: 1.5 })).toBe(
      "revisitValidityDays",
    );
  });

  it("accepts a flat-amount share", () => {
    const r = newDoctorSchema.safeParse({
      ...valid,
      doctorShareType: "flat",
      doctorShareValue: "500.50",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a percentage share over 100", () => {
    expect(
      firstErrorPath({ ...valid, doctorShareType: "percentage", doctorShareValue: "101" }),
    ).toBe("doctorShareValue");
  });

  it("rejects a non-whole percentage share", () => {
    expect(
      firstErrorPath({ ...valid, doctorShareType: "percentage", doctorShareValue: "40.5" }),
    ).toBe("doctorShareValue");
  });

  it("rejects a malformed flat-amount share", () => {
    expect(
      firstErrorPath({ ...valid, doctorShareType: "flat", doctorShareValue: "abc" }),
    ).toBe("doctorShareValue");
  });

  it("gives a 'too large' message for a flat-amount share over the cap", () => {
    const r = newDoctorSchema.safeParse({
      ...valid,
      doctorShareType: "flat",
      doctorShareValue: "99999999",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/too large/i);
  });

  it("rejects an unknown share type", () => {
    expect(firstErrorPath({ ...valid, doctorShareType: "lump_sum" })).toBe("doctorShareType");
  });
});

describe("updateDoctorSchema", () => {
  it("requires a numeric-string id", () => {
    const base = {
      name: "Dr. X",
      department: "General Physician",
      phone: "9876543210",
      status: "available",
      fee: "300",
      revisitValidityDays: 0,
      doctorShareType: "percentage",
      doctorShareValue: "40",
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
