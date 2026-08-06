// PURE, presentation helpers for the admin dashboard's "Recent activity" feed.
// No DB, no React - turns an audit_log action into human text + a status tone,
// and a timestamp into a relative label. Kept pure so both are unit-tested and
// the UI stays logic-free (DEVELOPMENT_RULES §2). Colour is for status only (§5).

import { activityMeta, type Tone } from "@/lib/activity/actions";
import { formatPaise } from "@/lib/money";

export type { Tone };

interface ActivityShape {
  text: string;
  tone: Tone;
}

// Turns an activity tag into how it reads + its status colour, appending the
// target's name (resolved by the feed query) when known, plus the money amount
// when the row carries one (e.g. a finalized bill reads "Bill finalized - ₹1,200.00").
// The label/tone come from the ONE canonical registry (lib/activity/actions.ts) -
// there is no second copy here. Unknown tags fall back to a readable form rather
// than throwing.
export function formatActivity(
  action: string,
  targetName: string | null,
  details?: Record<string, unknown> | null,
): ActivityShape {
  const { label, tone } = activityMeta(action);
  const who = targetName ? ` - ${targetName}` : "";
  const amount = formatAmount(details);
  const voided = formatVoidDetail(action, details);
  const payout = formatPayoutDetail(action, details);
  return { text: `${label}${who}${amount}${voided}${payout}`, tone };
}

// A doctor payout reads with WHO was paid, HOW MUCH, and for WHICH period - e.g.
// 'Doctor paid - Dr. Anita Rao · ₹7,000.00 · 35 consultations · 12:04 pm to 1:56 pm'.
//
// This is the one activity row where the missing detail IS the point: real cash left
// the drawer and this feed is where an admin notices it. The bare label cannot be
// improved by the feed query either - the row's entity is 'doctor_payout', which
// listRecentActivity has no join for, so target_name is always null here. Everything
// therefore comes from the details recorded at payout time, which is also what makes
// it an honest audit line: it says what was true when the money moved, not what the
// doctor's record says today.
function formatPayoutDetail(action: string, details?: Record<string, unknown> | null): string {
  if (action !== "doctor.payout" || !details) return "";
  const parts: string[] = [];
  const doctor = typeof details.doctor_name === "string" ? details.doctor_name.trim() : "";
  if (doctor) parts.push(doctor);
  const paise = asNumber(details.paid_paise);
  if (paise != null) parts.push(`₹${formatPaise(paise)}`);
  const count = asNumber(details.consultation_count);
  if (count != null) parts.push(`${count} ${count === 1 ? "consultation" : "consultations"}`);
  const covers = typeof details.covers_label === "string" ? details.covers_label.trim() : "";
  if (covers) parts.push(covers);
  return parts.length ? ` - ${parts.join(" · ")}` : "";
}

// pg returns JSONB numbers as numbers and BIGINT as text - accept both, reject
// anything that is neither rather than printing "₹NaN" on a money line.
function asNumber(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// A voided bill reads with WHY and WHO authorised it - e.g.
// 'Bill voided - #1042 · "wrong amount" · approved by Priya' - so the audit trail
// is legible at a glance, not just "Bill voided". Any missing piece is skipped.
// Display only; the reason/approver were recorded server-side at void time.
function formatVoidDetail(action: string, details?: Record<string, unknown> | null): string {
  if (action !== "bill.void" || !details) return "";
  const parts: string[] = [];
  const billNumber = details.bill_number;
  if (billNumber != null && billNumber !== "") parts.push(`#${billNumber}`);
  const reason = typeof details.reason === "string" ? details.reason.trim() : "";
  if (reason) parts.push(`"${reason.length > 80 ? `${reason.slice(0, 80)}…` : reason}"`);
  const approver = typeof details.approved_by_name === "string" ? details.approved_by_name.trim() : "";
  if (approver) parts.push(`approved by ${approver}`);
  return parts.length ? ` - ${parts.join(" · ")}` : "";
}

// Reads a `total_paise` amount from an activity row's details and renders it as a
// rupee suffix (" - ₹1,200.00"), or "" when absent/unparseable. pg returns JSONB
// numbers as numbers and BIGINT as text, so accept both. Display only - the amount
// was computed and stored in integer paise server-side (§1).
function formatAmount(details?: Record<string, unknown> | null): string {
  const n = asNumber(details?.total_paise);
  return n == null ? "" : ` - ₹${formatPaise(n)}`;
}

// Compact relative time for the feed ("just now", "2 hours ago", "Yesterday",
// "3 days ago"), falling back to an absolute date past a week. `now` is passed in
// so the function is deterministic and testable.
export function relativeTime(at: Date, now: Date): string {
  const seconds = Math.floor((now.getTime() - at.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Time-of-day greeting for the dashboard header. Split out (and `hour` injected)
// so it is deterministic in tests.
export function greetingForHour(hour: number, name: string): string {
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}
