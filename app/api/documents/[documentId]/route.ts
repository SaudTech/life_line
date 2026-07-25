import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { getDocument } from "@/lib/documents/repository";
import { readDocumentFile } from "@/lib/documents/storage";

// Serve one stored document for preview (inline) or download (?download=1).
// A pure READ, never a mutation. Documents carry patient data, so they are
// never served anonymously and never exposed as a public static path - every
// byte goes through this authenticated route. Node runtime: fs + pg.
export const runtime = "nodejs";

// Only digits - never let a crafted id reach the DB/path layer.
const ID_RE = /^\d{1,18}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse("Please sign in.", { status: 401 });

  const { documentId } = await params;
  if (!ID_RE.test(documentId)) return new NextResponse("Not found.", { status: 404 });

  const doc = await getDocument(documentId);
  // A soft-deleted document is gone as far as serving goes (the file itself
  // stays on disk for the audit trail).
  if (!doc || doc.deleted_at) return new NextResponse("Not found.", { status: 404 });

  const data = await readDocumentFile(doc.folder, doc.stored_name);
  if (!data) {
    // Row exists but the file was moved/removed on disk by hand.
    return new NextResponse("The file is missing from the documents drive.", { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  // ASCII fallback plus RFC 5987 UTF-8 name, so Indian-language file names
  // survive the round trip.
  const asciiName = doc.original_name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const utf8Name = encodeURIComponent(doc.original_name);

  return new NextResponse(new Uint8Array(data), {
    headers: {
      // The MIME type stored at upload comes from OUR extension allow-list
      // (mimeForExtension), never from the uploader's browser - safe to serve.
      "Content-Type": doc.mime_type,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
