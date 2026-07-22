"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatPaise } from "@/lib/money";

interface RevenueChartProps {
  data: Array<{
    day: string;
    paise: number;
  }>;
  title: string;
  total: number;
  // Optional split of `total`: the doctors' cut of consultation money and what the
  // hospital keeps after it (both server-computed - this component does no math).
  // Rendered as a compact line under the headline when both are provided.
  doctorSharePaise?: number;
  hospitalNetPaise?: number;
}

function formatYAxis(value: number): string {
  // Data is in paise, so convert accordingly:
  // 1 Crore = 100,000,000 paise
  // 1 Lakh = 10,000,000 paise
  if (value >= 100000000) {
    return `${(value / 100000000).toFixed(1)}Cr`;
  }
  if (value >= 10000000) {
    return `${(value / 10000000).toFixed(1)}L`;
  }
  // For smaller values, show in rupees
  return `₹${(value / 100).toLocaleString("en-IN")}`;
}

export function RevenueChart({
  data,
  title,
  total,
  doctorSharePaise,
  hospitalNetPaise,
}: RevenueChartProps) {
  // Recharts paints into SVG and can't read a CSS custom property, so the token is
  // resolved from the document once on mount. The initial value MUST stay in step with
  // --primary in globals.css (brand indigo): it is what SSR and the first client paint
  // use, so a stale default here shows as a colour flash on every load.
  const [primaryColor, setPrimaryColor] = useState("#2e3192");

  useEffect(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const colorValue = style.getPropertyValue("--primary").trim();
    if (colorValue) {
      setPrimaryColor(colorValue);
    }
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4.5">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="mt-3 text-xs font-medium text-muted-foreground">No revenue data available yet.</p>
      </div>
    );
  }

  // `day` is a plain clinic day ('YYYY-MM-DD'), which Date parses as UTC midnight.
  // Formatting it without an explicit timeZone would render it in the VIEWER's zone -
  // a day early anywhere west of UTC, and different on the server than on the client
  // (a hydration mismatch). Pinning UTC just reads the date back as written.
  const chartData = data.map((item) => ({
    day: new Date(item.day).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }),
    revenue: item.paise,
  }));

  return (
    <div className="rounded-xl border bg-card p-4.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-3xl">
            <span className="text-lg font-semibold text-muted-foreground sm:text-xl">₹</span>
            {formatPaise(total)}
          </div>
          {/* The split of the headline: doctors' cut deducted, hospital net bold -
              the same reading as the daily report's consultation split. */}
          {doctorSharePaise != null && hospitalNetPaise != null ? (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px] font-medium sm:text-xs">
              <span className="text-muted-foreground">
                Doctors&apos; share{" "}
                <span className="tabular-nums">-₹{formatPaise(doctorSharePaise)}</span>
              </span>
              <span className="font-bold text-foreground">
                Hospital <span className="tabular-nums">₹{formatPaise(hospitalNetPaise)}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={primaryColor} stopOpacity={0.8} />
                <stop offset="95%" stopColor={primaryColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="day" stroke="#6b7280" style={{ fontSize: "12px" }} />
            <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} tickFormatter={formatYAxis} />
            <Tooltip
              formatter={(value) => `₹${formatPaise(Number(value))}`}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={primaryColor}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorRevenue)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
