"use client";

// The reports page's print entry point for the A4 End-Day sheet (print-updates
// plan §4c) - opens the end-day PDF route in a hidden iframe and calls the
// browser's native print dialog, exactly like components/print-receipt.ts for
// bills. The route is SELF-SCOPED (it forces session.sub server-side), so this
// only ever passes the clinic day being viewed - never a user id. Pure GET, fully
// retryable; a jammed printer or a re-click just reprints.
export function printEndDay(dayIso: string): void {
  // Cache-bust every print (Chrome's built-in PDF viewer reuses seen URLs).
  const params = new URLSearchParams({ day: dayIso, _: Date.now().toString() });
  const url = `/api/reports/end-day/pdf?${params.toString()}`;

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
}
