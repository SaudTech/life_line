import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/dal";
import { readFontBytes } from "@/lib/printing/fonts-loader";

// The raw TTF for ONE catalog family, so the browser designer can render and embed
// the same face the server does. Admin-only (this serves the builder), pure read.
//
// `name` is resolved through the checked-in font catalog, NEVER used as a path: an
// unknown name is a 404, so no request can reach a file we did not choose to publish.
// Node runtime: the bytes come off disk.
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  await requireAdmin();

  const { name } = await params;
  const bytes = await readFontBytes(decodeURIComponent(name));
  if (!bytes) return new NextResponse("Unknown font.", { status: 404 });

  // Uint8Array → a fresh ArrayBuffer: the cached font map must not hand out a view
  // onto its own buffer for a response to detach or a caller to mutate.
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "font/ttf",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
