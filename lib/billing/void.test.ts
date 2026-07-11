import { describe, expect, it } from "vitest";
import { canVoidBill, consultationExpiryOnVoid } from "./void";
import { isConsultationValid, isRevisitFree } from "@/lib/consultations/rules";

describe("canVoidBill", () => {
  it("allows voiding a finalized bill", () => {
    expect(canVoidBill("final")).toBe(true);
  });
  it("blocks voiding an already-void bill (void is one-shot)", () => {
    expect(canVoidBill("void")).toBe(false);
  });
  it("blocks voiding a bill still pending approval", () => {
    expect(canVoidBill("pending_approval")).toBe(false);
  });
});

describe("consultationExpiryOnVoid", () => {
  it("expires the consultation to the day before today", () => {
    expect(consultationExpiryOnVoid("2026-07-11")).toBe("2026-07-10");
  });
  it("handles a month boundary", () => {
    expect(consultationExpiryOnVoid("2026-08-01")).toBe("2026-07-31");
  });

  // The rule the plan asks to prove (§2b): after voiding a consultation bill and
  // expiring its consultation to yesterday, that consultation must no longer pass
  // the revisit-eligibility check - not even on the same clinic day.
  it("makes a voided consultation fail the revisit check the same day", () => {
    const today = "2026-07-11";
    const expired = consultationExpiryOnVoid(today);
    expect(isConsultationValid(expired, today)).toBe(false);
    expect(
      isRevisitFree(
        { doctorId: "7", validUntil: expired },
        { doctorId: "7", on: today },
      ),
    ).toBe(false);
  });

  it("left a still-valid consultation a free revisit before it was voided", () => {
    // Sanity anchor: with a normal (unexpired) validity, the same visit WAS free -
    // so the failure above is the void's doing, not a broken rule.
    const today = "2026-07-11";
    expect(
      isRevisitFree(
        { doctorId: "7", validUntil: today },
        { doctorId: "7", on: today },
      ),
    ).toBe(true);
  });
});
