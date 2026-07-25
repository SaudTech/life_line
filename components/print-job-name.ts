"use client";

// Chrome/Edge derive the suggested filename for "Save as PDF" / "Microsoft
// Print to PDF" from the printing page's TITLE, not from the PDF route's
// Content-Disposition header (that header only names direct downloads and the
// fallback tab). Our receipts print from a hidden iframe, so the parent page's
// title is what the save dialog pre-fills - set it to the document's real name
// for the duration of the dialog, then restore. print() creates the job (and
// captures its name) synchronously when the dialog opens, so restoring right
// after it returns is safe.
//
// Returns the restore function; idempotent, plus a 60s safety net so the tab
// never stays renamed if a code path forgets to call it.
export function setPrintJobName(name: string): () => void {
  // Strip characters Windows rejects in filenames so the pre-filled name is
  // always accepted as-is.
  const safe = name.replace(/[\\/:*?"<>|]/g, "-");
  const prev = document.title;
  document.title = safe;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = prev;
  };
  setTimeout(restore, 60_000);
  return restore;
}
