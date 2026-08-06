import { describe, expect, it } from "vitest";
import { formatActivity, greetingForHour, relativeTime } from "./activity";

describe("formatActivity", () => {
  it("delegates label + tone to the canonical registry, appending the target name", () => {
    // Spot-check across domains - labels/tones come from lib/activity/actions.ts.
    expect(formatActivity("user.create", "Deepa Menon")).toEqual({
      text: "New staff created - Deepa Menon",
      tone: "success",
    });
    expect(formatActivity("user.deactivate", "Fatima Sheikh")).toEqual({
      text: "Staff account deactivated - Fatima Sheikh",
      tone: "danger",
    });
    expect(formatActivity("user.password_reset", "Kevin Mathew").tone).toBe("warning");
    expect(formatActivity("auth.sign_in", "Dr. Joseph")).toEqual({
      text: "Signed in - Dr. Joseph",
      tone: "accent",
    });
    expect(formatActivity("doctor.create", "Dr. Ravi").tone).toBe("success");
  });

  it("omits the dash when the target name is unknown", () => {
    expect(formatActivity("user.create", null).text).toBe("New staff created");
  });

  it("falls back to a readable form for an unknown action", () => {
    expect(formatActivity("user.something_new", "X")).toEqual({
      text: "user something new - X",
      tone: "accent",
    });
  });

  it("appends the rupee amount when the row carries a total_paise", () => {
    expect(formatActivity("bill.finalize", null, { total_paise: 120000 })).toEqual({
      text: "Bill finalized - ₹1,200.00",
      tone: "success",
    });
    // pg returns BIGINT as a string - still renders.
    expect(formatActivity("bill.finalize", null, { total_paise: "25050" }).text).toBe(
      "Bill finalized - ₹250.50",
    );
  });

  it("omits the amount when details lack a total_paise", () => {
    expect(formatActivity("bill.finalize", null, { bill_number: 1042 }).text).toBe("Bill finalized");
    expect(formatActivity("bill.finalize", null, null).text).toBe("Bill finalized");
    expect(formatActivity("bill.finalize", null).text).toBe("Bill finalized");
  });
});

// A doctor payout is cash leaving the drawer, and the feed row is where an admin
// notices it. `entity` is 'doctor_payout', which the feed query has no name join for,
// so target_name is ALWAYS null here - every detail has to come from what was recorded
// at payout time or the row reads as a bare "Doctor paid".
describe("formatActivity - doctor payouts", () => {
  const PAYOUT = {
    doctor_name: "Dr. Anita Rao",
    paid_paise: 700000,
    consultation_count: 35,
    covers_day: "2026-08-06",
    covers_label: "Whole day",
  };

  it("names the doctor, the amount, the count and the period paid", () => {
    expect(formatActivity("doctor.payout", null, PAYOUT)).toEqual({
      text: "Doctor paid - Dr. Anita Rao · ₹7,000.00 · 35 consultations · Whole day",
      tone: "success",
    });
  });

  it("reads a session payout by its clock times, not just the day", () => {
    // The whole reason payouts exist is paying ONE sitting - a row that cannot say
    // which sitting was paid is the ambiguity the feature was built to remove.
    expect(
      formatActivity("doctor.payout", null, {
        ...PAYOUT,
        covers_label: "12:04 pm to 1:56 pm · 6:10 pm to 8:03 pm",
      }).text,
    ).toBe(
      "Doctor paid - Dr. Anita Rao · ₹7,000.00 · 35 consultations · 12:04 pm to 1:56 pm · 6:10 pm to 8:03 pm",
    );
  });

  it("renders a BIGINT amount that pg handed back as text", () => {
    expect(formatActivity("doctor.payout", null, { ...PAYOUT, paid_paise: "700000" }).text).toContain(
      "₹7,000.00",
    );
  });

  it("says one consultation, not one consultations", () => {
    expect(
      formatActivity("doctor.payout", null, { ...PAYOUT, consultation_count: 1 }).text,
    ).toContain("1 consultation ·");
  });

  it("prints a zero payout rather than dropping the amount", () => {
    // A doctor on a 0% share settles for ₹0. The row must still say so - a payout
    // line with no amount reads as a payout whose amount was lost.
    expect(formatActivity("doctor.payout", null, { ...PAYOUT, paid_paise: 0 }).text).toContain(
      "₹0.00",
    );
  });

  it("drops only the pieces it is missing, never the whole row", () => {
    expect(formatActivity("doctor.payout", null, { doctor_name: "Dr. Anita Rao" }).text).toBe(
      "Doctor paid - Dr. Anita Rao",
    );
    expect(formatActivity("doctor.payout", null, {}).text).toBe("Doctor paid");
    expect(formatActivity("doctor.payout", null, null).text).toBe("Doctor paid");
  });

  it("never prints ₹NaN when the amount is unparseable", () => {
    const text = formatActivity("doctor.payout", null, { ...PAYOUT, paid_paise: "abc" }).text;
    expect(text).not.toContain("NaN");
    expect(text).toBe("Doctor paid - Dr. Anita Rao · 35 consultations · Whole day");
  });

  it("leaves every other action's wording untouched", () => {
    expect(formatActivity("bill.finalize", null, { total_paise: 120000 }).text).toBe(
      "Bill finalized - ₹1,200.00",
    );
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-07-07T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("labels sub-minute as just now", () => {
    expect(relativeTime(ago(10_000), now)).toBe("just now");
  });
  it("labels minutes and hours, singular vs plural", () => {
    expect(relativeTime(ago(1 * MIN), now)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * MIN), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(1 * HOUR), now)).toBe("1 hour ago");
    expect(relativeTime(ago(3 * HOUR), now)).toBe("3 hours ago");
  });
  it("labels 1 day as Yesterday and 2-6 days as N days ago", () => {
    expect(relativeTime(ago(1 * DAY), now)).toBe("Yesterday");
    expect(relativeTime(ago(3 * DAY), now)).toBe("3 days ago");
  });
  it("falls back to an absolute date past a week", () => {
    expect(relativeTime(ago(10 * DAY), now)).toMatch(/^[A-Z][a-z]{2} \d+$/);
  });
});

describe("greetingForHour", () => {
  it("picks the part of day", () => {
    expect(greetingForHour(8, "Meera")).toBe("Good morning, Meera");
    expect(greetingForHour(13, "Meera")).toBe("Good afternoon, Meera");
    expect(greetingForHour(20, "Meera")).toBe("Good evening, Meera");
  });
});
