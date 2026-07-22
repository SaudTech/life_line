// Pure clinic-calendar-day helpers, shared by every history/list filter
// (procedures, consultations, ...) and by the server actions that reckon
// "today" for validity windows (consultation revisit expiry, etc). The list
// filters are done by inclusive clinic-calendar days ('YYYY-MM-DD'); the
// preset picker (Today / Yesterday / This Week / Range) turns a choice into a
// concrete { dateFrom, dateTo } pair. All arithmetic is done on the ISO day
// strings via UTC so a server/UTC vs. clinic-day mismatch can never shift a
// boundary - the "current day" itself is reckoned in the clinic timezone
// (Asia/Kolkata).
//
// Kept pure and separate (no DB, no React) so every boundary case is unit-tested.
// One source of truth - do not re-implement clinicToday() locally elsewhere.

export type DatePreset = "today" | "yesterday" | "week" | "range";

export interface DateRange {
  dateFrom: string; // inclusive clinic day, 'YYYY-MM-DD'
  dateTo: string; // inclusive clinic day, 'YYYY-MM-DD'
}

const CLINIC_TZ = "Asia/Kolkata";

// The clinic's calendar day for a given instant. en-CA formats as 'YYYY-MM-DD'.
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// The hour (0-23) at the clinic right now, for the time-of-day greeting. Server-local
// `getHours()` is NOT this: on a UTC host it reads 5.5 hours behind, so the header said
// "Good afternoon" beside cards computed for the real IST evening. Anything shown next
// to a clinic-day figure must be reckoned on the clinic's clock (§5, honest state).
export function clinicHour(now: Date = new Date()): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  // en-GB renders midnight as "24" in some ICU versions; normalise it to 0.
  return Number(hh) % 24;
}

// The clinic's date, spelled out for the dashboard header ("Monday, July 14"). Same
// reason as clinicHour: server-local formatting shows YESTERDAY between 00:00 and
// 05:30 IST on a UTC host, directly above a "Revenue today" card for the real today.
export function clinicDateLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

// Add (or subtract) whole days to an ISO day, staying on UTC midnight so no DST
// or timezone offset can nudge the result onto the wrong date.
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Days elapsed since the most recent Monday (Mon = 0 … Sun = 6). The clinic week
// starts on Monday.
function daysSinceMonday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun = 0 … Sat = 6
  return (dow + 6) % 7;
}

// Resolve a fixed preset (Today / Yesterday / This Week) into an inclusive range,
// relative to the given clinic day `today`. "range" is caller-driven and has no
// fixed answer, so it is not handled here.
export function presetRange(
  preset: Exclude<DatePreset, "range">,
  today: string,
): DateRange {
  switch (preset) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { dateFrom: y, dateTo: y };
    }
    case "week":
      return { dateFrom: addDays(today, -daysSinceMonday(today)), dateTo: today };
  }
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  range: "Range",
};
