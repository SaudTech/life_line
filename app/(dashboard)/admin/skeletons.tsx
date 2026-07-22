// Loading placeholders for the admin dashboard's streamed blocks. They exist so the
// page shell + greeting paint immediately while the money queries finish behind
// <Suspense> (§1: nothing waits on the slowest scan). Server components - no state,
// no client bundle.
//
// Each skeleton MIRRORS the real block's box: same card chrome, same grid, same
// heights. A placeholder that reflows when the data lands is worse than none - the
// layout must not move (§5, fixed predictable layout).
//
// Deliberately calm: a flat muted block, no shimmer or pulse animation. Colour and
// motion are reserved for status (§5), and 144 pulsing cards a day is noise.

function Bar({ className }: { className?: string }) {
  return <div className={`rounded bg-muted ${className ?? ""}`} />;
}

function CardShell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-card p-4.5">{children}</div>;
}

// Matches financial-overview.tsx: 4 cards, same grid, same title/figure rhythm.
export function CardsSkeleton() {
  return (
    <div
      className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr_1fr] xl:grid-cols-4"
      aria-hidden
      data-testid="cards-skeleton"
    >
      {[0, 1, 2].map((i) => (
        <CardShell key={i}>
          <div className="flex items-start justify-between gap-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-4 w-12" />
          </div>
          <Bar className="mt-3 h-8 w-32" />
          <Bar className="mt-2.5 h-2.5 w-40" />
        </CardShell>
      ))}
      <CardShell>
        <div className="flex items-center justify-between">
          <Bar className="h-3 w-32" />
          <Bar className="size-7 rounded-lg" />
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Bar className="h-2.5 w-full" />
              <Bar className="mt-1 h-1.5 w-full" />
            </div>
          ))}
        </div>
      </CardShell>
    </div>
  );
}

// Matches revenue-chart.tsx's card + plot area.
export function ChartSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4.5" aria-hidden data-testid="chart-skeleton">
      <Bar className="h-3 w-36" />
      <Bar className="mt-3 h-8 w-40" />
      <Bar className="mt-4 h-[200px] w-full" />
    </div>
  );
}

// Matches recent-invoices.tsx: header + column heads + table rows. h-full so it holds
// the same row height the real card will, and the layout doesn't jump when it lands.
export function InvoicesSkeleton() {
  return (
    <div
      className="flex h-full flex-col rounded-xl border bg-card p-4.5"
      aria-hidden
      data-testid="invoices-skeleton"
    >
      <div className="mb-2.5 flex flex-none items-baseline justify-between">
        <Bar className="h-3 w-28" />
        <Bar className="h-2.5 w-24" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex gap-2 border-b pb-1.5">
          <Bar className="h-2.5 w-16" />
          <Bar className="h-2.5 w-12" />
          <Bar className="ml-auto h-2.5 w-14" />
          <Bar className="h-2.5 w-10" />
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Bar className="size-5 flex-none rounded" />
            <div className="min-w-0 flex-1">
              <Bar className="h-3 w-28" />
              <Bar className="mt-1 h-2.5 w-16" />
            </div>
            <Bar className="h-3 w-16 flex-none" />
            <Bar className="h-2.5 w-12 flex-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
