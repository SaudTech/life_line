"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { ComboboxOption } from "@/components/ui/combobox";

// The app-wide CHOOSE-SEVERAL dropdown - the sibling of Combobox (choose one), built
// on the same Popover + Command primitives so every dropdown in the app looks and
// keys identically (dev-rules §2/§5). Give it {value,label} options (plus the same
// optional `hint` and search `keywords`) and it renders the same trigger and search
// box, with a check on every selected row instead of one.
//
// Differences from Combobox, all deliberate:
//   • The popover STAYS OPEN as rows are toggled - picking three doctors should be
//     three keystrokes, not three open/close cycles.
//   • An EMPTY selection is a meaningful state ("all"), not "nothing chosen", so
//     `emptyLabel` names it on the trigger rather than reading as a placeholder.
//   • No type-ahead-commit on the closed trigger: with several values selected,
//     typing a letter and having it silently toggle something is a trap.
export function MultiCombobox({
  options,
  values,
  onChange,
  emptyLabel = "All",
  searchPlaceholder = "Search…",
  emptyText = "No match found.",
  // How the trigger reads for 2+ selections, e.g. (3) => "3 doctors".
  summarize,
  className,
  ariaLabel,
  disabled,
}: {
  options: ComboboxOption[];
  values: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  summarize?: (count: number) => string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = new Set(values);

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Emit in the OPTIONS' order, not click order, so the same three choices always
    // produce the same array - a selection that reorders itself makes every
    // downstream memo and query key look changed when nothing has.
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  }

  const label =
    selected.size === 0
      ? emptyLabel
      : selected.size === 1
        ? (options.find((o) => o.value === values[0])?.label ?? emptyLabel)
        : (summarize?.(selected.size) ?? `${selected.size} selected`);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          // A button that opens a list of CHECKABLE options - not a combobox, which
          // implies a single committed value. Saying so accurately also satisfies
          // role="combobox"'s required aria-controls, which we cannot supply because
          // Radix owns the popover's id.
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", selected.size === 0 && "text-muted-foreground")}>
            {label}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] bg-white p-0">
        <Command className="bg-white">
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {/* The "all" row clears rather than selecting everything: an empty
                  selection is what the server reads as "no filter", and selecting
                  every doctor by hand would mean a different query for the same
                  intent. */}
              <CommandItem
                value={`__all__ ${emptyLabel}`}
                onSelect={() => onChange([])}
                className="gap-2"
              >
                <Check
                  className={cn("size-4 shrink-0", selected.size === 0 ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                <span className="flex-1 truncate">{emptyLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.keywords ?? ""}`}
                  onSelect={() => toggle(o.value)}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      selected.has(o.value) ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
