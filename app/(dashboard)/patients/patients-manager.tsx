"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ArrowLeft, Pencil, Search, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchPatientsAction } from "@/lib/patients/actions";
import type { PatientRow } from "@/lib/patients/repository";
import { PatientFormDialog } from "./patient-form-dialog";

type DialogState = { type: "add" } | { type: "edit"; patient: PatientRow } | null;

// Client shell for the Patients master list (plan §5). Search-driven: the table
// is too large to preload, so on arrival it shows only the 10 most recent patients
// (`recent`, from the server) and queries searchPatientsAction (phone prefix or
// name) as the operator types. Colour is for status only; the layout is a calm,
// fixed table - no style switcher.
//
// One phone number can list SEVERAL patients (mother + child) - that's expected,
// not a bug, and the results are never deduped by phone.
export function PatientsManager({ recent }: { recent: PatientRow[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRow[]>([]);
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

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

      {/* Search */}
      <div className="relative mb-5">
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

      {/* Caption: what the table is currently showing. */}
      {rows.length > 0 ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isSearching
            ? `${rows.length} ${rows.length === 1 ? "match" : "matches"}`
            : "Recent patients"}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Patient ID</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Age</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Phone</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Area</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Added</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-foreground">
                      {p.patient_code}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {p.age ?? <span className="text-muted-foreground/60">-</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {p.phone ? (
                        <button
                          type="button"
                          onClick={() => copyPhone(p.phone!)}
                          title="Click to copy"
                          aria-label={`Copy phone ${p.phone}`}
                          className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {formatPhone(p.phone)}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/60">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.area || <span className="text-muted-foreground/60">-</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatAdded(p.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ type: "edit", patient: p })}
                        >
                          <Pencil aria-hidden />
                          Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

// Display-only phone grouping. Indian numbers read best space-separated (a
// 10-digit mobile as "98765 43210"); US-style parentheses don't fit, so we only
// add spaces. The stored value is untouched - see copyPhone. Unusual lengths are
// shown exactly as entered rather than grouped oddly.
function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) {
    const n = d.slice(2);
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  if (d.length === 11 && d.startsWith("0")) {
    const n = d.slice(1);
    return `0 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return raw;
}

// Copy the PLAIN stored number (no spaces/brackets) - what you'd paste into a
// dialer or a message. The formatted string is only for reading.
async function copyPhone(raw: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(raw);
    toast.success("Phone copied", { description: raw });
  } catch {
    toast.error("Could not copy the number.");
  }
}

// created_at crosses the server-action boundary as a Date; guard the format so an
// unexpected string never throws.
function formatAdded(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
