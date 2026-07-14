// A tiny inline-SVG sparkline for the dashboard revenue cards. Deliberately
// dependency-free: no chart library, no client JS - it's a pure server component
// that renders a fixed-viewBox <svg> from a paise series. Colour comes from the
// parent via `currentColor` (the card sets text-green/red), so status colour stays
// consistent with the rest of the UI (§5). Keeps the counter fast and the bundle
// small - a chart lib for one 60px line would be the "cleverness over speed" the
// rules warn against.

interface SparklineProps {
  // Y values in day order (paise). A flat or single-point series draws a mid line.
  values: number[];
  className?: string;
}

// Fixed drawing space; the SVG scales to its box via width/height 100%.
const W = 100;
const H = 32;
const PAD = 2; // keep the stroke off the edges so it isn't clipped

export function Sparkline({ values, className }: SparklineProps) {
  // Nothing to draw - render an empty box so the layout doesn't jump.
  if (values.length === 0) {
    return <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden />;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;

  // X across the full width; Y inverted (SVG y grows downward) and normalised into
  // the padded band. A flat series (span 0) sits on the mid line rather than
  // dividing by zero.
  const points = values.map((v, i) => {
    const x =
      values.length === 1 ? W / 2 : PAD + (i / (values.length - 1)) * (W - PAD * 2);
    const y =
      span === 0 ? H / 2 : PAD + (1 - (v - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // Close the shape down to the baseline for a faint area fill under the line.
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Dot on the latest point so "today" reads clearly. */}
      <circle cx={lastX} cy={lastY} r={2} fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
