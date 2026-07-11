"use client";

import { logReceiptPrintedAction } from "@/lib/printing/actions";

// The counter's ONE print entry point (print plan §4) - opens the receipt PDF
// route in a hidden iframe and calls the browser's native print dialog on it.
// Printing a real PDF (not a print-CSS hack) is the most reliable counter path
// and needs no styling of its own.
//
// Never mutates a bill - this is a pure read hitting the GET route
// (app/api/receipts/[billId]/pdf/route.ts). Clicking Print again just
// reprints; a jammed printer or a cancelled dialog is fully retryable
// (dev-rules §5/§7, "save before print, always").
export function printReceipt(
  billId: string,
  billNumber: string,
  opts?: { copy?: "duplicate" },
): void {
  const copy = opts?.copy ?? "original";
  // Cache-bust EVERY print: the server already sends Cache-Control: no-store,
  // but browsers (Chrome's built-in PDF viewer especially) are known to still
  // reuse a cached render for a URL they've seen before, most visibly when
  // reprinting the same bill right after its template was edited. A unique
  // query param on every call guarantees a byte-fresh request every time.
  const params = new URLSearchParams({ _: Date.now().toString() });
  if (copy === "duplicate") params.set("copy", "duplicate");
  const url = `/api/receipts/${billId}/pdf?${params.toString()}`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;

  let handled = false;
  function cleanup() {
    // The print dialog holds its own reference to the frame's content once
    // opened; remove the element after a delay rather than immediately so an
    // in-flight print isn't torn down.
    setTimeout(() => iframe.remove(), 60_000);
  }

  iframe.onload = () => {
    handled = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Some browsers block scripted printing across the iframe boundary -
      // fall back to a normal tab the operator can print from directly.
      window.open(url, "_blank");
    }
    cleanup();
  };
  document.body.appendChild(iframe);

  // Fallback: if the iframe never loads (blocked, slow, whatever), don't leave
  // the counter stuck with no receipt - open the PDF in a new tab instead.
  setTimeout(() => {
    if (!handled) {
      window.open(url, "_blank");
      iframe.remove();
    }
  }, 4000);

  // Best-effort audit; never blocks or fails the print itself.
  void logReceiptPrintedAction({ billId, billNumber, copy });
}
