import { describe, expect, it } from "vitest";
import {
  lookupProcedureSchema,
  procedureBillFiltersSchema,
  procedureLineSchema,
  submitProcedureSchema,
} from "./schema";

describe("lookupProcedureSchema", () => {
  it("accepts a phone-only lookup", () => {
    expect(lookupProcedureSchema.safeParse({ phone: "9876543210" }).success).toBe(true);
  });

  it("accepts a consultation-number-only lookup", () => {
    expect(lookupProcedureSchema.safeParse({ consultationNumber: "42" }).success).toBe(true);
  });

  it("rejects both given at once", () => {
    expect(
      lookupProcedureSchema.safeParse({ phone: "9876543210", consultationNumber: "42" }).success,
    ).toBe(false);
  });

  it("rejects neither given", () => {
    expect(lookupProcedureSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a malformed phone or consultation number", () => {
    expect(lookupProcedureSchema.safeParse({ phone: "123" }).success).toBe(false);
    expect(lookupProcedureSchema.safeParse({ consultationNumber: "abc" }).success).toBe(false);
  });
});

describe("procedureLineSchema", () => {
  const valid = { serviceId: "5", quantity: 2 };

  it("accepts a well-formed line", () => {
    expect(procedureLineSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects quantity 0, negative, or non-integer", () => {
    expect(procedureLineSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
    expect(procedureLineSchema.safeParse({ ...valid, quantity: -1 }).success).toBe(false);
    expect(procedureLineSchema.safeParse({ ...valid, quantity: 1.5 }).success).toBe(false);
  });

  it("caps quantity so unit_price * quantity can never overflow a safe integer", () => {
    // At the 9999 cap, even the largest unit price (99 lakh rupees) stays well
    // inside Number.MAX_SAFE_INTEGER, so the stored line total is never corrupted.
    expect(procedureLineSchema.safeParse({ ...valid, quantity: 9999 }).success).toBe(true);
    expect(procedureLineSchema.safeParse({ ...valid, quantity: 10000 }).success).toBe(false);
    expect(procedureLineSchema.safeParse({ ...valid, quantity: 1e9 }).success).toBe(false);
  });

  it("rejects a bad serviceId", () => {
    expect(procedureLineSchema.safeParse({ ...valid, serviceId: "abc" }).success).toBe(false);
  });
});

describe("submitProcedureSchema", () => {
  const valid = {
    patientId: "3",
    consultationId: "7",
    lines: [{ serviceId: "5", quantity: 2 }],
    paymentMode: "cash" as const,
  };

  it("accepts a valid submission with no discount", () => {
    expect(submitProcedureSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a submission with no consultation (standalone procedure bill)", () => {
    const { consultationId: _consultationId, ...withoutConsultation } = valid;
    expect(submitProcedureSchema.safeParse(withoutConsultation).success).toBe(true);
  });

  it("rejects a submission with no patientId", () => {
    const { patientId: _patientId, ...withoutPatient } = valid;
    expect(submitProcedureSchema.safeParse(withoutPatient).success).toBe(false);
  });

  it("rejects an empty lines array", () => {
    expect(submitProcedureSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it("rejects a bad line inside the array", () => {
    expect(
      submitProcedureSchema.safeParse({
        ...valid,
        lines: [{ serviceId: "5", quantity: 0 }],
      }).success,
    ).toBe(false);
  });

  it("accepts an optional discount percentage and PIN", () => {
    expect(
      submitProcedureSchema.safeParse({ ...valid, discountPct: 10, discountPin: "1234" }).success,
    ).toBe(true);
  });

  it("rejects an out-of-range discount percentage", () => {
    expect(submitProcedureSchema.safeParse({ ...valid, discountPct: 150 }).success).toBe(false);
  });

  it("rejects a malformed discount amount", () => {
    expect(submitProcedureSchema.safeParse({ ...valid, discountAmount: "abc" }).success).toBe(
      false,
    );
  });

  it("rejects an invalid payment mode", () => {
    expect(submitProcedureSchema.safeParse({ ...valid, paymentMode: "bitcoin" }).success).toBe(
      false,
    );
  });
});

describe("procedureBillFiltersSchema", () => {
  it("accepts an empty filter set (no narrowing)", () => {
    expect(procedureBillFiltersSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a full set of well-formed filters", () => {
    expect(
      procedureBillFiltersSchema.safeParse({
        q: "meera",
        createdBy: "9d3f6b2e-6b7a-4c1a-8f0a-1e2d3c4b5a69",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        minAmount: "100",
        maxAmount: "500.50",
        serviceId: "5",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-UUID createdBy", () => {
    expect(procedureBillFiltersSchema.safeParse({ createdBy: "5" }).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(procedureBillFiltersSchema.safeParse({ dateFrom: "01-01-2026" }).success).toBe(false);
    expect(procedureBillFiltersSchema.safeParse({ dateTo: "not-a-date" }).success).toBe(false);
  });

  it("rejects a malformed amount", () => {
    expect(procedureBillFiltersSchema.safeParse({ minAmount: "abc" }).success).toBe(false);
    expect(procedureBillFiltersSchema.safeParse({ maxAmount: "-5" }).success).toBe(false);
  });

  it("rejects a bad serviceId", () => {
    expect(procedureBillFiltersSchema.safeParse({ serviceId: "abc" }).success).toBe(false);
  });
});
