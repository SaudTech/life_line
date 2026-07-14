import { describe, expect, it } from "vitest";
import {
  buildConsultationDocument,
  buildProcedureDocument,
  type BillDocumentCore,
} from "./bill-document";

const BASE_CORE: BillDocumentCore = {
  locationId: "1",
  hospitalName: "Life Line",
  hospitalTagline: "A MULTI SPECIALITY HOSPITAL",
  hospitalAddress: "Chandrayangutta 'X' Road, Hyderabad - 500 005",
  hospitalPhone: "Tel: 6309192617, 6309192618, 7382003300",
  footerNote: "Thank you. Get well soon.",
  billNumber: "1042",
  dateText: "09 Jul 2026",
  timeText: "11:30 AM",
  status: "final",
  subtotalPaise: "50000",
  discountPaise: "0",
  totalPaise: "50000",
  paymentMode: "cash",
  patientCode: "LL000123",
  patientName: "Asha Rao",
  patientAge: 34,
  patientGender: "female",
  patientPhone: "9876543210",
  patientArea: "Kukatpally",
  cashierName: "Meera",
};

describe("buildConsultationDocument", () => {
  it("shapes the common fields and the consultation-only fields", () => {
    const doc = buildConsultationDocument(BASE_CORE, {
      doctorName: "Dr. Anita",
      reason: "Fever",
      validUntilText: "16 Jul 2026",
    });
    expect(doc.type).toBe("consultation");
    expect(doc.hospital).toEqual({
      name: "Life Line",
      tagline: "A MULTI SPECIALITY HOSPITAL",
      address: "Chandrayangutta 'X' Road, Hyderabad - 500 005",
      phone: "Tel: 6309192617, 6309192618, 7382003300",
    });
    expect(doc.bill).toEqual({
      number: "1042",
      dateText: "09 Jul 2026",
      timeText: "11:30 AM",
      statusLabel: undefined, // final bills carry no watermark label
    });
    expect(doc.patient.ageGender).toBe("34 / Female");
    expect(doc.payment).toEqual({ modeLabel: "Cash", cashierName: "Meera" });
    expect(doc.totals.subtotalText).toBe("₹500.00");
    expect(doc.totals.discountText).toBeUndefined(); // no discount on this bill
    expect(doc.totals.totalText).toBe("₹500.00");
    expect(doc.totals.totalInWords).toBe("Five Hundred Rupees Only");
    expect(doc.doctorName).toBe("Dr. Anita");
    expect(doc.reason).toBe("Fever");
    expect(doc.validUntilText).toBe("16 Jul 2026");
  });

  it("shows a discount line only when a discount was applied", () => {
    const doc = buildConsultationDocument(
      { ...BASE_CORE, discountPaise: "5000", totalPaise: "45000" },
      { doctorName: "Dr. Anita", reason: null, validUntilText: "16 Jul 2026" },
    );
    expect(doc.totals.discountText).toBe("₹50.00");
    expect(doc.reason).toBeUndefined();
  });

  it("surfaces a watermark label for pending/void bills", () => {
    const pending = buildConsultationDocument(
      { ...BASE_CORE, status: "pending_approval" },
      { doctorName: "Dr. Anita", reason: null, validUntilText: "16 Jul 2026" },
    );
    expect(pending.bill.statusLabel).toBe("PENDING APPROVAL");

    const voided = buildConsultationDocument(
      { ...BASE_CORE, status: "void" },
      { doctorName: "Dr. Anita", reason: null, validUntilText: "16 Jul 2026" },
    );
    expect(voided.bill.statusLabel).toBe("VOID");
  });

  it("omits ageGender when neither is known", () => {
    const doc = buildConsultationDocument(
      { ...BASE_CORE, patientAge: null, patientGender: null },
      { doctorName: "Dr. Anita", reason: null, validUntilText: "16 Jul 2026" },
    );
    expect(doc.patient.ageGender).toBeUndefined();
  });
});

describe("buildProcedureDocument", () => {
  it("formats each line item's money and keeps zero expenses as an empty list", () => {
    const doc = buildProcedureDocument(BASE_CORE, [
      { description: "IV Fluid", quantity: 2, unitPricePaise: "15000", lineTotalPaise: "30000" },
      { description: "Injection", quantity: 1, unitPricePaise: "20000", lineTotalPaise: "20000" },
    ]);
    expect(doc.type).toBe("procedure");
    expect(doc.items).toEqual([
      { desc: "IV Fluid", qty: "2", unitText: "₹150.00", lineText: "₹300.00" },
      { desc: "Injection", qty: "1", unitText: "₹200.00", lineText: "₹200.00" },
    ]);
  });

  it("handles no items", () => {
    const doc = buildProcedureDocument(BASE_CORE, []);
    expect(doc.items).toEqual([]);
  });
});
