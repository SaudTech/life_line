"use client";

import { useMemo, useState } from "react";
import { usePersistentView } from "@/lib/hooks/use-persistent-view";
import Link from "next/link";
import { Plus, ArrowLeft, Search, Stethoscope, X, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setDoctorActiveAction } from "@/lib/doctors/actions";
import type { DoctorListRow } from "@/lib/doctors/repository";
import type { DepartmentRow } from "@/lib/departments/repository";
import { DoctorFormDialog } from "./doctor-form-dialog";
import { DoctorCard } from "./doctor-card";
import { DoctorRow } from "./doctor-row";

type DialogState = { type: "add" | "edit"; doctorId: string | null } | null;

// Client shell for the Doctors master list - mirrors
// app/(dashboard)/admin/users/users-manager.tsx: a card/list layout toggle, the
// same search + meta-row + empty-state shape, and per-row actions collapsed
// into a single dropdown, so the two master-list screens read as one design.
// The server page loads every doctor once - active and inactive - and this
// holds only which dialog is open, which row has an in-flight status toggle,
// the layout choice, and the name/department search (the catalog is small and
// fully preloaded, so this filters in memory rather than round-tripping to the
// server - unlike the paginated history lists). Mutations run in the server
// actions, which revalidate the page so fresh `doctors` flow back as props.
// A consultation receipt design a doctor can be assigned to (migration 0024),
// pre-shaped by the server page. `isActive` marks the location's default - the
// design every doctor prints on unless given one of their own.
export interface ConsultationDesign {
  id: string;
  name: string;
  isActive: boolean;
}

export function DoctorsManager({
  doctors,
  departments,
  consultationDesigns,
}: {
  doctors: DoctorListRow[];
  departments: DepartmentRow[];
  consultationDesigns: ConsultationDesign[];
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [layout, setLayout] = usePersistentView("view:doctors");

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
    <div className="mx-auto max-w-6xl">
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
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[210px] flex-1">
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

      {/* Grid, list, or empty state */}
      {visible.length > 0 ? (
        layout === "card" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(288px,1fr))] gap-3.5">
            {visible.map((d) => (
              <DoctorCard
                key={d.id}
                doctor={d}
                statusPending={pendingId === d.id}
                onEdit={() => setDialog({ type: "edit", doctorId: d.id })}
                onToggleActive={() => toggleActive(d)}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-md border">
            {visible.map((d) => (
              <DoctorRow
                key={d.id}
                doctor={d}
                statusPending={pendingId === d.id}
                onEdit={() => setDialog({ type: "edit", doctorId: d.id })}
                onToggleActive={() => toggleActive(d)}
              />
            ))}
          </div>
        )
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
        <DoctorFormDialog
          mode="add"
          doctor={null}
          departments={departments}
          consultationDesigns={consultationDesigns}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === "edit" && activeDoctor ? (
        <DoctorFormDialog
          mode="edit"
          doctor={activeDoctor}
          departments={departments}
          consultationDesigns={consultationDesigns}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
