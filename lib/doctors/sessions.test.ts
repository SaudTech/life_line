import { describe, expect, it } from "vitest";
import {
  clockLabel,
  detectSessions,
  smartGapMinutes,
  type SessionConsult,
} from "./sessions";

// Manual mode with an explicit threshold - the existing cases pin the CLUSTERING
// rule, which must behave identically however the threshold was chosen.
const at90 = (c: SessionConsult[], m = 90) => detectSessions(c, { kind: "manual", minutes: m }).sessions;

// Session detection - the rule a doctor gets PAID against, so its edges are covered
// before it is wired anywhere. The guarantee everything else rests on: sessions tile
// the day's consultations EXACTLY. Every consultation belongs to one session, so the
// sessions always sum to the day, and none can fall into a crack between two shifts
// and go unpaid.

const D = "2026-08-06";
const at = (hhmm: string, sharePaise = 40000): SessionConsult => ({
  at: `${D} ${hhmm}`,
  sharePaise,
});

// The stated case: a doctor works 12:00-14:00, breaks, then 18:00-20:00.
const TWO_SITTINGS = [
  at("12:04"), at("12:31"), at("13:10"), at("13:55"),
  at("18:10"), at("18:44"), at("19:20"), at("20:02"),
];

describe("detectSessions", () => {
  it("splits the day into the doctor's two real sittings", () => {
    const s = at90(TWO_SITTINGS, 90);
    expect(s).toHaveLength(2);
    expect(s[0].fromLabel).toBe("12:04 pm");
    expect(s[0].toLabel).toBe("1:55 pm");
    expect(s[0].count).toBe(4);
    expect(s[1].fromLabel).toBe("6:10 pm");
    expect(s[1].toLabel).toBe("8:02 pm");
    expect(s[1].count).toBe(4);
  });

  it("the query window ends one minute PAST the last consultation", () => {
    // Half-open [from, to): a bill stamped 13:55:30 truncates to 13:55 and must
    // still be inside the window its own time defined. An exclusive bound of 13:55
    // would drop the consultation that ended the session.
    const s = at90(TWO_SITTINGS, 90);
    expect(s[0].from).toBe(`${D} 12:04`);
    expect(s[0].to).toBe(`${D} 13:56`);
  });

  it("SESSIONS TILE THE DAY - every consultation in exactly one, summing to the whole", () => {
    const s = at90(TWO_SITTINGS, 90);
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(TWO_SITTINGS.length);
    expect(s.reduce((n, x) => n + x.sharePaise, 0)).toBe(
      TWO_SITTINGS.reduce((n, c) => n + c.sharePaise, 0),
    );
    // And the gap between sessions genuinely contains nothing - that is WHY it tiles.
    const inGap = TWO_SITTINGS.filter((c) => c.at > s[0].to && c.at < s[1].from);
    expect(inGap).toEqual([]);
  });

  it("sums each session's frozen shares", () => {
    const s = at90(
      [at("12:00", 50000), at("12:30", 30000), at("18:00", 20000)],
      90,
    );
    expect(s[0].sharePaise).toBe(80000);
    expect(s[1].sharePaise).toBe(20000);
  });

  it("a gap EXACTLY at the threshold stays one session", () => {
    // Strictly-greater is the boundary, so "90 minutes" means one thing to everyone.
    expect(at90([at("12:00"), at("13:30")], 90)).toHaveLength(1);
    expect(at90([at("12:00"), at("13:31")], 90)).toHaveLength(2);
  });

  it("a busy unbroken day is ONE session, not many", () => {
    const busy = ["09:00", "09:12", "09:40", "10:05", "10:50", "11:30", "12:15"].map((t) => at(t));
    expect(at90(busy, 90)).toHaveLength(1);
  });

  it("a lower threshold splits more finely - the same data, re-clustered", () => {
    // Documented noise, not a money bug: a quieter doctor at a tighter threshold gets
    // more sessions. They still tile and still sum.
    const s = at90(TWO_SITTINGS, 30);
    expect(s.length).toBeGreaterThan(2);
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(TWO_SITTINGS.length);
  });

  it("sorts unordered input instead of making a session per row", () => {
    const shuffled = [at("19:20"), at("12:04"), at("18:10"), at("12:31")];
    const s = at90(shuffled, 90);
    expect(s).toHaveLength(2);
    expect(s[0].count).toBe(2);
    expect(s[1].count).toBe(2);
  });

  it("a single consultation is a real session, not nothing", () => {
    // A doctor who saw one patient at 8pm worked an evening sitting and is owed for it.
    const s = at90([at("20:00", 12500)], 90);
    expect(s).toHaveLength(1);
    expect(s[0].count).toBe(1);
    expect(s[0].sharePaise).toBe(12500);
    expect(s[0].fromLabel).toBe("8:00 pm");
    expect(s[0].toLabel).toBe("8:00 pm");
    expect(s[0].to).toBe(`${D} 20:01`);
  });

  it("two consultations in the same minute are one session with both counted", () => {
    const s = at90([at("12:00"), at("12:00")], 90);
    expect(s).toHaveLength(1);
    expect(s[0].count).toBe(2);
    expect(s[0].to).toBe(`${D} 12:01`);
  });

  it("a day with no consultations has no sessions", () => {
    expect(at90([], 90)).toEqual([]);
  });

  it("a session ending at 23:59 rolls its exclusive bound into the next day", () => {
    const s = at90([at("23:59")], 90);
    expect(s[0].to).toBe("2026-08-07 00:00");
  });

  it("session keys are unique so the strip can render them all", () => {
    const s = at90(TWO_SITTINGS, 90);
    expect(new Set(s.map((x) => x.key)).size).toBe(s.length);
  });

  it("rejects a nonsensical manual threshold rather than clustering by accident", () => {
    expect(() => at90(TWO_SITTINGS, 0)).toThrow();
    expect(() => detectSessions(TWO_SITTINGS, { kind: "manual", minutes: -5 })).toThrow();
    expect(() => detectSessions(TWO_SITTINGS, { kind: "manual", minutes: Number.NaN })).toThrow();
  });

  it("rejects a malformed timestamp rather than silently mis-clustering", () => {
    expect(() => at90([{ at: "2026-08-06 24:00", sharePaise: 0 }], 90)).toThrow();
    expect(() => at90([{ at: "not a time", sharePaise: 0 }], 90)).toThrow();
  });
});

