"use client";

import { useEffect, useImperativeHandle, useRef } from "react";
import { getDefaultFont, type Template } from "@pdfme/common";
import { Designer } from "@pdfme/ui";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";
import { loadDesignerFonts } from "@/lib/printing/fonts-client";

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
  reservedTopMm,
  pageWidthMm,
}: {
  initialTemplate: Template;
  handleRef: React.RefObject<ReceiptDesignerHandle | null>;
  // The reserved letterhead band (basePdf.padding[0], mm) and the page width
  // (basePdf.width, mm) - the editor's single source, kept in sync with the live
  // template via updateTemplate. Drawn as a shaded, locked, NON-interactive strip
  // over the top of the paper so the admin never drops fields into the pre-printed
  // header (print-updates plan §3). Nothing here changes the template.
  reservedTopMm: number;
  pageWidthMm: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const designerRef = useRef<Designer | null>(null);
  const bandRef = useRef<HTMLDivElement>(null);

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
    let designer: Designer | null = null;
    let cancelled = false;

    // Fonts must be in hand BEFORE the Designer is constructed: pdfme reads
    // options.font once, at construction, so faces cannot be added to a live
    // instance. Without this the font picker offers only Roboto, which is the single
    // face @pdfme/common embeds. If the fetch fails we still mount, on Roboto alone -
    // a designer that opens beats a blank screen.
    void loadDesignerFonts()
      .catch(() => getDefaultFont())
      .then((font) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        designer = new Designer({
          domContainer: container,
          template: initialTemplate,
          plugins: PDF_PLUGINS,
          // pdfme's own zoom cap defaults to 200% (options.maxZoom is a percent,
          // e.g. 400 = 400%) - raised so fine label/positioning work is easier.
          options: { maxZoom: 400, font },
        });
        designerRef.current = designer;
      });

    return () => {
      cancelled = true;
      designer?.destroy();
      designerRef.current = null;
    };
    // Mount once - initialTemplate is only the STARTING template; later swaps
    // go through handleRef.updateTemplate (see the comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position the reserved-letterhead band over the top of page 1. pdfme renders
  // each page paper as a div carrying a background-image; we track its live rect
  // (so the band follows zoom + scroll) and size the band by the page's px-per-mm.
  // A rAF loop keeps it glued through pdfme's own zoom/scroll, which fire no event
  // we can hook. Defensive: if the paper isn't found the band simply hides.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const container = containerRef.current;
      const band = bandRef.current;
      if (container && band) {
        const paper = container.querySelector<HTMLElement>('[style*="background-image"]');
        if (paper && reservedTopMm > 0 && pageWidthMm > 0) {
          const c = container.getBoundingClientRect();
          const p = paper.getBoundingClientRect();
          const pxPerMm = p.width / pageWidthMm;
          band.style.display = "block";
          band.style.left = `${p.left - c.left}px`;
          band.style.top = `${p.top - c.top}px`;
          band.style.width = `${p.width}px`;
          band.style.height = `${reservedTopMm * pxPerMm}px`;
        } else {
          band.style.display = "none";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reservedTopMm, pageWidthMm]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden rounded-xl border bg-card"
      />
      {/* Shaded, locked, non-interactive letterhead band (plan §3). */}
      <div
        ref={bandRef}
        aria-hidden
        style={{ display: "none" }}
        className="pointer-events-none absolute z-10 flex items-center justify-center overflow-hidden border-b-2 border-dashed border-amber-500/70 bg-[repeating-linear-gradient(45deg,rgba(245,158,11,0.10),rgba(245,158,11,0.10)_8px,rgba(245,158,11,0.18)_8px,rgba(245,158,11,0.18)_16px)]"
      >
        <span className="rounded bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Pre-printed letterhead - keep clear
        </span>
      </div>
    </div>
  );
}
