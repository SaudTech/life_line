"use client";

import { forwardRef } from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { formatPaise } from "@/lib/money";
import type { ServiceRow } from "@/lib/services/repository";

// Searchable service picker - a thin wrapper over the app-wide <Combobox> so the
// service field looks and behaves EXACTLY like every other dropdown (dev-rules §2,
// one source of truth). It only adds the service-specific bits: each row shows the
// price on the right, and the trigger shows "name · ₹price". Only ever pass the
// ACTIVE catalog (listActiveServices()), never listServices() (which includes
// deactivated/trashed items an operator can no longer bill or usefully filter by).
export const ServiceCombobox = forwardRef<
  HTMLButtonElement,
  {
    services: ServiceRow[];
    value: string;
    onChange: (id: string) => void;
    placeholder?: string;
    // When set, shows a first row that clears the selection (value "") -
    // for pickers where "no service chosen" is a valid, meaningful state
    // (e.g. a filter's "any service").
    clearLabel?: string;
    className?: string;
  }
>(function ServiceCombobox(
  { services, value, onChange, placeholder = "Select a service…", clearLabel, className },
  ref,
) {
  const options: ComboboxOption[] = services.map((s) => ({
    value: s.id,
    label: s.name,
    hint: `₹${formatPaise(s.price_paise)}`,
  }));

  return (
    <Combobox
      ref={ref}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search services…"
      emptyText="No service found."
      clearLabel={clearLabel}
      className={className}
      ariaLabel="Service"
      renderValue={(o) => `${o.label} · ${o.hint}`}
    />
  );
});
