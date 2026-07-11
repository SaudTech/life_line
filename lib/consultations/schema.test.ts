import { describe, expect, it } from "vitest";
import { lookupPhoneSchema, startConsultationSchema } from "./schema";

describe("lookupPhoneSchema", () => {
  it("accepts a valid phone", () => {
    expect(lookupPhoneSchema.safeParse({ phone: "9876543210" }).success).toBe(true);
  });
  it("rejects a non-digit / short phone", () => {
    expect(lookupPhoneSchema.safeParse({ phone: "98a" }).success).toBe(false);
    expect(lookupPhoneSchema.safeParse({ phone: "123" }).success).toBe(false);
  });
});

describe("startConsultationSchema", () => {
  const newPatient = { name: "Meera Ann", phone: "9876543210", age: 34, area: "" };

  it("accepts an existing patient (id only)", () => {
    expect(
      startConsultationSchema.safeParse({ doctorId: "10", patientId: "5" }).success,
    ).toBe(true);
  });

  it("accepts a new patient (details only)", () => {
    expect(
      startConsultationSchema.safeParse({ doctorId: "10", newPatient }).success,
    ).toBe(true);
  });

  it("rejects BOTH an id and new-patient details at once", () => {
    expect(
      startConsultationSchema.safeParse({ doctorId: "10", patientId: "5", newPatient })
        .success,
    ).toBe(false);
  });

  it("rejects NEITHER patient path", () => {
    expect(startConsultationSchema.safeParse({ doctorId: "10" }).success).toBe(false);
  });

  it("requires a doctorId", () => {
    expect(startConsultationSchema.safeParse({ patientId: "5" }).success).toBe(false);
  });
});
