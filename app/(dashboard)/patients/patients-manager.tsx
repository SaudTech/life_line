"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ArrowLeft, Search, Users, X, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchPatientsAction } from "@/lib/patients/actions";
import type { PatientRow } from "@/lib/patients/repository";
import { PatientFormDialog } from "./patient-form-dialog";
import { PatientCard } from "./patient-card";
import { PatientListRowView } from "./patient-row";

type DialogState = { type: "add" } | { type: "edit"; patient: PatientRow } | null;

// Client shell for the Patients master list - mirrors
// app/(dashboard)/admin/doctors/doctors-manager.tsx: the same card/list layout
// toggle and card/row components, so all three master-list screens (Users,
// Doctors, Patients) read as one design. Search-driven: the list is too large to
// preload, so on arrival it shows only the 10 most recent patients (`recent`,
// from the server) and queries searchPatientsAction (phone prefix or name) as
// the operator types.
//
// One phone number can list SEVERAL patients (mother + child) - that's expected,
// not a bug, and the results are never deduped by phone.
export function PatientsManager({ recent }: { recent: PatientRow[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRow[]>([]);
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [layout, setLayout] = useState<"card" | "list">("card");

  // Guard against out-of-order responses: only the latest query's results win.
  const latest = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      latest.current += 1; // cancel any in-flight response - back to the recent list
      setResults([]);
      setPending(false);
      return;
    }
    const seq = ++latest.current;
    setPending(true);
    const res = await searchPatientsAction(trimmed);
    if (seq !== latest.current) return; // a newer search superseded this one
    setPending(false);
    if (res.ok) setResults(res.data ?? []);
    else toast.error(res.formError ?? "Could not search patients.");
  }, []);

  // Debounce typing so we query after the user pauses, not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  // Before any search, the table shows the recent patients (fresh from the server,
  // revalidated after every create/edit); once the operator types, it shows the
  // matches for that query.
  const isSearching = query.trim().length > 0;
  const rows = isSearching ? results : recent;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin"
        className="mb-5 inline-flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Patients</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Search by phone, name, or patient ID, register new patients, and edit details.
          </p>
        </div>
        <Button type="button" onClick={() => setDialog({ type: "add" })}>
          <Plus aria-hidden />
          Register patient
        </Button>
      </div>

      {/* Search + layout toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[210px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            inputMode="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by phone, name, or patient ID…"
            aria-label="Search patients by phone, name, or patient ID"
            className="pl-9 pr-8"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        {/* Card / list layout toggle. */}
        <div className="flex h-9 items-center gap-0.5 rounded-lg border bg-white p-1">
          <button
            type="button"
            aria-label="Card view"
            aria-pressed={layout === "card"}
            onClick={() => setLayout("card")}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              layout === "card" && "bg-accent text-accent-foreground",
            )}
          >
            <LayoutGrid className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              layout === "list" && "bg-accent text-accent-foreground",
            )}
          >
            <List className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Caption: what the list is currently showing. */}
      {rows.length > 0 ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isSearching
            ? `${rows.length} ${rows.length === 1 ? "match" : "matches"}`
            : "Recent patients"}
        </p>
      ) : null}

      {rows.length > 0 ? (
        layout === "card" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(288px,1fr))] gap-3.5">
            {rows.map((p) => (
              <PatientCard key={p.id} patient={p} onEdit={() => setDialog({ type: "edit", patient: p })} />
            ))}
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-md border">
            {rows.map((p) => (
              <PatientListRowView
                key={p.id}
                patient={p}
                onEdit={() => setDialog({ type: "edit", patient: p })}
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/40 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Users className="size-7" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {isSearching
                ? pending
                  ? "Searching…"
                  : "No patients found"
                : "No patients yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
              {isSearching
                ? pending
                  ? "One moment."
                  : "No patient matches that phone, name, or ID. Try another, or register a new patient."
                : "Register your first patient to get started."}
            </p>
          </div>
          {!(isSearching && pending) ? (
            <Button type="button" variant="outline" onClick={() => setDialog({ type: "add" })}>
              <Plus aria-hidden />
              Register patient
            </Button>
          ) : null}
        </div>
      )}

      {dialog?.type === "add" ? (
        <PatientFormDialog
          mode="add"
          patient={null}
          onClose={() => setDialog(null)}
          onSaved={() => runSearch(query)}
        />
      ) : null}
      {dialog?.type === "edit" ? (
        <PatientFormDialog
          mode="edit"
          patient={dialog.patient}
          onClose={() => setDialog(null)}
          onSaved={() => runSearch(query)}
        />
      ) : null}
    </div>
  );
}
