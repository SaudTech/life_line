import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOCUMENT_TYPES,
  DOCUMENT_ACCEPT,
  MAX_DOCUMENTS_PER_RECORD,
  MAX_DOCUMENT_BYTES,
  checkDocumentCount,
  checkDocumentFile,
  fileExtension,
  formatBytes,
  isPreviewableExtension,
  mimeForExtension,
  recordFolder,
  sanitizeFileName,
  sniffMatchesExtension,
} from "./rules";

describe("fileExtension", () => {
  it("lower-cases and takes the last extension", () => {
    expect(fileExtension("scan.PDF")).toBe("pdf");
    expect(fileExtension("report.final.Docx")).toBe("docx");
  });

  it("returns null when there is no usable extension", () => {
    expect(fileExtension("scan")).toBeNull();
    expect(fileExtension(".hidden")).toBeNull();
    expect(fileExtension("weird.")).toBeNull();
    expect(fileExtension("")).toBeNull();
  });

  it("ignores any path segments", () => {
    expect(fileExtension("C:\\Users\\x\\scan.jpg")).toBe("jpg");
    expect(fileExtension("a/b/scan.png")).toBe("png");
  });
});

describe("checkDocumentFile", () => {
  it("accepts every allow-listed extension at a normal size", () => {
    for (const ext of Object.keys(ALLOWED_DOCUMENT_TYPES)) {
      const res = checkDocumentFile({ name: `scan.${ext}`, size: 1024 });
      expect(res).toEqual({ ok: true, ext });
    }
  });

  it("rejects disallowed and missing extensions", () => {
    expect(checkDocumentFile({ name: "run.exe", size: 10 }).ok).toBe(false);
    expect(checkDocumentFile({ name: "page.svg", size: 10 }).ok).toBe(false);
    expect(checkDocumentFile({ name: "page.html", size: 10 }).ok).toBe(false);
    expect(checkDocumentFile({ name: "noext", size: 10 }).ok).toBe(false);
  });

  it("rejects empty files", () => {
    expect(checkDocumentFile({ name: "scan.pdf", size: 0 }).ok).toBe(false);
  });

  it("accepts a file exactly at the 25 MB limit and rejects one byte over", () => {
    expect(checkDocumentFile({ name: "scan.pdf", size: MAX_DOCUMENT_BYTES }).ok).toBe(true);
    expect(checkDocumentFile({ name: "scan.pdf", size: MAX_DOCUMENT_BYTES + 1 }).ok).toBe(false);
  });
});

