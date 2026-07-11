"use client";

import { logAdvancePrintedAction } from "@/lib/admissions/actions";

// The counter's print entry point for the A4 advance-deposit receipt (plan §5b) -
// opens the receipt PDF route in a hidden iframe and calls the browser's native
// print dialog, exactly like components/print-receipt.ts for bills. Never mutates
// anything (pure GET); a jammed printer or a re-click is fully retryable
// (save-before-print). Best-effort audit; never blocks the print.
export function printAdvanceReceipt(admissionId: string): void {
  // Cache-bust every print (Chrome's built-in PDF viewer reuses seen URLs).
  const url = `/api/receipts/advance/${admissionId}/pdf?_=${Date.now()}`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;

  let handled = false;
  iframe.onload = () => {
    handled = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.open(url, "_blank");
    }
    setTimeout(() => iframe.remove(), 60_000);
  };
  document.body.appendChild(iframe);

  setTimeout(() => {
    if (!handled) {
      window.open(url, "_blank");
      iframe.remove();
    }
  }, 4000);

  void logAdvancePrintedAction({ admissionId });
}
