"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ReportLine } from "@/lib/reports/summary";

// Recharts-backed charts for the daily report. Kept in their own "use client"
// module so the heavy chart library loads only for this screen. The design stays
// the app's calm single-accent language (DEVELOPMENT_RULES §5): money magnitude is
// ONE teal series (length encodes value); the payment-mode composition uses a teal
// RAMP (light→dark, sequential - not a rainbow); and activity bars carry their
// status TONE colour (which is meaningful) plus a text label, never colour alone.
// Every value is also printed as text, so nothing is read off a mark alone.

// Explicit hex mirrors of the CSS tokens in globals.css - Recharts needs concrete
// colours for its SVG fills (and so the printed sheet renders them). Keep in sync
// with :root there.
const INK = "#1c1b19"; // foreground
const TRACK = "#eceae6"; // a hair darker than --muted, for an empty bar track
const SURFACE = "#ffffff"; // card
const PRIMARY = "#0d9488"; // teal 600 (single-series money)

// Teal ramp (chart-1 … chart-5) for the payment-mode composition donut.
const TEAL_RAMP = ["#0d9488", "#0f766e", "#115e59", "#134e4a", "#042f2e"];

// Recharts' ResponsiveContainer measures on the client; render nothing on the
// server pass and swap in the chart after mount so there's no hydration mismatch
// and no zero-width first paint. A fixed-height skeleton holds the layout.
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function Skeleton({ height }: { height: number }) {
  return <div className="w-full animate-pulse rounded-lg bg-muted/50" style={{ height }} />;
}

// A compact tooltip shared by the bar charts: label + rupee amount (+ count).
function MoneyTooltip({ active, payload }: { active?: boolean; payload?: unknown[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = (payload[0] as { payload: ChartDatum }).payload;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-foreground">{row.label}</div>
      <div className="mt-0.5 tabular-nums text-muted-foreground">
        ₹{formatPaise(row.value)}
        {row.count != null ? ` · ${row.count}` : ""}
      </div>
    </div>
  );
}

interface ChartDatum {
  key: string;
  label: string;
  value: number; // paise
  count?: number;
}

function toData(lines: ReportLine[]): ChartDatum[] {
  return lines.map((l) => ({ key: l.key, label: l.label, value: l.totalPaise, count: l.count }));
}

// Horizontal bar chart for a money breakdown (bill type / deposits). One teal
// series; each bar's rupee amount is printed at its end.
export function MoneyBarChart({ lines }: { lines: ReportLine[] }) {
  const mounted = useMounted();
  const data = toData(lines);
  const height = Math.max(140, data.length * 46);
  if (!mounted) return <Skeleton height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 96, bottom: 4, left: 8 }} barCategoryGap="28%">
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={72}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: INK }}
        />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} content={<MoneyTooltip />} />
        <Bar dataKey="value" fill={PRIMARY} radius={[0, 4, 4, 0]} background={{ fill: TRACK, radius: 4 }} isAnimationActive={false}>
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v) => `₹${formatPaise(Number(v ?? 0))}`}
            style={{ fontSize: 12, fontWeight: 600, fill: INK }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Donut of the payment-mode composition (share of the drawer), teal ramp light→dark,
// with the grand total in the centre and a labelled legend beside it (identity is
// never colour-alone). Only non-zero modes get a slice; a no-money day shows a note.
export function PaymentModeDonut({
  lines,
  totalPaise,
}: {
  lines: ReportLine[];
  totalPaise: number;
}) {
  const mounted = useMounted();
  const slices = lines
    .filter((l) => l.totalPaise > 0)
    .map((l, i) => ({ ...l, color: TEAL_RAMP[i % TEAL_RAMP.length] }));

  if (totalPaise <= 0 || slices.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No money collected on this day.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-[200px] w-[200px] shrink-0">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="totalPaise"
                nameKey="label"
                innerRadius={62}
                outerRadius={92}
                paddingAngle={2}
                stroke={SURFACE}
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              <Tooltip content={<MoneyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <Skeleton height={200} />
        )}
        {/* Centre total. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
          <span className="text-lg font-bold tabular-nums text-foreground">₹{formatPaise(totalPaise)}</span>
        </div>
      </div>

      {/* Legend: swatch + mode + amount + share, so identity never rides colour alone. */}
      <ul className="flex min-w-[160px] flex-1 flex-col gap-2">
        {slices.map((s) => {
          const pct = Math.round((s.totalPaise / totalPaise) * 100);
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="flex-1 truncate text-foreground">{s.label}</span>
              <span className="tabular-nums font-semibold text-foreground">₹{formatPaise(s.totalPaise)}</span>
              <span className="w-9 text-right tabular-nums text-xs text-muted-foreground">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// A titled card frame around a chart, matching the report's other panels.
export function ChartCard({
  caption,
  footerLabel,
  footerValue,
  children,
  className,
}: {
  caption: string;
  footerLabel?: string;
  footerValue?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl border bg-card", className)}>
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{caption}</span>
      </div>
      <div className="flex-1 p-4">{children}</div>
      {footerLabel != null ? (
        <div className="mt-auto flex items-center justify-between border-t bg-muted/30 px-4 py-2.5">
          <span className="text-xs font-bold text-foreground">{footerLabel}</span>
          <span className="text-sm font-bold tabular-nums text-foreground">{footerValue}</span>
        </div>
      ) : null}
    </div>
  );
}
