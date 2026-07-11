"use client";

import { useMemo, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Eye, FileText, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Template } from "@pdfme/common";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/admin/activity";
import type { BillType } from "@/lib/printing/fields";
import type { TemplateSummary } from "@/lib/printing/repository";
import {
  activateTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
  duplicateTemplateAction,
  getTemplateAction,
  renameTemplateAction,
} from "@/lib/printing/actions";
import { PreviewDialog } from "./preview-dialog";

// The template LIBRARY (plan §4a) - the redesigned /admin/receipts. Designs are
// grouped by bill type; each type keeps exactly one active design (the one the
// counter prints), shown with a green Active badge. All create/activate/
// duplicate/rename/delete run through admin server actions that revalidate this
// route, so the list refreshes itself. Uses the User-Management design system
// (page header, cards, semantic tokens, light-only) - matches admin/users.

// All three bill types ship now, including IP (in-patient discharge, plan §6b).
const SECTIONS: { type: BillType; label: string; disabled?: boolean }[] = [
  { type: "consultation", label: "Consultation" },
  { type: "procedure", label: "Procedure" },
  { type: "ip", label: "IP" },
];

type RenameState = { id: string; name: string } | null;
type DeleteState = { id: string; name: string } | null;
type PreviewState = { type: BillType; template: Template } | null;

