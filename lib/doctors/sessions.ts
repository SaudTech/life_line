// PURE, Vitest-tested detection of a doctor's SESSIONS (their real shifts) from the
// consultations they were actually billed for. No DB, no React, no clock.
//
// WHY DETECT RATHER THAN CONFIGURE. The obvious alternative is an admin screen where
// each doctor's shifts are entered ("Dr Khalid, 12:00-14:00 and 18:00-20:00"). That
// pays for PLANNED work: the doctor who stayed until 14:40 is underpaid, the one who
// left at 13:30 is overpaid, and the configuration drifts from reality the moment
// anything changes. Detection reads what actually happened, needs no setup, and can
// never go stale. You pay for work done.
//
// THE RULE. Sort the day's consultations by time; start a new session wherever the
// gap to the next one exceeds `gapMinutes`. A session runs from its FIRST
// consultation to its LAST, and its query window is half-open [first, last + 1min).
//
// THE PROPERTY THAT MAKES THIS SAFE TO PAY AGAINST: sessions tile the day's
// consultations EXACTLY - every consultation belongs to exactly one session, so the
// sessions always sum to the day's total. No consultation can fall into a crack
// between two shifts and go unpaid. This falls out of the bounding rule for free,
// because the gap between two clusters contains no consultations by definition.
//
// (Splitting at the MIDPOINT of each gap instead would make the windows contiguous
// in clock time, but a slip reading "your shift: 12:00 to 3:57 pm" when the doctor
// left at 2pm is confusing, and it buys nothing - tight bounds already lose nothing.)
//
// KNOWN LIMIT: a shift crossing midnight (22:00-02:00) is detected as two sessions on
// two days, because detection is day-scoped. Manual entry handles it correctly
// (shiftWindow crosses midnight); detection simply won't suggest it.
//
// A DETECTED SESSION IS A SUGGESTION. Boundaries move as the day fills in: the
// morning session read 12:04-13:56 at 2pm, and re-detecting at 8pm may not give the
// same bounds you paid against. It fills the time fields; it is not a record of a
// payment. That needs a settled payout, which does not exist yet.

// One consultation as detection sees it: when it was billed, and the doctor's frozen
// cut. `at` is clinic WALL-CLOCK to the minute ('YYYY-MM-DD HH:MM'), the same format
// the query window takes, so a detected session plugs straight into the report.
export interface SessionConsult {
  at: string;
  sharePaise: number;
}

export interface DoctorSession {
  key: string; // stable across re-renders
  from: string; // 'YYYY-MM-DD HH:MM', inclusive - the query window's start
  to: string; // 'YYYY-MM-DD HH:MM', EXCLUSIVE - last consultation + 1 minute
  fromLabel: string; // '12:04 pm' - the FIRST consultation
  toLabel: string; // '1:55 pm' - the LAST consultation, NOT the exclusive bound.
  //                  The labels describe the work the doctor recognises; `from`/`to`
  //                  are the half-open window that provably captures it.
  count: number;
  sharePaise: number;
}

// ── Choosing the threshold ────────────────────────────────────────────────────
// SMART detection derives the threshold from the doctor's OWN pace rather than
// applying a fixed number to everybody. A fixed 90 minutes is wrong in both
// directions: a doctor seeing someone every four minutes takes a real break at 40,
// and a doctor seeing four patients all morning has 90-minute lulls without ever
// leaving the room. What actually marks a shift boundary is not an absolute duration
// but a gap DISPROPORTIONATE to that doctor's normal spacing.
//
// So: sort the day's gaps, find the largest RELATIVE jump between consecutive sorted
// gaps, and put the threshold between them. That jump is the natural dividing line
// between "waiting for the next patient" and "gone". Two guards keep it honest:
//
//   MIN_BREAK_MINUTES - below this nothing is EVER a shift break, whatever the
//     ratio. A doctor with 90-second turnaround has a huge relative jump at four
//     minutes; four minutes is a patient walking in, not a shift. This is a fact
//     about clinics, not a tuning knob.
//   MIN_BREAK_RATIO - the jump must be a real cliff, not the top of a smooth
//     spread. Without it, a day of evenly scattered consultations would always be
//     split somewhere, inventing a shift boundary out of noise.
//
// When neither guard is satisfied there is NO clear break, and the honest answer is
// one session for the whole day - not a split at whatever gap happened to be largest.
export const MIN_BREAK_MINUTES = 30;
export const MIN_BREAK_RATIO = 3;

// Manual override bounds. Smart detection is the default, but this is money: whoever
// is at the counter can always say "no, split it here" and the sheet obeys.
export const MIN_GAP_MINUTES = 5;
export const MAX_GAP_MINUTES = 480;
// The threshold reported when a day has no detectable break - it splits nothing,
// because nothing in the day exceeds it.
const NO_SPLIT_MINUTES = MAX_GAP_MINUTES;

// How the threshold was chosen for this run.
export type GapMode = { kind: "smart" } | { kind: "manual"; minutes: number };

export interface SessionDetection {
  sessions: DoctorSession[];
  gapMinutes: number; // the threshold actually applied
  smart: boolean;
  // One line for the screen, so the user can always see what was decided and why.
  // A payout tool must never split someone's day by a rule they cannot read.
  reason: string;
}