describe("checkDocumentCount", () => {
  it("accepts up to exactly 20 documents total", () => {
    expect(checkDocumentCount(0, MAX_DOCUMENTS_PER_RECORD)).toEqual({ ok: true });
    expect(checkDocumentCount(19, 1)).toEqual({ ok: true });
  });

  it("rejects a batch that would exceed the cap, telling how much room is left", () => {
    const res = checkDocumentCount(19, 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("1 more");
  });

  it("rejects when the record is already full", () => {
    const res = checkDocumentCount(MAX_DOCUMENTS_PER_RECORD, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("maximum");
  });

  it("rejects an empty batch", () => {
    expect(checkDocumentCount(0, 0).ok).toBe(false);
  });
});

describe("sniffMatchesExtension", () => {
  const cases: [string, number[]][] = [
    ["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
    ["jpg", [0xff, 0xd8, 0xff, 0xe0]],
    ["jpeg", [0xff, 0xd8, 0xff, 0xe1]],
    ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]], // GIF89a
    ["bmp", [0x42, 0x4d, 0x00, 0x01]],
    ["tif", [0x49, 0x49, 0x2a, 0x00]],
    ["tiff", [0x4d, 0x4d, 0x00, 0x2a]],
    ["docx", [0x50, 0x4b, 0x03, 0x04]],
    ["xlsx", [0x50, 0x4b, 0x03, 0x04]],
    ["doc", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    ["xls", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ];
  it.each(cases)("recognises a real %s header", (ext, bytes) => {
    expect(sniffMatchesExtension(ext, Uint8Array.from(bytes))).toBe(true);
  });

  it("recognises a webp header (RIFF....WEBP)", () => {
    const head = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffMatchesExtension("webp", head)).toBe(true);
    // RIFF but not WEBP (e.g. a .wav renamed to .webp)
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffMatchesExtension("webp", wav)).toBe(false);
  });

  it("rejects a renamed file whose bytes do not match the claimed extension", () => {
    const pdfHead = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    expect(sniffMatchesExtension("jpg", pdfHead)).toBe(false);
    const exeHead = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
    expect(sniffMatchesExtension("pdf", exeHead)).toBe(false);
    expect(sniffMatchesExtension("docx", exeHead)).toBe(false);
  });

  it("accepts plain text for txt/csv but rejects binary (NUL bytes)", () => {
    const text = Uint8Array.from([104, 101, 108, 108, 111]); // "hello"
    expect(sniffMatchesExtension("txt", text)).toBe(true);
    expect(sniffMatchesExtension("csv", text)).toBe(true);
    const binary = Uint8Array.from([104, 0, 108]);
    expect(sniffMatchesExtension("txt", binary)).toBe(false);
    expect(sniffMatchesExtension("csv", Uint8Array.from([]))).toBe(false);
  });

  it("rejects a truncated header shorter than the signature", () => {
    expect(sniffMatchesExtension("png", Uint8Array.from([0x89, 0x50]))).toBe(false);
    expect(sniffMatchesExtension("pdf", Uint8Array.from([]))).toBe(false);
  });

  it("rejects unknown extensions outright", () => {
    expect(sniffMatchesExtension("exe", Uint8Array.from([0x4d, 0x5a]))).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("keeps an ordinary name as-is", () => {
    expect(sanitizeFileName("MRI scan 2026-07-12.pdf")).toBe("MRI scan 2026-07-12.pdf");
  });

  it("drops path segments (a full path pasted as a name)", () => {
    expect(sanitizeFileName("C:\\Users\\x\\scan.pdf")).toBe("scan.pdf");
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
  });

  it("replaces characters Windows forbids", () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.pdf')).toBe("a_b_c_d_e_f_g_h.pdf");
  });

  it("trims trailing dots/spaces from the stem", () => {
    expect(sanitizeFileName("scan... .pdf")).toBe("scan.pdf");
  });

  it("prefixes Windows-reserved device names", () => {
    expect(sanitizeFileName("con.pdf")).toBe("_con.pdf");
    expect(sanitizeFileName("COM1.txt")).toBe("_COM1.txt");
  });

  it("never returns an empty stem", () => {
    expect(sanitizeFileName("???.pdf")).toBe("___.pdf");
    expect(sanitizeFileName("....pdf")).toBe("document.pdf");
  });

  it("caps very long names while keeping the extension", () => {
    const long = "a".repeat(300) + ".pdf";
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("recordFolder", () => {
  it("builds the IPD admission folder", () => {
    expect(recordFolder("ipd", "12", "LLH-0045")).toBe("IPD/ADM-12_LLH-0045");
  });

  it("builds the OPD consultation folder", () => {
    expect(recordFolder("opd", "7", "LLH-0002")).toBe("OPD/CONS-7_LLH-0002");
  });

  it("sanitises an unexpected patient code", () => {
    expect(recordFolder("opd", "7", "../evil")).toBe("OPD/CONS-7____evil");
    expect(recordFolder("opd", "7", "")).toBe("OPD/CONS-7_UNKNOWN");
  });
});

describe("display helpers", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
    expect(formatBytes(-1)).toBe("-");
  });

  it("marks pdf and images previewable, office/text not", () => {
    expect(isPreviewableExtension("pdf")).toBe(true);
    expect(isPreviewableExtension("jpg")).toBe(true);
    expect(isPreviewableExtension("docx")).toBe(false);
    expect(isPreviewableExtension("csv")).toBe(false);
    expect(isPreviewableExtension(null)).toBe(false);
  });

  it("derives the accept attribute and stored MIME from the one allow-list", () => {
    expect(DOCUMENT_ACCEPT).toContain(".pdf");
    expect(DOCUMENT_ACCEPT).toContain(".docx");
    expect(mimeForExtension("pdf")).toBe("application/pdf");
    expect(mimeForExtension("weird")).toBe("application/octet-stream");
  });
});
