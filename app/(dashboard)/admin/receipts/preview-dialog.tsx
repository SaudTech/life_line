"use client";

import { useEffect, useState } from "react";
import type { Template } from "@pdfme/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { billDocumentToInputs, sampleBillDocument, type BillType } from "@/lib/printing/fields";

// Renders the CURRENT (possibly unsaved) canvas state against fixed sample
// data (plan §5 "Live preview") - so an admin sees a realistic receipt before
// ever saving, and no real patient data is touched. Generation runs entirely
// client-side via @pdfme/generator, which is isomorphic (browser + Node);
// dynamically imported so it never inflates the initial page bundle.
export function PreviewDialog({
  open,
  onOpenChange,
  type,
  getTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: BillType;
  getTemplate: () => Template | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const template = getTemplate();
    if (!template) {
      setError("The designer isn't ready yet.");
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    setUrl(null);

    (async () => {
      try {
        // The preview MUST load the same fonts as the designer and the PDF routes.
        // Without options.font, pdfme falls back to its embedded Roboto for every
        // field - so a layout set in Georgia would preview in Roboto and an admin
        // would be trusting a picture of a receipt that is not the receipt (§5).
        const [{ generate }, { PDF_PLUGINS }, { loadDesignerFonts }] = await Promise.all([
          import("@pdfme/generator"),
          import("@/lib/printing/pdf-plugins"),
          import("@/lib/printing/fonts-client"),
        ]);
        const doc = sampleBillDocument(type);
        const inputs = billDocumentToInputs(doc);
        const pdf = await generate({
          template,
          inputs: [inputs],
          plugins: PDF_PLUGINS,
          options: { font: await loadDesignerFonts() },
        });
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setError("Could not render a preview of this layout.");
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-[98vw] sm:max-w-[98vw]">
        <DialogHeader>
          <DialogTitle>Preview - sample data</DialogTitle>
        </DialogHeader>
        <div className="h-[92vh] w-full overflow-hidden rounded-lg border bg-muted/30">
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
              {error}
            </div>
          ) : url ? (
            <iframe src={url} title="Receipt preview" className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Rendering preview…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
