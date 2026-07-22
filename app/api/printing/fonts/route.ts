import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/dal";
import { availableFontNames } from "@/lib/printing/fonts-loader";

// The font manifest for the receipt designer: which families THIS machine can render
// (fonts-loader skips any whose file is absent). The designer fetches this, then pulls
// each font's bytes from ./[name], and hands the lot to pdfme as options.font.
//
// Admin-only, matching the builder it serves - the designer is an admin screen (§8).
// Node runtime: the loader reads the OS font directory off disk.
export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  const fonts = await availableFontNames();
  return NextResponse.json(
    { fonts },
    // NOT cached, deliberately. This list is the index the designer walks to fetch
    // each font, so a stale copy makes it request families that no longer exist -
    // exactly what a cached manifest did after the catalog changed: the browser kept
    // asking for fonts that had been removed. The payload is a few hundred bytes; the
    // bytes behind it are what deserve caching (see ./[name]).
    { headers: { "Cache-Control": "no-store" } },
  );
}
