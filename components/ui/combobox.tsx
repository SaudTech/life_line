"use client";

import { forwardRef, useRef, useState, type ReactNode } from "react";
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

// THE app-wide dropdown. One searchable combobox (Popover + Command) used for
// EVERY choose-one field - role/status filters, gender, "created by", the service
// picker (via ServiceCombobox) - so every dropdown looks and behaves identically
// (dev-rules §2, one source of truth; §5, muscle memory). Generic over its options:
// give it {value,label} (+ optional right-aligned `hint` and extra search
// `keywords`) and it renders the same trigger, search box, and checked rows.
export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string; // right-aligned muted text (e.g. a price)
  keywords?: string; // extra terms folded into the search match
}

export const Combobox = forwardRef<
  HTMLButtonElement,
  {
    options: ComboboxOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    // When set, shows a first row that clears the selection (value "") - for
    // pickers where "nothing chosen" is a valid state (e.g. a filter's "any").
    clearLabel?: string;
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
    invalid?: boolean;
    onBlur?: () => void;
    // Custom trigger text for the selected option (defaults to its label).
    renderValue?: (option: ComboboxOption) => ReactNode;
  }
>(function Combobox(
  {
    options,
    value,
    onChange,
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    emptyText = "No match found.",
    clearLabel,
    className,
    ariaLabel,
    disabled,
    invalid,
    onBlur,
    renderValue,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  // Type-ahead: while the (closed) trigger is focused, typing searches and
  // commits the best match immediately - no click/Enter needed. Each keystroke
  // extends a short-lived buffer (reset after a pause or on blur) so "bl" then
  // "o" narrows toward "Blood test" the way a native <select> does.
  const typeahead = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: "",
    timer: null,
  });

  function resetTypeaheadTimer() {
    if (typeahead.current.timer) clearTimeout(typeahead.current.timer);
    typeahead.current.timer = setTimeout(() => {
      typeahead.current.buffer = "";
    }, 600);
  }

  function applyTypeahead(buffer: string) {
    const needle = buffer.toLowerCase();
    const match =
      options.find((o) => o.label.toLowerCase().startsWith(needle)) ??
      options.find((o) => o.label.toLowerCase().includes(needle)) ??
      options.find((o) => `${o.label} ${o.value} ${o.keywords ?? ""}`.toLowerCase().includes(needle));
    if (match) onChange(match.value);
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled || open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      typeahead.current.buffer = typeahead.current.buffer.slice(0, -1);
      resetTypeaheadTimer();
      if (typeahead.current.buffer) applyTypeahead(typeahead.current.buffer);
      return;
    }
    if (e.key.length !== 1) return; // only single printable characters
    e.preventDefault();
    typeahead.current.buffer += e.key;
    resetTypeaheadTimer();
    applyTypeahead(typeahead.current.buffer);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onBlur={() => {
            if (typeahead.current.timer) clearTimeout(typeahead.current.timer);
            typeahead.current.buffer = "";
            onBlur?.();
          }}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? (renderValue ? renderValue(selected) : selected.label) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] bg-white p-0">
        <Command className="bg-white">
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearLabel ? (
                <CommandItem
                  value={`__any__ ${clearLabel}`}
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4", value === "" ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-muted-foreground">{clearLabel}</span>
                </CommandItem>
              ) : null}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value} ${o.keywords ?? ""}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
