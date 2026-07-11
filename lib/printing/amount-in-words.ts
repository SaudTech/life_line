// Indian-rupee amount-in-words, Indian (lakh/crore) grouping - receipts legally
// show the total this way, so this is correctness-critical (plan §3b). PURE and
// client-safe: no DB, no React - imported by the bill-document resolver and
// unit-tested directly (amount-in-words.test.ts). Takes integer PAISE, matching
// every other money function in the app (formatPaise, never a float, §1).

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

// 0-99 → words. Empty string for 0 (the caller decides whether that means
// "nothing to say" or an explicit "Zero").
function twoDigitWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

// 0-999 → words, e.g. 456 → "Four Hundred Fifty Six".
function threeDigitWords(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  const restWords = twoDigitWords(rest);
  if (restWords) parts.push(restWords);
  return parts.join(" ");
}

// Integer paise → "... Rupees [and ... Paise] Only", Indian lakh/crore grouping.
// Accepts a string too (pg returns BIGINT as text, same convention as formatPaise).
export function amountInWords(paise: number | string): string {
  const total = Math.round(typeof paise === "string" ? Number(paise) : paise);
  const rupees = Math.floor(total / 100);
  const paiseRemainder = total % 100;

  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1e3);
  const hundred = rupees % 1e3;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${threeDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigitWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitWords(hundred));

  let words = `${parts.length ? parts.join(" ") : "Zero"} Rupees`;
  if (paiseRemainder > 0) {
    words += ` and ${twoDigitWords(paiseRemainder)} Paise`;
  }
  return `${words} Only`;
}
