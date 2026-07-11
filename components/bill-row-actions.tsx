"use client";

import { useState } from "react";
import { MoreVertical, Printer, Ban, RotateCcw } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

// Per-row actions for a bill on the history screens.
//   • Print - frequent and safe, always a one-tap button.
//   • Fix & rebill - the main thing to do on a CANCELLED bill (create the
//     corrected replacement), so it's a visible button, not hidden. Shown once
//     only (a cancelled bill can be re-issued once).
//   • Cancel bill - reverses money, rare and not something to fat-finger, so it
//     stays behind the three-dots menu on a finalized bill.
export function BillRowActions({
  isCancelled,
  replaced,
  onPrint,
  onCancel,
  onReissue,
}: {
  isCancelled: boolean;
  replaced: boolean; // a cancelled bill already re-issued once (one-shot)
  onPrint: () => void;
  onCancel: () => void;
  onReissue: () => void;
}) {
  const [open, setOpen] = useState(false);
  const showReissue = isCancelled && !replaced;
  const showCancelMenu = !isCancelled;

  return (
    <div className="flex items-center justify-end gap-1">
      {showReissue ? (
        <Button type="button" variant="outline" size="sm" onClick={onReissue}>
          <RotateCcw aria-hidden />
          Fix &amp; rebill
        </Button>
      ) : null}

      <Button type="button" variant="ghost" size="sm" onClick={onPrint}>
        <Printer aria-hidden />
        Print
      </Button>

      {showCancelMenu ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreVertical aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 gap-0.5 p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCancel();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Ban className="size-4" aria-hidden />
              Cancel bill
            </button>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
