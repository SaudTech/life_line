import { describe, expect, it } from "vitest";
import {
  billDocumentToInputs,
  fieldKeysForType,
  fieldKind,
  isKnownField,
  labelFor,
  sampleBillDocument,
  type BillType,
} from "./fields";

// `end_day` is a designable report template (print-updates plan §4); `advance`
// has no catalog/sample, so it isn't exercised here.
const TYPES: BillType[] = ["consultation", "procedure", "ip", "end_day"];

describe("fields catalog / resolver output stay in sync", () => {
  it.each(TYPES)(
    "billDocumentToInputs(%s sample) emits exactly the catalog's keys for that type",
    (type) => {
      const doc = sampleBillDocument(type);
      const inputs = billDocumentToInputs(doc);
      expect(Object.keys(inputs).sort()).toEqual(fieldKeysForType(type).sort());
    },
  );
});

describe("end_day report inputs", () => {
  it("encodes the three End-Day tables as JSON 2D arrays for pdfme table fields", () => {
    const doc = sampleBillDocument("end_day");
    if (doc.type !== "end_day") throw new Error("expected an end_day document");
    const inputs = billDocumentToInputs(doc);
    expect(fieldKind("modeTable")).toBe("table");
    expect(fieldKind("typeTable")).toBe("table");
    expect(fieldKind("activityTable")).toBe("table");
    expect(JSON.parse(inputs.modeTable)[0]).toEqual(["Cash", "11", "₹7,200.00"]);
    expect(JSON.parse(inputs.typeTable)[0]).toEqual(["Consultation", "12", "₹6,000.00"]);
    expect(JSON.parse(inputs.activityTable)[0]).toEqual(["Patients registered", "4"]);
  });

  it("wraps a labeled figure as multiVariableText JSON and leaves hospitalName plain", () => {
    const doc = sampleBillDocument("end_day");
    const inputs = billDocumentToInputs(doc);
    expect(fieldKind("grandTotalText")).toBe("labeled");
    expect(JSON.parse(inputs.grandTotalText)).toEqual({ grandTotalText: "₹12,450.00" });
    expect(fieldKind("hospitalName")).toBe("plain");
    expect(inputs.hospitalName).toBe("Life Line");
  });
});

describe("isKnownField", () => {
  it("accepts fields that belong to a type and rejects fields from a different type", () => {
    expect(isKnownField("consultation", "doctorName")).toBe(true);
    expect(isKnownField("consultation", "items")).toBe(false); // procedure-only
    expect(isKnownField("procedure", "items")).toBe(true);
    expect(isKnownField("procedure", "hospitalName")).toBe(true); // common field
  });

  it("rejects unknown keys", () => {
    expect(isKnownField("consultation", "somethingMadeUp")).toBe(false);
  });
});

describe("billDocumentToInputs table encoding", () => {
  it("encodes procedure items as a JSON 2D array for the pdfme table field", () => {
    const doc = sampleBillDocument("procedure");
    const inputs = billDocumentToInputs(doc);
    expect(JSON.parse(inputs.items)).toEqual([
      ["IV Fluid", "2", "₹150.00", "₹300.00"],
      ["Injection", "1", "₹150.00", "₹150.00"],
    ]);
  });
});

describe("billDocumentToInputs labeled/plain wire shapes", () => {
  // Regression coverage for the bug a plain `text` field can't avoid: its
  // whole `content` is REPLACED by the input at generate time, so a
  // hand-typed "Bill No: 1042" placeholder loses "Bill No:" the moment a
  // real bill number is substituted. "labeled" fields (multiVariableText)
  // fix this by keeping the label in the field's own `text` template and
  // only substituting the value into a `{key}` placeholder - which requires
  // the input to be JSON.stringify({ [key]: value }), not a raw string.
  it("wraps a labeled field's value as multiVariableText's JSON variables format", () => {
    const doc = sampleBillDocument("consultation");
    if (doc.type !== "consultation") throw new Error("expected a consultation document");
    const inputs = billDocumentToInputs(doc);
    expect(fieldKind("billNumber")).toBe("labeled");
    expect(JSON.parse(inputs.billNumber)).toEqual({ billNumber: doc.bill.number });
    expect(fieldKind("doctorName")).toBe("labeled");
    expect(JSON.parse(inputs.doctorName)).toEqual({ doctorName: doc.doctorName });
  });

  it("leaves a plain field's value as a raw string (no label, no JSON wrap)", () => {
    const doc = sampleBillDocument("consultation");
    if (doc.type !== "consultation") throw new Error("expected a consultation document");
    const inputs = billDocumentToInputs(doc);
    expect(fieldKind("hospitalName")).toBe("plain");
    expect(inputs.hospitalName).toBe(doc.hospital.name);
    expect(fieldKind("billStatusLabel")).toBe("plain");
  });

  it("leaves a table field's value as the raw JSON 2D array (not JSON-wrapped again)", () => {
    const doc = sampleBillDocument("procedure");
    const inputs = billDocumentToInputs(doc);
    expect(fieldKind("items")).toBe("table");
    expect(Array.isArray(JSON.parse(inputs.items))).toBe(true);
  });
});

describe("labelFor", () => {
  it("returns the concise print label (printLabel) when one is set", () => {
    expect(labelFor("billNumber")).toBe("Bill No"); // palette: "Bill number"
    expect(labelFor("validUntilText")).toBe("Valid until"); // palette: "Valid until (free revisit window)"
  });
  it("falls back to the palette label when no printLabel is set", () => {
    expect(labelFor("doctorName")).toBe("Doctor");
    expect(labelFor("subtotalText")).toBe("Subtotal");
  });
});
