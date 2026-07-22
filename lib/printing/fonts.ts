// The receipt font catalog - the ONE list of families the designer offers and the
// PDF routes can render. PURE and client-safe: no fs, no DB, no next/* imports, so
// the browser designer and the Node render path read the exact same registry and can
// never disagree about which fonts exist (fonts-loader.ts reads the bytes server-side;
// fonts-client.ts fetches them for the designer).
//
// WHY THIS EXISTS: pdfme ships exactly one font - Roboto, base64-embedded in
// @pdfme/common's getDefaultFont() and marked `fallback: true`. Every text field in
// the builder was therefore stuck on Roboto. Anything else has to be handed to
// BOTH `new Designer({ options: { font } })` and `generate({ options: { font } })`,
// or the two disagree and the paper does not match the screen.
//
// TWO SOURCES, deliberately:
//   • "bundled" - open-licensed Google fonts vendored through pinned npm packages
//     (@expo-google-fonts/*, MIT AND OFL-1.1, zero transitive deps - they ship
//     nothing but .ttf files). These exist on EVERY machine and every OS, so a
//     template built on one box renders identically on another.
//   • "system"  - fonts already installed on the Windows counter PC and licensed to
//     it. Free and familiar (Arial, Times New Roman), but present only where the OS
//     put them: a family here can be MISSING on another machine, and a template that
//     used it falls back to Roboto rather than failing (see fonts-loader.ts).
// Prefer a bundled family for anything that must look identical everywhere.

// pdfme's own built-in, always present, always the fallback. Never remove it: exactly
// one font in the map must carry `fallback: true`, every template with no explicit
// fontName renders in it, and it is the substitute when a family is missing.
export const FALLBACK_FONT_NAME = "Roboto";

export type FontSource = "bundled" | "system";

export interface FontFamily {
  // The name the designer shows and the template stores in `fontName`. Changing a
  // name orphans every saved template that referenced the old one (it would fall back
  // to Roboto), so treat these as a stable contract, not labels.
  name: string;
  source: FontSource;
  // bundled → path relative to the project root. system → a bare filename inside the
  // OS font directory. Resolved only in fonts-loader.ts; never taken from a request.
  file: string;
}

// EVERY family below carries the ₹ glyph (U+20B9), asserted in fonts.test.ts. That is
// the entry requirement, not a nice-to-have: this system prints money on every sheet,
// and a face missing U+20B9 sets each amount with .notdef - a hollow box where the
// price belongs. It disqualified real candidates rather than hypothetical ones:
// Open Sans, Lato, Roboto Mono, Lora, Constantia and Palatino Linotype were all cut
// for exactly this. Test any font before adding it here; do not trust its reputation.

// Open-licensed (MIT AND OFL-1.1), vendored via pinned npm packages that ship nothing
// but .ttf files. Present wherever the app is installed, on any OS.
const BUNDLED: FontFamily[] = [
  { name: "Inter", source: "bundled", file: "node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf" },
  { name: "Noto Sans", source: "bundled", file: "node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf" },
  { name: "Poppins", source: "bundled", file: "node_modules/@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf" },
  { name: "Mukta", source: "bundled", file: "node_modules/@expo-google-fonts/mukta/400Regular/Mukta_400Regular.ttf" },
  { name: "Merriweather", source: "bundled", file: "node_modules/@expo-google-fonts/merriweather/400Regular/Merriweather_400Regular.ttf" },
  { name: "Noto Serif", source: "bundled", file: "node_modules/@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf" },
  { name: "PT Serif", source: "bundled", file: "node_modules/@expo-google-fonts/pt-serif/400Regular/PTSerif_400Regular.ttf" },
  { name: "IBM Plex Mono", source: "bundled", file: "node_modules/@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf" },
];

// Installed with Windows and licensed to that machine. Each is skipped silently if the
// file is not on this box, so this list is a WISH, not a promise - availableFontNames()
// is the truth.
const SYSTEM: FontFamily[] = [
  { name: "Arial", source: "system", file: "arial.ttf" },
  { name: "Arial Black", source: "system", file: "ariblk.ttf" },
  { name: "Calibri", source: "system", file: "calibri.ttf" },
  { name: "Consolas", source: "system", file: "consola.ttf" },
  { name: "Courier New", source: "system", file: "cour.ttf" },
  { name: "Georgia", source: "system", file: "georgia.ttf" },
  { name: "Segoe UI", source: "system", file: "segoeui.ttf" },
  { name: "Tahoma", source: "system", file: "tahoma.ttf" },
  { name: "Times New Roman", source: "system", file: "times.ttf" },
  { name: "Trebuchet MS", source: "system", file: "trebuc.ttf" },
  { name: "Verdana", source: "system", file: "verdana.ttf" },
];

// Bundled first: the designer's list reads in this order, and the fonts that render
// the same everywhere should be the ones an admin reaches for first.
export const FONT_FAMILIES: FontFamily[] = [...BUNDLED, ...SYSTEM];

export function fontFamily(name: string): FontFamily | undefined {
  return FONT_FAMILIES.find((f) => f.name === name);
}
