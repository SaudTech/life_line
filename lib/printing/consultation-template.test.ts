import { describe, it, expect } from "vitest";
import { isUsableConsultationTemplate } from "./consultation-template";

// The per-doctor design rule (migration 0024). Every case that must fall back to
// the location's ACTIVE consultation design is asserted here - a doctor's
// receipt must never fail to print, and must never print the wrong layout.
describe("isUsableConsultationTemplate", () => {
  const LOC = "1";

  it("accepts a consultation design at the same location", () => {
    expect(isUsableConsultationTemplate({ bill_type: "consultation", location_id: "1" }, LOC)).toBe(
      true,
    );
  });

  it("rejects when the doctor has no design assigned", () => {
    expect(isUsableConsultationTemplate(null, LOC)).toBe(false);
    expect(isUsableConsultationTemplate(undefined, LOC)).toBe(false);
  });

  it("rejects a design of another bill type", () => {
    for (const bill_type of ["procedure", "ip", "advance", "end_day"]) {
      expect(isUsableConsultationTemplate({ bill_type, location_id: "1" }, LOC)).toBe(false);
    }
  });

  it("rejects a design belonging to another location", () => {
    expect(isUsableConsultationTemplate({ bill_type: "consultation", location_id: "2" }, LOC)).toBe(
      false,
    );
  });

  // pg returns BIGINT columns as strings, but a caller holding a number must not
  // silently fall through to the default design.
  it("compares location ids by value, not by type", () => {
    expect(
      isUsableConsultationTemplate(
        { bill_type: "consultation", location_id: 1 as unknown as string },
        LOC,
      ),
    ).toBe(true);
  });
});
