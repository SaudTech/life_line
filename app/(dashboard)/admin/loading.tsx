import { CardsSkeleton, ChartSkeleton, InvoicesSkeleton } from "./skeletons";

// Route-level loading UI for /admin. The page itself streams its expensive blocks
// behind <Suspense>, but the shell still awaits one cheap query (the viewer's name +
// location) before it can paint. This covers that gap - and, more importantly, it is
// what the admin sees the instant they click "Admin" in the nav, instead of the
// previous screen sitting frozen with no sign the click registered (§1/§5: the app
// must never leave the user guessing whether it heard them).
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="h-7 w-64 rounded bg-muted" />
          <div className="mt-2 h-4 w-80 rounded bg-muted" />
        </div>
        <div className="h-10 w-36 rounded-lg bg-muted" />
      </div>
      <CardsSkeleton />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        <ChartSkeleton />
        <InvoicesSkeleton />
      </div>
      <div className="mt-4 h-[300px] rounded-xl border bg-card" />
    </div>
  );
}
