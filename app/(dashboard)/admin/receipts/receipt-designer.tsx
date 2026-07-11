"use client";

import { useEffect, useImperativeHandle, useRef } from "react";
import type { Template } from "@pdfme/common";
import { Designer } from "@pdfme/ui";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";

// Thin wrapper around pdfme's Designer class component. Client-only by
// construction (it mounts pdfme into a raw DOM node) - the parent loads this
// via next/dynamic(..., { ssr: false }) (Next 16 client-only rule, AGENTS.md).
// Mounted ONCE; template swaps (switching bill type, reset-to-default) flow
// through the imperative handle's updateTemplate, not a remount - pdfme's own
// class API is built for that (Designer#updateTemplate).
//
// PDF_PLUGINS (image/rectangle/line/ellipse/multiVariableText included) makes
// pdfme's own built-in "Add new field" sidebar (part of the Designer, not our
// custom field palette) offer those tools too - a logo, dividers/boxes, and
// free-form text aren't DATA fields (see receipt-editor.tsx's palette for
// those), so they're placed via pdfme's native UI instead.

export interface ReceiptDesignerHandle {
  getTemplate: () => Template;
  updateTemplate: (template: Template) => void;
}

export function ReceiptDesigner({
  initialTemplate,
  handleRef,
}: {
  initialTemplate: Template;
  handleRef: React.RefObject<ReceiptDesignerHandle | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const designerRef = useRef<Designer | null>(null);

  useImperativeHandle(handleRef, () => ({
    getTemplate: () => {
      if (!designerRef.current) throw new Error("Designer not mounted yet.");
      return designerRef.current.getTemplate() as unknown as Template;
    },
    updateTemplate: (template) => {
      designerRef.current?.updateTemplate(template);
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const designer = new Designer({
      domContainer: containerRef.current,
      template: initialTemplate,
      plugins: PDF_PLUGINS,
      // pdfme's own zoom cap defaults to 200% (options.maxZoom is a percent,
      // e.g. 400 = 400%) - raised so fine label/positioning work is easier.
      options: { maxZoom: 400 },
    });
    designerRef.current = designer;
    return () => {
      designer.destroy();
      designerRef.current = null;
    };
    // Mount once - initialTemplate is only the STARTING template; later swaps
    // go through handleRef.updateTemplate (see the comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden rounded-xl border bg-card"
    />
  );
}
