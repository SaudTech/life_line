import { create as createFont } from "fontkit";
import { describe, expect, it } from "vitest";

import { FALLBACK_FONT_NAME, FONT_FAMILIES } from "./fonts";
import { availableFontNames, loadPdfFonts, withRenderableFonts } from "./fonts-loader";

// The rupee sign. EVERY font offered for a receipt must have a real glyph for it:
// this system prints money on every sheet it produces, and a face missing U+20B9
// renders each amount with .notdef - a hollow box where the price should be. That is
// not a cosmetic bug, it is an unreadable bill handed to a patient. pdfme's Roboto was
// picked partly for this; anything we add has to clear the same bar, so the catalog is
// asserted here rather than trusted.
const RUPEE = 0x20b9;

describe("receipt font catalog", () => {
  it("loads Roboto as the one and only fallback", async () => {
    const font = await loadPdfFonts();
    const fallbacks = Object.entries(font).filter(([, v]) => v.fallback);
    // pdfme's checkFont rejects a map with zero or several fallbacks, so this is a
    // hard invariant, not a preference.
    expect(fallbacks.map(([name]) => name)).toEqual([FALLBACK_FONT_NAME]);
  });

  it("offers more than just Roboto", async () => {
    // The whole point of the catalog. Bundled families are npm-vendored, so they are
    // present on every machine including CI - if this fails, the loader is broken.
    const names = await availableFontNames();
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain(FALLBACK_FONT_NAME);
    expect(names).toContain("Inter");
    expect(names).toContain("Merriweather");
  });

  it("every loadable font has a real ₹ glyph", async () => {
    const font = await loadPdfFonts();
    const missing: string[] = [];

    for (const [name, entry] of Object.entries(font)) {
      const { data } = entry;
      if (typeof data === "string") continue;
      const parsed = createFont(Buffer.from(data as Uint8Array));
      // A TrueType Collection exposes .fonts rather than glyph lookups; none of the
      // catalog files are .ttc, but guard rather than throw if one ever is.
      if (!("hasGlyphForCodePoint" in parsed)) continue;
      if (!parsed.hasGlyphForCodePoint(RUPEE)) missing.push(name);
    }

    expect(missing).toEqual([]);
  });

  it("bundled families are all present (they ship with the app)", async () => {
    const font = await loadPdfFonts();
    const bundled = FONT_FAMILIES.filter((f) => f.source === "bundled");
    expect(bundled.length).toBeGreaterThan(0);
    for (const f of bundled) expect(font).toHaveProperty(f.name);
  });

  it("rewrites a fontName this machine cannot render to the fallback", async () => {
    const font = await loadPdfFonts();
    const template = {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{ name: "a", type: "text", fontName: "Nonexistent Face", content: "x" }]],
    } as never;

    const safe = withRenderableFonts(template, font);
    expect((safe.schemas[0][0] as unknown as { fontName: string }).fontName).toBe(
      FALLBACK_FONT_NAME,
    );
  });

  it("leaves a renderable fontName untouched", async () => {
    const font = await loadPdfFonts();
    const template = {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{ name: "a", type: "text", fontName: "Inter", content: "x" }]],
    } as never;

    // Same object back when nothing needed swapping - the hot print path should not
    // clone a template on every receipt for no reason.
    expect(withRenderableFonts(template, font)).toBe(template);
  });
});