// ── Smart detection ───────────────────────────────────────────────────────────
// The threshold is derived from the DOCTOR'S OWN pace, not applied from a fixed
// number. A fixed 90 minutes is wrong in both directions: a doctor seeing someone
// every four minutes takes a real break at 40, and a doctor seeing four patients all
// morning has 90-minute lulls without ever leaving the room.
describe("smartGapMinutes", () => {
  it("finds the cliff in a two-sitting day", () => {
    // Gaps of a few minutes, then one of four hours. The threshold lands between
    // them - well above the working gaps, well below the break.
    const gaps = [27, 39, 45, 255];
    const t = smartGapMinutes(gaps)!;
    expect(t).toBeGreaterThan(45);
    expect(t).toBeLessThan(255);
  });

  it("adapts to a FAST doctor - a 40-minute break is a break for them", () => {
    // Someone every 3-5 minutes, then 40 minutes of nothing. A fixed 90-minute rule
    // would call this one sitting; it plainly is not.
    const gaps = [3, 4, 5, 4, 3, 40];
    const t = smartGapMinutes(gaps)!;
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(40);
  });

  it("adapts to a SLOW doctor - a 70-minute lull is NOT a break for them", () => {
    // Four patients a morning, naturally 50-70 minutes apart. A fixed 90 would be
    // right here by luck; a fixed 45 would shatter the morning into four "shifts".
    expect(smartGapMinutes([50, 65, 70, 55])).toBeNull();
  });

  it("returns null when the day has no cliff, however large the largest gap", () => {
    // Evenly scattered: the top gap is only slightly bigger than its neighbour. There
    // is no boundary to find, and inventing one would split a sitting in half.
    expect(smartGapMinutes([21, 23, 26, 28, 35, 42, 50])).toBeNull();
  });

  it("never treats a short turnaround as a shift change, however big the ratio", () => {
    // 1 minute then 8 is an 8x jump, and 8 minutes is a patient walking in.
    expect(smartGapMinutes([1, 1, 1, 8])).toBeNull();
  });

  it("needs a real distribution - two or three points are a coincidence", () => {
    expect(smartGapMinutes([])).toBeNull();
    expect(smartGapMinutes([240])).toBeNull();
    expect(smartGapMinutes([5, 240])).toBeNull();
  });

  it("is deterministic - the same day always splits the same way", () => {
    const gaps = [3, 4, 5, 4, 3, 240];
    expect(smartGapMinutes(gaps)).toBe(smartGapMinutes([...gaps].reverse()));
  });
});

describe("detectSessions - smart mode", () => {
  it("splits a two-sitting day with no threshold supplied at all", () => {
    const out = detectSessions(TWO_SITTINGS);
    expect(out.smart).toBe(true);
    expect(out.sessions).toHaveLength(2);
    expect(out.sessions[0].fromLabel).toBe("12:04 pm");
    expect(out.sessions[1].fromLabel).toBe("6:10 pm");
    expect(out.reason).toContain("Break detected");
  });

  it("reads a steady day as ONE session and says why", () => {
    const steady = ["09:00", "09:50", "10:45", "11:35", "12:30"].map((t) => at(t));
    const out = detectSessions(steady);
    expect(out.sessions).toHaveLength(1);
    expect(out.reason).toContain("No clear break");
  });

  it("still tiles the day exactly, like every other mode", () => {
    const out = detectSessions(TWO_SITTINGS);
    expect(out.sessions.reduce((n, x) => n + x.count, 0)).toBe(TWO_SITTINGS.length);
    expect(out.sessions.reduce((n, x) => n + x.sharePaise, 0)).toBe(
      TWO_SITTINGS.reduce((n, c) => n + c.sharePaise, 0),
    );
  });

  it("a manual threshold overrides smart entirely, and says so", () => {
    const out = detectSessions(TWO_SITTINGS, { kind: "manual", minutes: 30 });
    expect(out.smart).toBe(false);
    expect(out.gapMinutes).toBe(30);
    expect(out.reason).toContain("30 minutes");
    expect(out.sessions.length).toBeGreaterThan(2);
  });

  it("an empty day explains itself instead of returning a bare nothing", () => {
    const out = detectSessions([]);
    expect(out.sessions).toEqual([]);
    expect(out.reason).toContain("No consultations");
  });
});

describe("clockLabel", () => {
  it("reads as a counter clock, 12-hour with am/pm", () => {
    expect(clockLabel(`${D} 12:04`)).toBe("12:04 pm");
    expect(clockLabel(`${D} 13:55`)).toBe("1:55 pm");
    expect(clockLabel(`${D} 09:05`)).toBe("9:05 am");
  });

  it("gets both noon and midnight right - the two that are usually wrong", () => {
    expect(clockLabel(`${D} 00:00`)).toBe("12:00 am");
    expect(clockLabel(`${D} 12:00`)).toBe("12:00 pm");
    expect(clockLabel(`${D} 23:59`)).toBe("11:59 pm");
  });
});
