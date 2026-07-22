"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// A commit is debounced this long after the last arrow-step before it actually
// fires. A caller that persists per-change (the admission tally) sends one
// server call per keystroke otherwise - hold the up arrow to go from 1 to 12
// and eleven requests race the server, each overwriting the last and several
// arriving out of order, which is what "increasing it quickly fails" was.
// Enter and blur are explicit "I'm done" signals, so they skip the wait and
// commit whatever is pending immediately.
const COMMIT_DEBOUNCE_MS = 700;

// The one quantity field, shared by /procedures' service lines and the IPD
// admission expense tally (dev-rules §26 - one source of truth for a control,
// never re-implemented per screen). A typeable, numeric-only text input - NOT
// a +/-only stepper - so an operator can key in "12" directly. All four arrows
// step it by 1 instead of moving the caret (keyboard-first, dev-rules §5).
//
// Fully controlled: the caller owns the raw text (a draft can hold "" or a
// leading-zero mid-type without this field judging it). `onChange` fires on
// every keystroke and on each arrow-step, so the field is always responsive.
// `onCommit` fires (debounced) after an arrow-step, and immediately on Enter
// or blur - the moment a caller that persists per-change (the admission
// tally) should actually save, versus a caller that only re-prices from a
// debounced effect over the whole draft (procedures), which can leave
// `onCommit` unset.
export function QtyField({
  value,
  onChange,
  onCommit,
  disabled,
  label = "Quantity",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);

  function scheduleCommit(text: string) {
    if (!onCommit) return;
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      onCommit(text);
    }, COMMIT_DEBOUNCE_MS);
  }

  function flushCommit(text: string) {
    if (!onCommit) return;
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    onCommit(text);
  }

  function step(dir: 1 | -1) {
    const next = Math.max(1, (Number(value) || 0) + dir);
    const text = String(next);
    onChange(text);
    scheduleCommit(text);
  }

  return (
    <input
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      onBlur={() => flushCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          flushCommit(value);
          e.currentTarget.blur();
          return;
        }
        if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(e.key)) {
          e.preventDefault();
          step(e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1);
        }
      }}
      type="text"
      inputMode="numeric"
      aria-label={label}
      placeholder="Qty"
      className={cn(
        "h-10 w-16 shrink-0 rounded-lg border bg-background px-2 text-center text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-60",
        className,
      )}
    />
  );
}
