import { describe, expect, it } from "vitest";
import {
  advanceReceiptToInputs,
  buildAdvanceReceiptDocument,
  sampleAdvanceReceiptDocument,
} from "./advance-receipt";
import { fieldKeysForType, fieldKind, isKnownField } from "./fields";
import { ADVANCE_RECEIPT_DEFAULT_TEMPLATE } from "./defaults/advance-receipt";

// The advance receipt's catalog / mapper / seed template must stay in sync -
// the same invariant fields.test.ts holds for the bill types (a designed field
// and its input must never silently disagree on key or wire shape).

describe("advance catalog / resolver output stay in sync", () => {
  it("advanceReceiptToInputs emits exactly the advance catalog's keys", () => {
    const inputs = advanceReceiptToInputs(sampleAdvanceReceiptDocument());
    expect(Object.keys(inputs).sort()).toEqual(fieldKeysForType("advance").sort());
  });

  it("wraps labeled keys as multiVariableText JSON and leaves plain keys raw", () => {
    const doc = sampleAdvanceReceiptDocument();
    const inputs = advanceReceiptToInputs(doc);
    // Labeled: the caption survives generation only via the JSON variables wrap.
    expect(fieldKind("receiptRef")).toBe("labeled");
    expect(JSON.parse(inputs.receiptRef)).toEqual({ receiptRef: doc.reference });
    expect(fieldKind("patientName")).toBe("labeled");
    expect(JSON.parse(inputs.patientName)).toEqual({ patientName: doc.patient.name });
    // Plain: the big amount and letterhead are bare values, no label, no wrap.
    expect(fieldKind("advanceAmountText")).toBe("plain");
    expect(inputs.advanceAmountText).toBe(doc.advanceText);
    expect(fieldKind("hospitalName")).toBe("plain");
    expect(inputs.hospitalName).toBe(doc.hospital.name);
  });

  it("does not reuse the ip catalog's `advanceText` key (labeled there, plain here)", () => {
    // Regression guard: KIND_BY_KEY is global and later-wins - reusing the key
    // with a different kind would corrupt the ip invoice's wire format.
    expect(isKnownField("advance", "advanceText")).toBe(false);
    expect(isKnownField("advance", "advanceAmountText")).toBe(true);
    expect(fieldKind("advanceText")).toBe("labeled"); // ip's, untouched
  });
});

describe("ADVANCE_RECEIPT_DEFAULT_TEMPLATE binds only known advance fields", () => {
  it("every data field's name is an advance catalog key (designer save-valid)", () => {
    const schemas = (
      ADVANCE_RECEIPT_DEFAULT_TEMPLATE as unknown as {
        schemas: { name: string; type: string; readOnly?: boolean }[][];
      }
    ).schemas;
    // Same filter as validateTemplateForType (lib/printing/actions.ts): shapes
    // and readOnly captions are exempt; text/multiVariableText/table must bind.
    const dataFieldNames = schemas
      .flat()
      .filter(
        (f) =>
          !f.readOnly &&
          (f.type === "text" || f.type === "multiVariableText" || f.type === "table"),
      )
      .map((f) => f.name);
    expect(dataFieldNames.length).toBeGreaterThan(0);
    for (const name of dataFieldNames) {
      expect(isKnownField("advance", name), `unknown field "${name}"`).toBe(true);
    }
  });
});

describe("buildAdvanceReceiptDocument", () => {
  const core = {
    locationId: "1",
    hospitalName: "Life Line",
    hospitalTagline: null,
    hospitalAddress: null,
    hospitalPhone: null,
    footerNote: null,
    admissionId: "128",
    admittedDateText: "01 Jul 2026",
    advancePaise: "500000",
    paymentMode: "cash",
    patientCode: "LL000123",
    patientName: "Asha Rao",
    patientAge: 34,
    patientGender: "female",
    patientPhone: "9876543210",
  };

  it("formats the advance in rupees and words, and maps the reference", () => {
    const doc = buildAdvanceReceiptDocument(core);
    expect(doc.reference).toBe("128");
    expect(doc.advanceText).toBe("₹5,000.00");
    expect(doc.advanceInWords).toBe("Five Thousand Rupees Only");
    expect(doc.paymentModeLabel).toBe("Cash");
    expect(doc.patient.ageGender).toBe("34 / Female");
  });

  it("omits ageGender when both parts are missing and payment label when no mode", () => {
    const doc = buildAdvanceReceiptDocument({
      ...core,
      patientAge: null,
      patientGender: null,
      paymentMode: null,
    });
    expect(doc.patient.ageGender).toBeUndefined();
    expect(doc.paymentModeLabel).toBeUndefined();
  });
});
