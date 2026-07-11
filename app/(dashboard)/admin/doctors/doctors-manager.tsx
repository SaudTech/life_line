"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ArrowLeft, Pencil, Search, Stethoscope, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import { setDoctorActiveAction } from "@/lib/doctors/actions";
import type { DoctorListRow } from "@/lib/doctors/repository";
import { DoctorFormDialog } from "./doctor-form-dialog";

type DialogState = { type: "add" | "edit"; doctorId: string | null } | null;

// Client shell for the Doctors master list (plan §5, decision B: a calm table,
// no style switcher, colour for status only). The server page loads every doctor
// once - active and inactive - and this holds only which dialog is open, which
// row has an in-flight status toggle, and the name/department search (the
// catalog is small and fully preloaded, so this filters in memory rather than
// round-tripping to the server - unlike the paginated history lists). Mutations
// run in the server actions, which revalidate the page so fresh `doctors` flow
// back as props.
export function DoctorsManager({ doctors }: { doctors: DoctorListRow[] }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q === ""
        ? doctors
        : doctors.filter(
            (d) =>
              d.name.toLowerCase().includes(q) ||
              (d.department?.toLowerCase().includes(q) ?? false),
          ),
    [doctors, q],
  );

  const activeDoctor =
    dialog?.doctorId ? doctors.find((d) => d.id === dialog.doctorId) ?? null : null;

  async function toggleActive(doctor: DoctorListRow) {
    const next = !doctor.active;
    setPendingId(doctor.id);
    const res = await setDoctorActiveAction({ id: doctor.id, active: next });
    setPendingId(null);
    if (res && !res.ok) {
      toast.error(res.formError ?? "Could not update the doctor.");
      return;
    }
    toast.success(next ? `${doctor.name} reactivated` : `${doctor.name} deactivated`);
  }

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Doctors</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Consultation fees and revisit validity for every doctor.
          </p>
        </div>
        <Button type="button" onClick={() => setDialog({ type: "add", doctorId: null })}>
          <Plus aria-hidden />
          Add doctor
        </Button>
      </div>

      {doctors.length > 0 ? (
        <div className="relative mb-3.5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or department…"
            aria-label="Search doctors"
            className="pl-9 pr-8"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {doctors.length > 0 ? (
        <div className="mb-3.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Showing <b className="text-secondary-foreground">{visible.length}</b> of {doctors.length} doctors
          </span>
          {q ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden />
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Name</th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Department</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                    Fee
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                    Revisit validity
                  </th>
                  <th className="px-4 py-3 font-semibold text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    className={cn(
                      "border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30",
                      !d.active && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{d.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {d.department || <span className="text-muted-foreground/60">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                      ₹{formatPaise(d.fee_paise)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {d.revisit_validity_days} {d.revisit_validity_days === 1 ? "day" : "days"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                          d.active
                            ? "bg-green-100 text-green-700"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            d.active ? "bg-green-600" : "bg-muted-foreground/60",
                          )}
                          aria-hidden
                        />
                        {d.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ type: "edit", doctorId: d.id })}
                        >
                          <Pencil aria-hidden />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            !d.active && "text-green-700 hover:bg-green-100 hover:text-green-800",
                          )}
                          disabled={pendingId === d.id}
                          onClick={() => toggleActive(d)}
                        >
                          {pendingId === d.id
                            ? "Saving…"
                            : d.active
                              ? "Deactivate"
                              : "Reactivate"}
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
            <Stethoscope className="size-7" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold text-foreground">
              {q ? "No doctors found" : "No doctors yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-muted-foreground">
              {q
                ? "No doctor matches that search."
                : "Add your first doctor to start registering consultations."}
            </p>
          </div>
          {q ? (
            <Button type="button" variant="outline" onClick={() => setSearch("")}>
              Clear filters
            </Button>
          ) : (
            <Button type="button" onClick={() => setDialog({ type: "add", doctorId: null })}>
              <Plus aria-hidden />
              Add doctor
            </Button>
          )}
        </div>
      )}

      {dialog?.type === "add" ? (
        <DoctorFormDialog mode="add" doctor={null} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.type === "edit" && activeDoctor ? (
        <DoctorFormDialog mode="edit" doctor={activeDoctor} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
