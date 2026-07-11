// Integer-safe money. Rupees in the UI, paise in the DB (DEVELOPMENT_RULES §1:
// never a JS float for currency). This is the app's first money code - the whole
// system stores and calculates in integer paise; only this module bridges the
// rupee strings a human types and the paise the DB holds. PURE and client-safe:
// no "use server", no DB - imported by the zod schema (client) and the actions
// (server) alike, and unit-tested directly (money.test.ts).

// Up to ~99 lakh rupees, at most two decimal places. Deliberately strict so
// "1.234", "-5", "", "abc" and "1." are all rejected before we ever compute.
const RUPEES_RE = /^\d{1,7}(\.\d{1,2})?$/;

export function isValidRupees(input: string): boolean {
  return RUPEES_RE.test(input.trim());
}

// "250" → 25000, "250.5" → 25050, "250.55" → 25055, "0" → 0. Throws on any input
// that isn't a clean rupee amount. Integer-safe: we build paise from the whole
// and fractional parts as integers - never parseFloat into a calculation (§1).
export function rupeesToPaise(input: string): number {
  const s = input.trim();
  if (!RUPEES_RE.test(s)) throw new Error(`Invalid rupee amount: ${input}`);
  const [whole, frac = ""] = s.split(".");
  // Pad the fraction to exactly two digits ("5" → "50") before reading it.
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return paise;
}

// 25000 → "250.00", 2550050 → "25,500.50". Indian grouping (en-IN). DISPLAY ONLY
// - the "never float" rule is about storage and calculation, so Number()/100 for
// rendering is fine here. Accepts a string too, since pg returns BIGINT as text.
export function formatPaise(paise: number | string): string {
  const n = typeof paise === "string" ? Number(paise) : paise;
  return (n / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
