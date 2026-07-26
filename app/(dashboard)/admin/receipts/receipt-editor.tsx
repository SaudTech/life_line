"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CopyPlus, Eye, ImagePlus, Pencil, Plus, Save, Star } from "lucide-react";
import { toast } from "sonner";
import type { Template } from "@pdfme/common";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fieldsForType, labelFor, type FieldMeta } from "@/lib/printing/fields";
import {
  activateTemplateAction,
  createTemplateAction,
  renameTemplateAction,
  updateTemplateAction,
} from "@/lib/printing/actions";
import type { BillTemplateRow } from "@/lib/printing/repository";
import type { ReceiptDesignerHandle } from "./receipt-designer";
import { PreviewDialog } from "./preview-dialog";

// pdfme's Designer touches the DOM/canvas directly on mount - client-only, no
// SSR (Next 16 / AGENTS.md rule; matches this app's other "use client" shells
// that receive server-loaded data as props, e.g. admin/users/users-manager.tsx).
const ReceiptDesigner = dynamic(
  () => import("./receipt-designer").then((m) => m.ReceiptDesigner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        Loading designer…
      </div>
    ),
  },
);

const TEXT_STYLE_DEFAULTS = {
  rotate: 0,
  alignment: "left",
  verticalAlignment: "top",
  fontSize: 10,
  textFormat: "plain",
  overflow: "visible",
  fontVariantFallback: "synthetic",
  lineHeight: 1,
  characterSpacing: 0,
  fontColor: "#000000",
  backgroundColor: "",
  borderColor: "#000000",
  borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  opacity: 1,
  strikethrough: false,
  underline: false,
};

// Quick-pick paper sizes for the Paper size control (plan §2). Custom width x
// height (mm) is entered alongside these.
const PAPER_PRESETS = [
  { key: "a4", label: "A4", width: 210, height: 297 },
  { key: "half", label: "Half-A4", width: 210, height: 148.5 },
  { key: "a5", label: "A5", width: 148, height: 210 },
] as const;

// pdfme's basePdf.padding is [top, right, bottom, left] in mm - the printable
// margin on each edge. `top` is the reserved letterhead band (it has its own
// control, because growing it also shifts the fields below it); the other three
// are plain page margins, editable in the toolbar.
type Padding = [number, number, number, number];

const DEFAULT_MARGIN_MM = 10;

// Read a template's page size + margins (basePdf) for seeding the size controls.
// Defaults to A4 with 10mm side/bottom margins and no reserved band if the design
// carries a raw/PDF basePdf rather than the {width,height,padding} object our
// templates use.
function readBasePdf(t: Template): { width: number; height: number; padding: Padding } {
  const base = (t as { basePdf?: unknown }).basePdf;
  if (base && typeof base === "object" && "width" in base) {
    const b = base as { width?: number; height?: number; padding?: number[] };
    const p = b.padding ?? [];
    // 0 is a legitimate margin (a full-bleed edge), so fall back only on a
    // missing/unparseable value, never on a falsy one.
    const mm = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Number(v) : fallback;
    return {
      width: Number(b.width) || 210,
      height: Number(b.height) || 297,
      padding: [mm(p[0], 0), mm(p[1], DEFAULT_MARGIN_MM), mm(p[2], DEFAULT_MARGIN_MM), mm(p[3], DEFAULT_MARGIN_MM)],
    };
  }
  return { width: 210, height: 297, padding: [0, DEFAULT_MARGIN_MM, DEFAULT_MARGIN_MM, DEFAULT_MARGIN_MM] };
}

