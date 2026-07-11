import { describe, expect, it } from "vitest";
import {
  newServiceSchema,
  updateServiceSchema,
  setServiceActiveSchema,
  setServiceTrashedSchema,
} from "./schema";

// Helper: the first issue path for a failed parse, so tests assert WHICH field
// was rejected rather than just that something was.
function firstErrorPath(input: unknown): string | null {
  const r = newServiceSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].path.join(".");
}

describe("newServiceSchema", () => {
  const valid = { name: "Injection", price: "50" };

  it("accepts a well-formed service", () => {
    expect(newServiceSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a decimal price", () => {
    expect(newServiceSchema.safeParse({ ...valid, price: "50.00" }).success).toBe(true);
  });

  it("trims the name", () => {
    const r = newServiceSchema.safeParse({ ...valid, name: "  IV Drip  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("IV Drip");
  });

  it("rejects a blank name", () => {
    expect(firstErrorPath({ ...valid, name: "   " })).toBe("name");
  });

  it("rejects a name over 100 characters", () => {
    expect(firstErrorPath({ ...valid, name: "a".repeat(101) })).toBe("name");
  });

  it("rejects a bad price", () => {
    expect(firstErrorPath({ ...valid, price: "abc" })).toBe("price");
    expect(firstErrorPath({ ...valid, price: "1.234" })).toBe("price");
    expect(firstErrorPath({ ...valid, price: "" })).toBe("price");
    expect(firstErrorPath({ ...valid, price: "-5" })).toBe("price");
  });
});

describe("updateServiceSchema", () => {
  const base = { name: "Dressing", price: "120" };

  it("requires a numeric-string id", () => {
    expect(updateServiceSchema.safeParse({ ...base, id: "12" }).success).toBe(true);
    expect(updateServiceSchema.safeParse({ ...base, id: "abc" }).success).toBe(false);
  });
});

describe("setServiceActiveSchema", () => {
  it("takes an id and a boolean active flag", () => {
    expect(setServiceActiveSchema.safeParse({ id: "5", active: false }).success).toBe(true);
    expect(setServiceActiveSchema.safeParse({ id: "5", active: "no" }).success).toBe(false);
  });
});

describe("setServiceTrashedSchema", () => {
  it("takes an id and a boolean trashed flag", () => {
    expect(setServiceTrashedSchema.safeParse({ id: "5", trashed: true }).success).toBe(true);
    expect(setServiceTrashedSchema.safeParse({ id: "5", trashed: false }).success).toBe(true);
    expect(setServiceTrashedSchema.safeParse({ id: "5", trashed: "yes" }).success).toBe(false);
    expect(setServiceTrashedSchema.safeParse({ id: "abc", trashed: true }).success).toBe(false);
  });
});
