import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDefaultFont } from "@pdfme/common";
import type { Font, Template } from "@pdfme/common";

import { FALLBACK_FONT_NAME, FONT_FAMILIES, type FontFamily } from "./fonts";

// SERVER ONLY (fs). Turns the pure catalog in ./fonts.ts into the pdfme `Font` map
// that generate() and the designer need. Node runtime only - never import this from a
// client component; the browser gets the same bytes over /api/printing/fonts.

// The OS font directory. SystemRoot rather than a hardcoded C:\Windows (a machine can
// be installed on another drive). Non-Windows has no equivalent here, so system
// families are simply skipped and only the bundled ones load.
function systemFontDir(): string | null {
  if (process.platform !== "win32") return null;
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "Fonts");
}

function resolveFontFile(family: FontFamily): string | null {
  if (family.source === "bundled") return path.join(process.cwd(), family.file);
  const dir = systemFontDir();
  // path.basename defends the join even though `file` comes from our own checked-in
  // catalog and never from a request - the moment that stops being true, this is the
  // line that keeps it from being a path traversal.
  return dir ? path.join(dir, path.basename(family.file)) : null;
}

// Read once per process. Fonts are a few MB and never change while the app runs, so
// re-reading them on every receipt would burn IO on the hot print path (§1). The
// promise itself is cached, so concurrent prints share one read rather than racing.
let cached: Promise<Font> | null = null;

export function loadPdfFonts(): Promise<Font> {
  cached ??= build();
  return cached;
}

async function build(): Promise<Font> {
  // Start from pdfme's own Roboto (base64-embedded in @pdfme/common, already
  // fallback: true). Everything else is added alongside it, and NOTHING else may set
  // fallback - pdfme's checkFont rejects a map with zero or several.
  const font: Font = getDefaultFont();

  await Promise.all(
    FONT_FAMILIES.map(async (family) => {
      if (family.name === FALLBACK_FONT_NAME) return;
      const file = resolveFontFile(family);
      if (!file) return;
      try {
        const data = await readFile(file);
        font[family.name] = { data: new Uint8Array(data), fallback: false };
      } catch {
        // Missing font = that family is simply not offered on this machine. It must
        // never break startup or a print: a counter that cannot issue a receipt
        // because Georgia is absent is far worse than a receipt set in Roboto.
      }
    }),
  );

  return font;
}

// The families this machine can actually render, in catalog order. What the designer
// is allowed to offer - never the wish-list in ./fonts.ts.
export async function availableFontNames(): Promise<string[]> {
  const font = await loadPdfFonts();
  return [
    FALLBACK_FONT_NAME,
    ...FONT_FAMILIES.filter((f) => f.name !== FALLBACK_FONT_NAME && f.name in font).map((f) => f.name),
  ];
}

// The raw bytes for one catalog family, for the /api/printing/fonts/[name] route.
// Resolves the name through the catalog rather than trusting a path from the client.
export async function readFontBytes(name: string): Promise<Uint8Array | null> {
  const font = await loadPdfFonts();
  const entry = font[name];
  if (!entry) return null;
  const { data } = entry;
  if (typeof data === "string") return null; // never true here; the catalog loads bytes
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

// Rewrite any fontName the loaded map does not have, so an unrenderable template
// degrades to the fallback face instead of throwing.
//
// This is not defensive padding: pdfme's checkFont THROWS when a template references
// a font absent from the map, and generate() calls it. A system family is present per
// MACHINE, so an admin designing in Georgia on this PC and a receipt printed from a
// box without it would 500 at the counter, mid-queue, with a patient waiting. Falling
// back to Roboto prints a slightly wrong-looking bill; throwing prints nothing.
export function withRenderableFonts(template: Template, font: Font): Template {
  const known = new Set(Object.keys(font));
  let swapped = false;

  const schemas = template.schemas.map((page) =>
    page.map((schema) => {
      const name = (schema as { fontName?: unknown }).fontName;
      if (typeof name !== "string" || known.has(name)) return schema;
      swapped = true;
      return { ...schema, fontName: FALLBACK_FONT_NAME };
    }),
  );

  return swapped ? ({ ...template, schemas } as Template) : template;
}
