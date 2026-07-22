"use client";

import { getDefaultFont, type Font } from "@pdfme/common";

// Browser-side font loading for the receipt designer and its preview. Fetches the
// manifest of families THIS server can render, then each font's bytes, and assembles
// the same pdfme `Font` map the PDF routes build from disk (lib/printing/fonts-loader).
//
// Both surfaces must use this. If the designer had fonts and the preview did not, the
// preview would silently render every field in Roboto and an admin would trust a
// picture of a receipt that is not the receipt (§5, honest system state).

// One fetch per page load, shared by the designer and the preview dialog. The promise
// is cached (not the result) so two mounts race to one network round, and a failure is
// not cached - a reload retries rather than being stuck font-less forever.
let cached: Promise<Font> | null = null;

export function loadDesignerFonts(): Promise<Font> {
  cached ??= build().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

async function build(): Promise<Font> {
  // pdfme's embedded Roboto, already fallback: true. Kept even if the network calls
  // below fail, so the designer always opens with a usable font map.
  const font: Font = getDefaultFont();

  const res = await fetch("/api/printing/fonts");
  if (!res.ok) return font;
  const { fonts } = (await res.json()) as { fonts: string[] };

  await Promise.all(
    fonts
      .filter((name) => !(name in font))
      .map(async (name) => {
        const r = await fetch(`/api/printing/fonts/${encodeURIComponent(name)}`);
        if (!r.ok) return; // that family just isn't offered; never block the designer
        font[name] = { data: await r.arrayBuffer(), fallback: false };
      }),
  );

  return font;
}