// Editor for ONE design (plan §4b). The bill type is fixed (row.bill_type), so
// the palette shows exactly that type's catalog fields - no type tabs. "Save"
// updates THIS row in place; "Save as new" captures the current canvas as a
// fresh (inactive) copy and opens it. The proven designer internals (field
// palette, appendSchema/insertField, image upload, PreviewDialog) are unchanged.
export function ReceiptEditor({ row }: { row: BillTemplateRow }) {
  const router = useRouter();
  const type = row.bill_type;
  const [name, setName] = useState(row.name);
  const [isActive, setIsActive] = useState(row.is_active);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const handleRef = useRef<ReceiptDesignerHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageCounterRef = useRef(0);

  // Paper size + reserved letterhead band (plan §2/§3). Seeded from the design's
  // own basePdf so re-opening a design shows its real size/offset. These drive
  // BOTH the live template (via updateTemplate) and the on-canvas band overlay -
  // one source of truth, kept in sync by applyBasePdf below.
  const initialBase = readBasePdf(row.schema_json);
  const [paperW, setPaperW] = useState<number>(initialBase.width);
  const [paperH, setPaperH] = useState<number>(initialBase.height);
  // [top, right, bottom, left] in mm. `top` is the reserved letterhead band;
  // the other three are the page margins the toolbar now exposes (they used to
  // be hardcoded to 10mm with no way to change them).
  const [padding, setPadding] = useState<Padding>(initialBase.padding);
  const topMm = padding[0];

  // Push a new size / margins onto the live template's basePdf. Size and margins
  // persist automatically - they're part of schema_json, saved by the existing
  // update/create actions (no schema/repository change, §2). `schemas` is passed
  // only when the same update must also move fields (the letterhead band).
  function applyBasePdf(next: { width: number; height: number; padding: Padding }, schemas?: Template["schemas"]) {
    if (!handleRef.current) return;
    const current = handleRef.current.getTemplate();
    const updated = {
      ...current,
      ...(schemas ? { schemas } : {}),
      basePdf: { width: next.width, height: next.height, padding: next.padding },
    } as Template;
    handleRef.current.updateTemplate(updated);
  }

  // True if any field would fall outside a page of this size (position + size past
  // the edge) - drives the shrink warning before we resize smaller (plan §2).
  function anyFieldOutside(width: number, height: number): boolean {
    const schemas = handleRef.current?.getTemplate().schemas ?? [];
    return schemas.flat().some((s) => {
      const pos = (s as { position?: { x?: number; y?: number } }).position ?? {};
      const w = (s as { width?: number }).width ?? 0;
      const h = (s as { height?: number }).height ?? 0;
      return (pos.x ?? 0) + w > width + 0.5 || (pos.y ?? 0) + h > height + 0.5;
    });
  }

  // Apply a new page size (preset or custom). Validate the mm range and warn - but
  // still allow - if shrinking would clip an existing field (reversible, dev-rules §5).
  function setPaperSize(width: number, height: number) {
    if (width < 50 || width > 420 || height < 50 || height > 420) {
      toast.error("Paper size must be between 50 and 420 mm.");
      return;
    }
    if ((width < paperW || height < paperH) && anyFieldOutside(width, height)) {
      toast.warning("Some fields now fall outside the page - move them back inside before saving.");
    }
    setPaperW(width);
    setPaperH(height);
    applyBasePdf({ width, height, padding });
  }

  // Page margins (right / bottom / left, mm) - the printable inset pdfme keeps
  // clear on each edge. Purely a basePdf change: unlike the letterhead band it
  // does not move existing fields, so nothing on the canvas jumps. Clamped so the
  // two opposite margins can never swallow the page (min 20mm of usable width /
  // height left), and reversible - type the old number back.
  function setMargin(edge: 1 | 2 | 3, mm: number) {
    const limit = edge === 2 ? paperH - padding[0] - 20 : paperW - 20;
    const opposite = edge === 1 ? padding[3] : edge === 3 ? padding[1] : 0;
    const clamped = Math.max(0, Math.min(mm, Math.max(0, limit - opposite)));
    if (clamped !== mm) {
      toast.warning("Margin trimmed - it would leave no room for content.");
    }
    const next = [...padding] as Padding;
    next[edge] = clamped;
    setPadding(next);
    applyBasePdf({ width: paperW, height: paperH, padding: next });
  }

  // Resizing the reserved band shifts every field on page 1 by the same delta,
  // so growing the band pushes existing fields down (out of the new band) and
  // shrinking it pulls them back up - the band and the fields it displaces move
  // together in one update (avoids a stale intermediate render from two calls).
  function setLetterheadTop(mm: number) {
    const clamped = Math.max(0, Math.min(mm, paperH));
    const delta = clamped - topMm;
    if (!handleRef.current) return;
    const current = handleRef.current.getTemplate();
    const schemas =
      delta !== 0
        ? current.schemas.map((page, i) =>
            i === 0
              ? page.map((s) => {
                  const pos = (s as { position?: { x: number; y: number } }).position;
                  if (!pos) return s;
                  return { ...s, position: { ...pos, y: Math.max(0, pos.y + delta) } };
                })
              : page,
          )
        : current.schemas;
    const next = [clamped, padding[1], padding[2], padding[3]] as Padding;
    setPadding(next);
    applyBasePdf({ width: paperW, height: paperH, padding: next }, schemas);
  }

  // Appends one raw pdfme schema object onto the first page at a naive stacked
  // position (bottom of whatever's already there) and pushes the result to the
  // live Designer. Shared by the data-field palette (insertField) and the image
  // upload flow (insertImage) below.
  function appendSchema(newField: Record<string, unknown>) {
    if (!handleRef.current) return;
    const current = handleRef.current.getTemplate();
    const firstPage = current.schemas[0] ?? [];
    const updated: Template = {
      ...current,
      schemas: [[...firstPage, newField], ...current.schemas.slice(1)],
    } as Template;
    handleRef.current.updateTemplate(updated);
  }

  function nextStackY() {
    const firstPage = handleRef.current?.getTemplate().schemas[0] ?? [];
    return 10 + firstPage.length * 8;
  }

  // The schema TYPE placed for a field depends on its catalog `kind` - matching
  // lib/printing/fields.ts's billDocumentToInputs exactly, since that function
  // decides the wire shape (raw string vs JSON-wrapped variables) by the very
  // same kind. Getting these two out of sync silently breaks printing (a labeled
  // field fed a raw string, or vice versa).
  function insertField(field: FieldMeta) {
    if (!handleRef.current) return;
    const nextY = nextStackY();

    if (field.kind === "table") {
      appendSchema({
        name: field.key,
        type: "table",
        position: { x: 10, y: nextY },
        width: 190,
        height: 20,
        content: JSON.stringify([[field.label]]),
        showHead: true,
        repeatHead: false,
        head: [field.label],
        headWidthPercentages: [100],
        tableStyles: { borderColor: "#000000", borderWidth: 0.3 },
        headStyles: {
          alignment: "left", verticalAlignment: "middle", fontSize: 10, lineHeight: 1,
          characterSpacing: 0, fontColor: "#ffffff", backgroundColor: "#2980ba",
          borderColor: "", borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
          padding: { top: 4, right: 4, bottom: 4, left: 4 },
        },
        bodyStyles: {
          alignment: "left", verticalAlignment: "middle", fontSize: 10, lineHeight: 1,
          characterSpacing: 0, fontColor: "#000000", backgroundColor: "",
          borderColor: "#888888", borderWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
          padding: { top: 4, right: 4, bottom: 4, left: 4 }, alternateBackgroundColor: "#f5f5f5",
        },
        columnStyles: {},
      });
      return;
    }

    if (field.kind === "labeled") {
      appendSchema({
        ...TEXT_STYLE_DEFAULTS,
        name: field.key,
        type: "multiVariableText",
        // Concise print label (matches the seeded defaults), not the verbose
        // palette label - labelFor resolves printLabel ?? label.
        text: `${labelFor(field.key)}: {${field.key}}`,
        content: "{}",
        variables: [],
        readOnly: false,
        position: { x: 10, y: nextY },
        width: 190,
        height: 6,
      });
      return;
    }

    // "plain" - a bare label-less value (letterhead heading, watermark).
    appendSchema({
      ...TEXT_STYLE_DEFAULTS,
      name: field.key,
      type: "text",
      content: field.sample || field.label,
      position: { x: 10, y: nextY },
      width: 190,
      height: 6,
    });
  }

  // "Add image" - an explicit upload control, since pdfme's own image tool is
  // an unlabeled drag-and-drop icon on the canvas edge that's easy to miss.
  // Reads the chosen file as a data URL and drops it straight onto the page as
  // a pdfme `image` field (matches the shape pdfme's own image plugin uses -
  // the content IS the embedded image data, not a bound catalog field).
  function triggerImageUpload() {
    fileInputRef.current?.click();
  }

  function handleImageSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      imageCounterRef.current += 1;
      appendSchema({
        name: `image${imageCounterRef.current}`,
        type: "image",
        content: dataUrl,
        position: { x: 10, y: nextStackY() },
        width: 40,
        height: 40,
        rotate: 0,
        opacity: 1,
        // Static artwork (a logo), not a data-bound field - it has no entry in
        // lib/printing/fields.ts's catalog, so billDocumentToInputs never emits
        // an input for it. pdfme only falls back to the schema's own saved
        // `content` when readOnly is true; without this, generate() treats the
        // missing input as "" and the image renders blank on both Preview and
        // the real printed receipt (the pdf route uses the same inputs map).
        readOnly: true,
      });
    };
    reader.readAsDataURL(file);
  }

  function handleSave() {
    if (!handleRef.current) return;
    const schemaJson = handleRef.current.getTemplate();
    startTransition(async () => {
      const res = await updateTemplateAction({ id: row.id, name, schemaJson });
      if (!res.ok) {
        toast.error(res.formError ?? "Could not save this design.");
        return;
      }
      toast.success("Design saved.");
      router.refresh();
    });
  }

  // "Save as new" - persist the CURRENT canvas (including unsaved edits) as a
  // fresh inactive copy, then open it. Uses create (not duplicate-by-id) so
  // in-progress work isn't lost.
  function handleSaveAsNew() {
    if (!handleRef.current) return;
    const schemaJson = handleRef.current.getTemplate();
    startTransition(async () => {
      const res = await createTemplateAction({ type, name: `${name} (copy)`, schemaJson });
      if (!res.ok || !res.data) {
        toast.error(res.ok ? "Could not save a copy." : res.formError ?? "Could not save a copy.");
        return;
      }
      toast.success("Saved as a new design.");
      router.push(`/admin/receipts/${res.data.id}`);
    });
  }

  function handleSetActive() {
    startTransition(async () => {
      const res = await activateTemplateAction({ id: row.id });
      if (!res.ok) {
        toast.error(res.formError ?? "Could not set this design active.");
        return;
      }
      setIsActive(true);
      toast.success("Design set active. The counter will print it now.");
      router.refresh();
    });
  }

  function handleRename(next: string) {
    const trimmed = next.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    startTransition(async () => {
      const res = await renameTemplateAction({ id: row.id, name: trimmed });
      if (!res.ok) {
        toast.error(res.formError ?? "Could not rename this design.");
        return;
      }
      setName(trimmed);
      setRenameOpen(false);
      toast.success("Design renamed.");
      router.refresh();
    });
  }

  return (
    // Bound to the viewport, not the content - the page itself never scrolls;
    // only the field palette and the Designer canvas (each its own region)
    // scroll internally. 116px is the fixed chrome above this component: the top
    // nav (~63px) + the dashboard <main>'s p-6 (24px top + 24px bottom), with a
    // small buffer so rounding never forces a page-level scrollbar.
    <div className="flex h-[calc(100vh-116px)] w-full flex-col overflow-hidden">
      <div className="mb-5 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            asChild
            size="icon"
            aria-label="Back to designs"
            className="bg-accent text-accent-foreground hover:bg-accent/80"
          >
            <Link href="/admin/receipts">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{name}</h1>
              {isActive ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                  <span className="size-1.5 rounded-full bg-primary" />
                  Active
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                aria-label="Rename design"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            </div>
            <p className="mt-0.5 text-sm font-medium text-muted-foreground capitalize">
              {type} receipt
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive ? null : (
            <Button type="button" variant="outline" onClick={handleSetActive} disabled={isPending}>
              <Star aria-hidden />
              Set active
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye aria-hidden />
            Preview
          </Button>
          <Button type="button" variant="outline" onClick={handleSaveAsNew} disabled={isPending}>
            <CopyPlus aria-hidden />
            Save as new
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            <Save aria-hidden />
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Paper size + reserved letterhead controls (plan §2/§3). Desktop only -
          the designer itself is desktop-only below. Keyboard-first: presets are
          plain buttons, sizes are numeric inputs (calm, status-free, dev-rules §5). */}
      <div className="mb-3 hidden shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-2.5 lg:flex">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Paper</span>
          {PAPER_PRESETS.map((p) => {
            const active = paperW === p.width && paperH === p.height;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPaperSize(p.width, p.height)}
                aria-pressed={active}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-accent text-accent-foreground"
                    : "text-foreground hover:border-foreground/20 hover:bg-muted/40",
                )}
              >
                {p.label}
              </button>
            );
          })}
          <div className="ml-1 flex items-center gap-1.5">
            <MmInput
              value={paperW}
              ariaLabel="Paper width in millimetres"
              onCommit={(v) => setPaperSize(v, paperH)}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <MmInput
              value={paperH}
              ariaLabel="Paper height in millimetres"
              onCommit={(v) => setPaperSize(paperW, v)}
            />
            <span className="text-xs text-muted-foreground">mm</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">
            Reserved letterhead
          </span>
          <MmInput
            value={topMm}
            ariaLabel="Reserved letterhead height in millimetres"
            onCommit={setLetterheadTop}
          />
          <span className="text-xs text-muted-foreground">mm top</span>
        </div>

        {/* Page margins (mm). The top edge is the Reserved letterhead control
            above - these are the other three, which used to be fixed at 10mm
            with no way to change them. */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Margins</span>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            L
            <MmInput
              value={padding[3]}
              ariaLabel="Left margin in millimetres"
              onCommit={(v) => setMargin(3, v)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            R
            <MmInput
              value={padding[1]}
              ariaLabel="Right margin in millimetres"
              onCommit={(v) => setMargin(1, v)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            B
            <MmInput
              value={padding[2]}
              ariaLabel="Bottom margin in millimetres"
              onCommit={(v) => setMargin(2, v)}
            />
          </label>
          <span className="text-xs text-muted-foreground">mm</span>
        </div>
      </div>

      {/* Desktop: field palette + Designer canvas, filling all remaining
          vertical space (flex-1 min-h-0) - this is a full-page tool, not a form
          on a page. Below lg, the Designer needs more room than a phone/tablet
          screen can give it (dev-rules mobile polish note, plan §4b) - show a
          notice instead of cramming the canvas. */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[260px_1fr] lg:gap-4">
        <aside className="h-full overflow-y-auto rounded-xl border bg-card p-3">
          <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Artwork</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelected}
          />
          <button
            type="button"
            onClick={triggerImageUpload}
            className="mb-3 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ImagePlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Add image (e.g. logo)
          </button>

          <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
            Insert field
          </h2>
          <div className="flex flex-col gap-1">
            {fieldsForType(type).map((field) => (
              <button
                key={field.key}
                type="button"
                onClick={() => insertField(field)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {field.label}
              </button>
            ))}
          </div>
        </aside>

        <ReceiptDesigner
          initialTemplate={row.schema_json}
          handleRef={handleRef}
          reservedTopMm={topMm}
          pageWidthMm={paperW}
        />
      </div>

      <div className="min-h-0 flex-1 rounded-xl border border-dashed bg-card/40 p-8 text-center text-sm font-medium text-muted-foreground lg:hidden">
        The receipt designer needs a larger screen. Open this page on a desktop or a wider window to
        edit the layout.
      </div>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        type={type}
        getTemplate={() => handleRef.current?.getTemplate() ?? null}
      />

      {renameOpen ? (
        <RenameDialog
          initial={name}
          pending={isPending}
          onClose={() => setRenameOpen(false)}
          onSubmit={handleRename}
        />
      ) : null}
    </div>
  );
}

// A small millimetre number input that commits on blur / Enter (not every
// keystroke), so a partial value mid-typing never resizes the page. Holds its own
// draft text; the committed number flows back from the parent as `value`.
function MmInput({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number;
  ariaLabel: string;
  onCommit: (mm: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Reflect an external change (preset click) into the field.
  const shown = useRef(value);
  if (shown.current !== value) {
    shown.current = value;
    if (draft !== String(value)) setDraft(String(value));
  }
  function commit() {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n >= 0) onCommit(Math.round(n * 10) / 10);
    else setDraft(String(value));
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      type="number"
      inputMode="decimal"
      min={0}
      max={420}
      aria-label={ariaLabel}
      className="h-8 w-16 rounded-md border bg-background px-2 text-center text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

function RenameDialog({
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  initial: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename design</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={100}
            aria-label="Design name"
          />
          <DialogFooter className="mt-6 flex-row justify-start gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save name"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