export function ReceiptsLibrary({ templates }: { templates: TemplateSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rename, setRename] = useState<RenameState>(null);
  const [del, setDel] = useState<DeleteState>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Cards removed OPTIMISTICALLY (delete confirmed, API still in flight). We
  // filter these out of the rendered list so the row disappears instantly; a
  // failed delete drops the id back out of the set and the card returns. Ids
  // already gone from the server linger harmlessly (serial ids never reuse).
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());

  // `now` is captured once per render for relative times - fine for a list view;
  // exact-to-the-second freshness isn't needed and would only cause churn.
  const now = useMemo(() => new Date(), [templates]);

  const byType = useMemo(() => {
    const map = new Map<BillType, TemplateSummary[]>();
    for (const t of templates) {
      if (removedIds.has(t.id)) continue;
      const list = map.get(t.bill_type) ?? [];
      list.push(t);
      map.set(t.bill_type, list);
    }
    return map;
  }, [templates, removedIds]);

  function newDesign(type: BillType) {
    startTransition(async () => {
      const res = await createTemplateAction({ type });
      if (!res.ok || !res.data) {
        toast.error(res.ok ? "Could not create a design." : res.formError ?? "Could not create a design.");
        return;
      }
      router.push(`/admin/receipts/${res.data.id}`);
    });
  }

  function setActive(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await activateTemplateAction({ id });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.formError ?? "Could not set this design active.");
        return;
      }
      toast.success("Design set active. The counter will print it now.");
      router.refresh();
    });
  }

  function duplicate(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await duplicateTemplateAction({ id });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.formError ?? "Could not duplicate this design.");
        return;
      }
      toast.success("Design duplicated.");
      router.refresh();
    });
  }

  // Apply a card add/remove inside a View Transition so the browser animates the
  // REMAINING cards sliding into their new grid positions (and the removed card
  // fading out), instead of everything snapping. flushSync forces React to
  // commit the DOM change synchronously inside the transition callback, which is
  // what the API needs to snapshot before/after layouts. Falls back to an
  // instant update where View Transitions aren't supported.
  function mutateWithTransition(mutate: () => void) {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => flushSync(mutate));
    } else {
      mutate();
    }
  }

  // OPTIMISTIC delete: the confirm dialog closes and the card is removed the
  // instant the user confirms (siblings glide into the freed space) while the
  // API runs in the background. If the delete fails (e.g. it became the active/
  // last design), the card slides back in and the error is shown - nothing was
  // actually lost.
  function handleConfirmDelete(id: string) {
    setDel(null); // close the dialog immediately - don't wait on the API
    mutateWithTransition(() => setRemovedIds((prev) => new Set(prev).add(id)));
    void deleteTemplateAction({ id }).then((res) => {
      if (!res.ok) {
        mutateWithTransition(() =>
          setRemovedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        );
        toast.error(res.formError ?? "Could not delete this design.");
        return;
      }
      toast.success("Design deleted.");
      router.refresh();
    });
  }

  async function openPreview(row: TemplateSummary) {
    setBusyId(row.id);
    const res = await getTemplateAction({ id: row.id });
    setBusyId(null);
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Could not load that design." : res.formError ?? "Could not load that design.");
      return;
    }
    setPreview({ type: row.bill_type, template: res.data.schema_json });
    setPreviewOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin"
        className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Admin
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Receipt designs</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Create and manage A4 receipt layouts. The counter prints the design marked
            <span className="mx-1 font-semibold text-primary">Active</span>for each bill type.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {SECTIONS.map((section) => {
          const designs = byType.get(section.type) ?? [];
          const onlyOne = designs.length === 1;
          return (
            <section key={section.type}>
              <div className="mb-3 flex items-center justify-between gap-4 border-b pb-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
                    {section.label}
                  </h2>
                  {section.disabled ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Coming soon
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">
                      {designs.length} design{designs.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {section.disabled ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => newDesign(section.type)}
                    disabled={pending}
                  >
                    <Plus aria-hidden />
                    New design
                  </Button>
                )}
              </div>

              {section.disabled ? (
                <p className="rounded-xl border border-dashed bg-card/40 px-6 py-8 text-center text-sm font-medium text-muted-foreground">
                  In-patient receipts aren&apos;t available yet.
                </p>
              ) : designs.length === 0 ? (
                <p className="rounded-xl border border-dashed bg-card/40 px-6 py-8 text-center text-sm font-medium text-muted-foreground">
                  No designs yet. Create one to start printing {section.label.toLowerCase()} receipts.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(288px,1fr))] gap-3.5">
                  {designs.map((row) => (
                    <DesignCard
                      key={row.id}
                      row={row}
                      now={now}
                      busy={busyId === row.id || pending}
                      canDelete={!row.is_active && !onlyOne}
                      onSetActive={() => setActive(row.id)}
                      onDuplicate={() => duplicate(row.id)}
                      onRename={() => setRename({ id: row.id, name: row.name })}
                      onPreview={() => openPreview(row)}
                      onDelete={() => setDel({ id: row.id, name: row.name })}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {rename ? (
        <RenameDialog
          state={rename}
          onClose={() => setRename(null)}
          onDone={() => {
            setRename(null);
            router.refresh();
          }}
        />
      ) : null}

      {del ? (
        <DeleteDialog
          state={del}
          onClose={() => setDel(null)}
          onConfirm={() => handleConfirmDelete(del.id)}
        />
      ) : null}

      {preview ? (
        <PreviewDialog
          open={previewOpen}
          onOpenChange={(o) => {
            setPreviewOpen(o);
            if (!o) setPreview(null);
          }}
          type={preview.type}
          getTemplate={() => preview.template}
        />
      ) : null}
    </div>
  );
}

const cardBtn =
  "inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function DesignCard({
  row,
  now,
  busy,
  canDelete,
  onSetActive,
  onDuplicate,
  onRename,
  onPreview,
  onDelete,
}: {
  row: TemplateSummary;
  now: Date;
  busy: boolean;
  canDelete: boolean;
  onSetActive: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      // A unique, stable transition name lets the View Transitions API animate
      // THIS card sliding to its new grid position when a sibling is deleted
      // (design ids are numeric strings, so prefix to a valid CSS ident).
      style={{ viewTransitionName: `design-${row.id}` }}
      className="flex flex-col gap-3 rounded-md border bg-card p-4 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            row.is_active ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground",
          )}
        >
          <FileText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">{row.name}</div>
          <div className="text-xs font-medium text-muted-foreground">
            Updated {relativeTime(new Date(row.updated_at), now)}
          </div>
        </div>
        {row.is_active ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Active
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
        <Button asChild size="sm" variant="secondary" className="h-8">
          <Link href={`/admin/receipts/${row.id}`}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </Button>
        {row.is_active ? null : (
          <button type="button" onClick={onSetActive} disabled={busy} className={cardBtn}>
            <Star aria-hidden className="size-3.5" />
            Set active
          </button>
        )}
        <button type="button" onClick={onPreview} disabled={busy} className={cardBtn}>
          <Eye aria-hidden className="size-3.5" />
          Preview
        </button>
        <button type="button" onClick={onDuplicate} disabled={busy} className={cardBtn}>
          <Copy aria-hidden className="size-3.5" />
          Duplicate
        </button>
        <button type="button" onClick={onRename} disabled={busy} className={cardBtn}>
          <Pencil aria-hidden className="size-3.5" />
          Rename
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className={cn(cardBtn, "ml-auto text-destructive hover:bg-destructive/10")}
          >
            <Trash2 aria-hidden className="size-3.5" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RenameDialog({
  state,
  onClose,
  onDone,
}: {
  state: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(state.name);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    startTransition(async () => {
      const res = await renameTemplateAction({ id: state.id, name: trimmed });
      if (!res.ok) {
        toast.error(res.formError ?? "Could not rename this design.");
        return;
      }
      toast.success("Design renamed.");
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename design</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
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

// A pure confirm dialog - the delete itself is optimistic and owned by the
// parent (handleConfirmDelete), so confirming closes this instantly rather than
// spinning on the API.
function DeleteDialog({
  state,
  onClose,
  onConfirm,
}: {
  state: { id: string; name: string };
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete design?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{state.name}</span> will be permanently
            removed. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