// The adaptive threshold, in minutes, or null when the day has no clear break.
// Exported for its own tests - this is the part that has to be right.
export function smartGapMinutes(gapsMinutes: number[]): number | null {
  // Fewer than three gaps is not a distribution, it is a coincidence. Splitting on it
  // would mean two consultations far apart always read as two shifts.
  if (gapsMinutes.length < 3) return null;

  const sorted = [...gapsMinutes].sort((a, b) => a - b);
  let bestRatio = 0;
  let bestLow = 0;
  let bestHigh = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const low = sorted[i];
    const high = sorted[i + 1];
    // Only a gap that could plausibly BE a break is a candidate boundary.
    if (high < MIN_BREAK_MINUTES) continue;
    // max(low, 1) keeps the ratio finite when two consultations share a minute.
    const ratio = high / Math.max(low, 1);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestLow = low;
      bestHigh = high;
    }
  }

  if (bestRatio < MIN_BREAK_RATIO) return null;

  // Sit the threshold between the two gaps, geometrically rather than arithmetically:
  // the jump is a RATIO, so the midpoint that is equally far from both in the same
  // terms is the geometric mean. With gaps of 12 and 255 minutes that is 55, not 133 -
  // and 133 would sit so close to the real break that a slightly shorter one on
  // another day would be missed.
  const threshold = Math.round(Math.sqrt(Math.max(bestLow, 1) * bestHigh));
  // Never below the floor: a cliff from 1 to 31 minutes is still not a shift change.
  return Math.max(MIN_BREAK_MINUTES, Math.min(MAX_GAP_MINUTES, threshold));
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/;

// Parse a clinic wall-clock string to whole minutes on a fixed UTC baseline. UTC only
// so no host offset or DST can shift the arithmetic - the string already IS clinic
// time, and we only ever subtract two of these or add minutes back.
function toMinutes(wallClock: string): number {
  const m = WALL_CLOCK.exec(wallClock);
  if (!m) throw new Error(`Invalid clinic wall-clock: ${wallClock}`);
  const [, y, mo, d, hh, mm] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)) / 60000;
}

function fromMinutes(minutes: number): string {
  const dt = new Date(minutes * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

// '2026-08-06 13:55' -> '1:55 pm'. Derived from the string's own parts, so it can
// never disagree with the window it labels.
export function clockLabel(wallClock: string): string {
  const m = WALL_CLOCK.exec(wallClock);
  if (!m) throw new Error(`Invalid clinic wall-clock: ${wallClock}`);
  const hour24 = Number(m[4]);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${m[5]} ${hour24 < 12 ? "am" : "pm"}`;
}

// Split a day's consultations into sessions. Input need not be sorted - it is sorted
// here, so a caller can hand over rows in any order without silently producing one
// session per row.
export function detectSessions(
  consults: SessionConsult[],
  mode: GapMode = { kind: "smart" },
): SessionDetection {
  if (mode.kind === "manual") {
    const m = mode.minutes;
    if (!Number.isFinite(m) || m < MIN_GAP_MINUTES) {
      throw new Error(`Manual gap must be at least ${MIN_GAP_MINUTES} minutes, got: ${m}`);
    }
  }
  if (consults.length === 0) {
    return {
      sessions: [],
      gapMinutes: mode.kind === "manual" ? mode.minutes : NO_SPLIT_MINUTES,
      smart: mode.kind === "smart",
      reason: "No consultations on this day.",
    };
  }

  const sorted = [...consults]
    .map((c) => ({ minutes: toMinutes(c.at), sharePaise: c.sharePaise }))
    .sort((a, b) => a.minutes - b.minutes);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].minutes - sorted[i - 1].minutes);

  let gapMinutes: number;
  let reason: string;
  if (mode.kind === "manual") {
    gapMinutes = mode.minutes;
    reason = `Splitting on any break longer than ${mode.minutes} minutes.`;
  } else {
    const smart = smartGapMinutes(gaps);
    gapMinutes = smart ?? NO_SPLIT_MINUTES;
    reason =
      smart == null
        ? "No clear break in this doctor's day - reading it as one session."
        : `Break detected: this doctor's day splits on gaps over ${smart} minutes.`;
  }

  // Cluster: a gap STRICTLY greater than the threshold starts a new session, so a
  // threshold of exactly 90 keeps a 90-minute gap together. One rule, one boundary -
  // ">=" here would make "90 minutes" mean two different things to two readers.
  const clusters: (typeof sorted)[] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (gaps[i - 1] > gapMinutes) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }

  const sessions = clusters.map((rows, i) => {
    const firstMin = rows[0].minutes;
    const lastMin = rows[rows.length - 1].minutes;
    const from = fromMinutes(firstMin);
    const last = fromMinutes(lastMin);
    return {
      key: `session-${i}-${from}`,
      from,
      // Exclusive bound one minute past the last consultation. Timestamps are
      // truncated to the minute, so a bill at 13:55:30 sorts as 13:55 and is still
      // inside [.., 13:56) - the window can never drop the consultation that
      // defined its own end.
      to: fromMinutes(lastMin + 1),
      fromLabel: clockLabel(from),
      toLabel: clockLabel(last),
      count: rows.length,
      sharePaise: rows.reduce((s, r) => s + r.sharePaise, 0),
    };
  });

  return { sessions, gapMinutes, smart: mode.kind === "smart", reason };
}
